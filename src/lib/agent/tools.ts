import 'server-only';

// P1-4 fix (H-AGT-7): use createRequire instead of eval('require').
// `eval('require')` triggers ESLint no-eval, fails under CSP that disables eval,
// and is flagged by security scanners. createRequire is the standard way to
// call require() from an ES module.
import { createRequire } from 'module';
const dynamicRequire = createRequire(import.meta.url);

import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { readFile, readdir, stat, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { createWebSearchTool, createFetchPageTool, createSaveArtifactTool } from '@/lib/tools/shared-chat-tools';
import { runCode } from '@/lib/tools/code-run';
import type { AgentTask } from './task';
import { appendAgentTaskArtifact } from './task';
import { emitAgentEvent } from './events';
import { waitForUserInput } from './wait-input';
import { assertSafeUrl, assertSafeHost } from '@/lib/infra/ssrf';
import { logger } from '@/lib/logger';
import {
  resolveScopedPath,
  walkScope,
  isTextFile,
  shouldSkipFsEntry,
} from './fs-helpers';
import { safeWriteFile } from './fs-scope';
import { recordFileChange } from './file-changes';
import {
  makeSearchSourcesTool,
  makeGetSourceTool,
  makeReadFolderFileTool,
  makeListSourcesTool,
} from '@/lib/kb/tools';
import { makeSearchCodebaseTool, makeListCodebaseSymbolsTool } from './tools/search-codebase';
import { makeGrepTool } from './tools/grep';
import { makeRunCommandTool } from './tools/run-command';
import {
  makeProposeDesignTool,
  makeRuntimeStartTool,
  makeRuntimeLogsTool,
  makeRuntimeStopTool,
} from './runtime/tools';

function makeReadFileTool(task: AgentTask) {
  return tool({
    description: 'Прочитать содержимое файла внутри рабочей директории задачи. Возвращает текст (для текстовых файлов) или base64 (для бинарных).',
    inputSchema: z.object({
      path: z.string().min(1).describe('Путь относительно рабочей директории'),
      maxBytes: z.number().optional().default(50_000).describe('Лимит байт (по умолчанию 50000)'),
    }),
    execute: async ({ path, maxBytes }) => {
      const scoped = await resolveScopedPath(task, path, 'Чтение файлов запрещено.');
      if (!scoped.ok) return { error: scoped.error };
      try {
        const s = await stat(scoped.fullPath);
        if (s.size > maxBytes) {
          return { error: `Файл слишком большой: ${s.size} байт (лимит ${maxBytes})` };
        }
        const content = await readFile(scoped.fullPath, 'utf8');
        return { path, size: s.size, content };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeWriteFileTool(task: AgentTask) {
  return tool({
    description: 'Записать файл внутри рабочей директории задачи. Создаёт промежуточные директории. Перезаписывает существующие файлы.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Путь относительно рабочей директории'),
      content: z.string().min(0).describe('Содержимое файла (текст)'),
    }),
    execute: async ({ path, content }) => {
      const scoped = await resolveScopedPath(task, path, 'Запись файлов запрещена.');
      if (!scoped.ok) return { error: scoped.error };
      try {
        let previousContent: string | null = null;
        try {
          previousContent = await readFile(scoped.fullPath, 'utf8');
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== 'ENOENT') throw e;
        }

        await mkdir(dirname(scoped.fullPath), { recursive: true });
        await safeWriteFile(path, task.fsScope, content);

        const previewLines = content.split('\n').slice(0, 12);
        const diff = previousContent === null
          ? previewLines.map((l, i) => `+ ${i + 1}: ${l}`).join('\n')
          : undefined;

        const change = recordFileChange({
          taskId: task.id,
          path,
          tool: 'write_file',
          previousContent,
          diff,
        });

        return {
          path,
          size: content.length,
          written: true,
          changeId: change.id,
          canUndo: change.canUndo,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeListDirTool(task: AgentTask) {
  return tool({
    description: 'Получить список файлов и поддиректорий в указанной директории. Без аргументов — корень рабочей директории.',
    inputSchema: z.object({
      path: z.string().default('.').describe('Путь относительно рабочей директории (по умолчанию ".")'),
    }),
    execute: async ({ path }) => {
      const scoped = await resolveScopedPath(task, path, 'Листинг директории запрещён.');
      if (!scoped.ok) return { error: scoped.error };
      try {
        const entries = await readdir(scoped.fullPath, { withFileTypes: true });
        const items = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
        }));
        return { path, items };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeListTreeTool(task: AgentTask) {
  return tool({
    description: 'Получить рекурсивное дерево файлов рабочей директории (до 3 уровней вложенности). Показывает директории, файлы и их размеры. Полезно для обзора структуры проекта.',
    inputSchema: z.object({
      maxDepth: z.number().default(3).describe('Максимальная глубина вложенности (по умолч 3)'),
    }),
    execute: async ({ maxDepth }) => {
      const scoped = await resolveScopedPath(task, '.', 'Листинг директории запрещён.');
      if (!scoped.ok) return { error: scoped.error };

      type TreeNode = { name: string; type: string; size?: number; children?: TreeNode[] };

      async function buildTree(dirPath: string, depth: number): Promise<TreeNode[]> {
        if (depth >= maxDepth) return [];
        const entries = await readdir(dirPath, { withFileTypes: true });
        const nodes: TreeNode[] = [];

        for (const entry of entries) {
          if (shouldSkipFsEntry(entry.name)) continue;
          if (entry.isSymbolicLink?.()) continue;

          const entryPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            const children = await buildTree(entryPath, depth + 1).catch(() => []);
            nodes.push({ name: entry.name, type: 'dir', children });
          } else if (entry.isFile()) {
            const s = await stat(entryPath).catch(() => null);
            nodes.push({ name: entry.name, type: 'file', size: s?.size });
          }
        }
        return nodes;
      }

      try {
        return { tree: await buildTree(scoped.fullPath, 0) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeEditFileTool(task: AgentTask) {
  return tool({
    description: 'Точечно изменить файл: заменить строки, вставить текст, удалить строки, или заменить по regex. НЕ перезаписывает весь файл — меняет только указанную часть. Экономит токены и время. Используй вместо write_file когда нужно изменить часть существующего файла. Возвращает diff изменений.',
    inputSchema: z.object({
      path: z.string().min(1).describe('Путь к файлу относительно рабочей директории'),
      mode: z.enum(['range', 'insert', 'delete', 'regex']).describe('range: заменить строки startLine-endLine; insert: вставить после lineNumber; delete: удалить startLine-endLine; regex: заменить по паттерну'),
      content: z.string().default('').describe('Новый текст (для range и insert) или replacement (для regex). Игнорируется для delete.'),
      startLine: z.number().optional().describe('Начальная строка (1-indexed, включительно). Для mode=range и mode=delete.'),
      endLine: z.number().optional().describe('Конечная строка (1-indexed, включительно). Для mode=range и mode=delete.'),
      lineNumber: z.number().optional().describe('Строка после которой вставить (0 = в начало файла). Для mode=insert.'),
      pattern: z.string().optional().describe('Regex паттерн для поиска. Для mode=regex.'),
    }),
    execute: async ({ path, mode, content, startLine, endLine, lineNumber, pattern }) => {
      const scoped = await resolveScopedPath(task, path, 'Редактирование файлов запрещено.');
      if (!scoped.ok) return { error: scoped.error };

      try {
        const oldContent = await readFile(scoped.fullPath, 'utf8');
        const oldLines = oldContent.split('\n');

        let newLines: string[];
        let diffBefore: string[];
        let diffAfter: string[];

        if (mode === 'range') {
          if (!startLine || !endLine || startLine < 1 || endLine < startLine || endLine > oldLines.length) {
            return { error: `Invalid line range: start=${startLine}, end=${endLine}, file has ${oldLines.length} lines` };
          }
          const contentLines = content.split('\n');
          newLines = [...oldLines.slice(0, startLine - 1), ...contentLines, ...oldLines.slice(endLine)];
          const ctxStart = Math.max(0, startLine - 3);
          const ctxEnd = Math.min(oldLines.length, endLine + 3);
          diffBefore = oldLines.slice(ctxStart, ctxEnd).map((l, i) => `  ${ctxStart + i + 1}: ${l}`);
          diffAfter = newLines.slice(ctxStart, ctxStart + contentLines.length + 6).map((l, i) => {
            const lineNum = ctxStart + i + 1;
            const isChanged = lineNum >= startLine && lineNum <= startLine + contentLines.length - 1;
            return `${isChanged ? '+' : ' '} ${lineNum}: ${l}`;
          });
        } else if (mode === 'insert') {
          const lineNum = lineNumber ?? 0;
          if (lineNum < 0 || lineNum > oldLines.length) {
            return { error: `Invalid lineNumber: ${lineNum}, file has ${oldLines.length} lines` };
          }
          const contentLines = content.split('\n');
          newLines = [...oldLines.slice(0, lineNum), ...contentLines, ...oldLines.slice(lineNum)];
          const ctxStart = Math.max(0, lineNum - 2);
          const ctxEnd = Math.min(newLines.length, lineNum + contentLines.length + 2);
          diffBefore = oldLines.slice(ctxStart, Math.min(oldLines.length, lineNum + 2)).map((l, i) => `  ${ctxStart + i + 1}: ${l}`);
          diffAfter = newLines.slice(ctxStart, ctxEnd).map((l, i) => {
            const ln = ctxStart + i + 1;
            const isInserted = ln > lineNum && ln <= lineNum + contentLines.length;
            return `${isInserted ? '+' : ' '} ${ln}: ${l}`;
          });
        } else if (mode === 'delete') {
          if (!startLine || !endLine || startLine < 1 || endLine < startLine || endLine > oldLines.length) {
            return { error: `Invalid line range: start=${startLine}, end=${endLine}, file has ${oldLines.length} lines` };
          }
          newLines = [...oldLines.slice(0, startLine - 1), ...oldLines.slice(endLine)];
          const ctxStart = Math.max(0, startLine - 3);
          const ctxEnd = Math.min(oldLines.length, endLine + 3);
          diffBefore = oldLines.slice(ctxStart, ctxEnd).map((l, i) => `  ${ctxStart + i + 1}: ${l}`);
          diffAfter = newLines.slice(ctxStart, Math.min(newLines.length, ctxStart + (endLine - startLine + 1) + 3)).map((l, i) => `- ${ctxStart + i + 1}: [deleted]`);
        } else if (mode === 'regex') {
          if (!pattern) return { error: 'pattern is required for regex mode' };
          // Используем RE2 вместо RegExp для защиты от ReDoS.
          // RE2 — Google's linear-time regex engine, не поддерживает
          // backtracking → catastrophic backtracking невозможен.
          // Если RE2 не загрузился (native addon issue) — fallback на RegExp
          // с timeout через Promise.race (не идеально, но лучше чем ничего).
          //
          // RE2 имеет некоторые ограничения vs V8 RegExp:
          //   - Нет backreferences (\1, \k<name>)
          //   - Нет lookahead/lookbehind
          //   - Нет atomic groups
          // Если LLM сгенерирует pattern с этими фичами — RE2 выбросит ошибку,
          // мы вернём понятное message пользователю.
          let regex: { test: (s: string) => boolean } & { [Symbol.replace]: (str: string, replacement: string) => string };
          let re2Available = false;
          try {
            // P1-4 fix (H-AGT-7): use createRequire instead of eval('require').
            const RE2 = dynamicRequire('re2');
            regex = new RE2(pattern, 'g');
            re2Available = true;
          } catch (re2Err) {
            // Fallback на RegExp если RE2 недоступен. Логируем warning.
            // Это не идеально — catastrophic backtracking возможен. Но лучше
            // чем просто уронить tool. Limit: max 100k chars в oldContent
            // (если больше — отказываем, слишком рискованно для fallback).
            if (oldContent.length > 100_000) {
              return {
                error: `RE2 unavailable and content too large (${oldContent.length} chars) for safe RegExp fallback. Install re2: bun add re2, or rebuild native addons.`,
              };
            }
            try {
              const fallbackRegex = new RegExp(pattern, 'g');
              regex = fallbackRegex as unknown as typeof regex;
            } catch (regexErr) {
              return {
                error: `Invalid regex pattern: ${regexErr instanceof Error ? regexErr.message : String(regexErr)}`,
              };
            }
          }
          let newContent: string;
          try {
            newContent = oldContent.replace(regex as unknown as RegExp, content);
          } catch (replaceErr) {
            return {
              error: `Regex replace failed: ${replaceErr instanceof Error ? replaceErr.message : String(replaceErr)}`,
            };
          }
          if (newContent === oldContent) return { error: 'No matches found for pattern' };
          newLines = newContent.split('\n');
          let firstChange = 0;
          for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
            if (oldLines[i] !== newLines[i]) { firstChange = i; break; }
          }
          const ctxStart = Math.max(0, firstChange - 2);
          diffBefore = oldLines.slice(ctxStart, ctxStart + 5).map((l, i) => `  ${ctxStart + i + 1}: ${l}`);
          diffAfter = newLines.slice(ctxStart, ctxStart + 5).map((l, i) => {
            const isChanged = oldLines[ctxStart + i] !== l;
            return `${isChanged ? '+' : ' '} ${ctxStart + i + 1}: ${l}`;
          });
        } else {
          return { error: `Unknown mode: ${mode}` };
        }

        await safeWriteFile(path, task.fsScope, newLines.join('\n'));
        const diff = [...diffBefore, '---', ...diffAfter].join('\n');
        const change = recordFileChange({
          taskId: task.id,
          path,
          tool: 'edit_file',
          previousContent: oldContent,
          diff,
        });
        return {
          path,
          mode,
          oldLineCount: oldLines.length,
          newLineCount: newLines.length,
          diff,
          changeId: change.id,
          canUndo: change.canUndo,
          success: true,
        };
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          return { error: `File not found: ${path}. Use write_file to create new files.` };
        }
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeHttpRequestTool() {
  return tool({
    description: 'Выполнить HTTP GET-запрос к указанному URL. Возвращает статус, заголовки, тело (до 10000 символов). Блокирует private/internal IP (SSRF protection).',
    inputSchema: z.object({
      url: z.string().url().describe('Полный URL включая схему (http/https)'),
    }),
    execute: async ({ url }) => {
      try {
        await assertSafeUrl(url);
        const u = new URL(url);
        await assertSafeHost(u.hostname);

        let currentUrl = url;
        let redirectCount = 0;
        const MAX_REDIRECTS = 5;

        while (redirectCount < MAX_REDIRECTS) {
          const res = await fetch(currentUrl, {
            headers: { 'User-Agent': 'Lia-Agent/2.0' },
            signal: AbortSignal.timeout(20_000),
            redirect: 'manual',
          });

          if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            if (!location) break;
            const redirectUrl = new URL(location, currentUrl);
            redirectCount++;
            await assertSafeUrl(redirectUrl.toString());
            await assertSafeHost(redirectUrl.hostname);
            currentUrl = redirectUrl.toString();
            continue;
          }

          const text = await res.text();
          return {
            status: res.status,
            statusText: res.statusText,
            contentType: res.headers.get('content-type'),
            body: text.slice(0, 10_000),
            truncated: text.length > 10_000,
            finalUrl: redirectCount > 0 ? currentUrl : undefined,
          };
        }

        return { error: `too many redirects (max ${MAX_REDIRECTS})` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeAskUserTool(task: AgentTask) {
  return tool({
    description: 'Задать уточняющий вопрос пользователю и приостановить задачу до получения ответа. Используй когда: неточно понятно требование, нужно подтвердить опасное действие, не хватает информации для продолжения.',
    inputSchema: z.object({
      question: z.string().min(1).describe('Чёткий вопрос пользователю'),
    }),
    execute: async ({ question }) => {
      try {
        const answer = await waitForUserInput(task.id, question);
        return { question, answer };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('cancelled')) return { error: 'Пользователь отменил задачу', question };
        if (msg.includes('timeout')) return { error: 'Пользователь не ответил вовремя (10 мин)', question };
        return { error: msg, question };
      }
    },
  });
}

function makeFileSearchTool(task: AgentTask) {
  return tool({
    description: 'Найти файлы по содержимому внутри рабочей директории. Рекурсивно обходит поддиректории, ищет подстроку (case-insensitive) в текстовых файлах. Возвращает до 20 совпадений с путём, номером строки и контекстом. Используй когда нужно найти где упоминается функция/класс/переменная.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Подстрока для поиска (case-insensitive)'),
      maxResults: z.number().default(20).describe('Максимум результатов (по умолчанию 20)'),
      filePattern: z.string().default('').describe('Фильтр по расширению, например "ts" или "py" (пусто = все)'),
    }),
    execute: async ({ query, maxResults, filePattern }) => {
      const scoped = await resolveScopedPath(task, '.', 'Поиск файлов запрещён.');
      if (!scoped.ok) return { error: scoped.error };

      try {
        const results: Array<{ path: string; line: number; context: string }> = [];
        const queryLower = query.toLowerCase();

        await walkScope(scoped.fullPath, async (entry) => {
          if (results.length >= maxResults) return 'stop';
          if (!entry.isFile || !isTextFile(entry.name)) return;

          if (filePattern) {
            const ext = entry.name.split('.').pop()?.toLowerCase();
            if (ext !== filePattern.toLowerCase()) return;
          }

          try {
            const statResult = await stat(entry.fullPath);
            if (statResult.size > 50_000) return;

            const content = await readFile(entry.fullPath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) return 'stop';
              if (lines[i].toLowerCase().includes(queryLower)) {
                const contextStart = Math.max(0, i - 1);
                const contextEnd = Math.min(lines.length, i + 2);
                results.push({
                  path: entry.relativePath,
                  line: i + 1,
                  context: lines.slice(contextStart, contextEnd).join('\n').slice(0, 300),
                });
              }
            }
          } catch { /* skip unreadable files */ }
        });

        return { query, results, count: results.length, truncated: results.length >= maxResults };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  });
}

function makeCodeRunTool() {
  return tool({
    description: 'Выполнить код (Python или JavaScript) в sandbox. Полезно для: проверки кода перед сохранением, вычислений, тестирования гипотез, парсинга данных. Код выполняется с таймаутом 30 сек, без сетевого доступа, в изолированной temp-директории. Возвращает stdout + stderr.',
    inputSchema: z.object({
      language: z.enum(['python', 'javascript']).default('python').describe('Язык программирования'),
      code: z.string().min(1).describe('Код для выполнения'),
    }),
    execute: async ({ language, code }) => {
      const result = await runCode(code, language);
      return {
        language,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        truncated: result.truncated,
        success: result.exitCode === 0,
      };
    },
  });
}

export function buildAgentTools(
  task: AgentTask,
  opts?: { pinnedSourceIds?: string[] },
): ToolSet {
  const tools: ToolSet = {
    web_search: createWebSearchTool(),
    save_artifact: createSaveArtifactTool(async (result) => {
      await appendAgentTaskArtifact(task.id, {
        kind: 'file',
        path: result.filename,
        meta: {
          id: result.id,
          filename: result.filename,
          url: result.url,
          mime: result.mime,
          size: result.size,
        },
      });
      emitAgentEvent({
        type: 'artifact_saved',
        taskId: task.id,
        step: 0,
        filename: result.filename,
        url: result.url,
        ts: Date.now(),
      });
    }),
    read_file: makeReadFileTool(task),
    write_file: makeWriteFileTool(task),
    edit_file: makeEditFileTool(task),
    list_dir: makeListDirTool(task),
    list_tree: makeListTreeTool(task),
    file_search: makeFileSearchTool(task),
    grep: makeGrepTool(task),
    run_command: makeRunCommandTool(task),
    http_request: makeHttpRequestTool(),
    fetch_page: createFetchPageTool(),
    code_run: makeCodeRunTool(),
    propose_design: makeProposeDesignTool(task),
    runtime_start: makeRuntimeStartTool(task),
    runtime_logs: makeRuntimeLogsTool(task),
    runtime_stop: makeRuntimeStopTool(task),
    ask_user: makeAskUserTool(task),
    // ── Knowledge Base tools ──
    search_sources: makeSearchSourcesTool({ pinnedSourceIds: opts?.pinnedSourceIds }),
    get_source: makeGetSourceTool({ goalHint: task.goal }),
    read_folder_file: makeReadFolderFileTool(),
    list_sources: makeListSourcesTool(),
    search_codebase: makeSearchCodebaseTool(task),
    list_codebase_symbols: makeListCodebaseSymbolsTool(task),
  };

  if (task.toolsWhitelist) {
    let whitelist: string[] = [];
    try {
      whitelist = JSON.parse(task.toolsWhitelist);
    } catch (e) {
      // P1-4 fix (H-AGT-8): fail-closed on parse error.
      // Previous code silently fell through to returning ALL tools on parse
      // error — a security issue if a researcher template's whitelist is
      // malformed (researcher would get write_file, etc.).
      logger.error('agent', 'toolsWhitelist is malformed JSON — returning EMPTY toolset (fail-closed)', {
        taskId: task.id.slice(0, 8),
        whitelistPreview: task.toolsWhitelist.slice(0, 100),
      }, e);
      return {};
    }
    if (Array.isArray(whitelist) && whitelist.length > 0) {
      const filtered: ToolSet = {};
      for (const name of whitelist) {
        if (name in tools) filtered[name] = tools[name];
      }
      if (Object.keys(filtered).length === 0) {
        // P1-4 fix (H-AGT-8): fail-closed — return empty toolset, NOT full set.
        // If the whitelist contains only unknown tool names, the task template
        // is broken. Giving all tools would be a privilege escalation.
        logger.error('agent', 'toolsWhitelist matched no tools — returning EMPTY toolset (fail-closed)', {
          whitelist,
          taskId: task.id.slice(0, 8),
          availableTools: Object.keys(tools),
        });
        return {};
      }
      return filtered;
    }
  }

  return tools;
}

const DESCRIBE_TOOLS_CACHE_MAX = 64;
const describeToolsCache = new Map<string, string>();

export function describeTools(tools: ToolSet): string {
  const cacheKey = Object.keys(tools).sort().join(',');
  const cached = describeToolsCache.get(cacheKey);
  if (cached !== undefined) {
    // LRU touch — move to end (Map insertion order)
    describeToolsCache.delete(cacheKey);
    describeToolsCache.set(cacheKey, cached);
    return cached;
  }

  const result = Object.entries(tools)
    .map(([name, toolDef]) => {
      const lines: string[] = [`- ${name}`];
      const desc = typeof toolDef?.description === 'string' ? toolDef.description : '';
      if (desc) lines.push(`    ${desc.slice(0, 200)}`);

      const params = extractZodParams(toolDef?.inputSchema);
      for (const p of params) {
        const reqStr = p.required ? 'required' : 'optional';
        lines.push(`    ${p.name} (${p.type}, ${reqStr})${p.description ? ': ' + p.description : ''}`);
      }
      return lines.join('\n');
    })
    .join('\n');

  if (describeToolsCache.size >= DESCRIBE_TOOLS_CACHE_MAX) {
    const oldest = describeToolsCache.keys().next().value;
    if (oldest !== undefined) describeToolsCache.delete(oldest);
  }
  describeToolsCache.set(cacheKey, result);
  return result;
}

type ZodParam = { name: string; type: string; required: boolean; description?: string };

function extractZodParams(schema: unknown): ZodParam[] {
  try {
    const s = schema as { _def?: { shape?: Record<string, unknown> } };
    if (!s?._def?.shape) return [];

    const shape = s._def.shape;
    const params: ZodParam[] = [];

    for (const [name, field] of Object.entries(shape)) {
      const f = field as {
        _def?: { type?: string; innerType?: unknown };
        description?: string;
      };

      let inner = f;
      let hasDefault = false;
      let hasOptional = false;

      while (inner?._def && (inner._def.type === 'default' || inner._def.type === 'optional')) {
        if (inner._def.type === 'default') hasDefault = true;
        if (inner._def.type === 'optional') hasOptional = true;
        inner = inner._def.innerType as typeof inner;
      }

      params.push({
        name,
        type: zodTypeToSimple(inner?._def?.type ?? 'unknown'),
        required: !hasDefault && !hasOptional,
        description: f.description,
      });
    }

    return params;
  } catch {
    return [];
  }
}

function zodTypeToSimple(typeName: string): string {
  if (typeName.includes('string')) return 'string';
  if (typeName.includes('number')) return 'number';
  if (typeName.includes('boolean')) return 'boolean';
  if (typeName.includes('array')) return 'array';
  if (typeName.includes('object')) return 'object';
  return 'string';
}

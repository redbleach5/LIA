import 'server-only';

// ============================================================================
// Create Runtime agent tools — propose_design + runtime_*.
// ============================================================================

import { readFile } from 'fs/promises';
import { join } from 'path';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentTask } from '../task';
import { resolveScopedPath } from '../fs-helpers';
import { persistProjectDesign } from './design-gate';
import {
  PROJECT_MANIFEST_FILENAME,
  parseProjectDesignJson,
  previewUrlForDesign,
  projectDesignSchema,
} from './project-manifest';
import {
  getRuntimeLogs,
  getRuntimeSnapshot,
  startRuntime,
  startRuntimeFromDesign,
  stopRuntime,
} from './process-supervisor';
import { PROJECT_KINDS, PREVIEW_TYPES } from './types';

export function makeProposeDesignTool(task: AgentTask) {
  return tool({
    description:
      'Спроектировать стек и структуру артефакта ДО write_file. Пишет lia.project.json и показывает дизайн пользователю. '
      + 'Обязателен для создания игр/сайтов/программ. Укажи kind, stack, tree, scripts, preview, acceptance.',
    inputSchema: z.object({
      name: z.string().min(1).max(80),
      kind: z.enum(PROJECT_KINDS),
      stack: z.array(z.string().min(1)).min(1).max(12),
      tree: z
        .array(z.object({ path: z.string().min(1), role: z.string().min(1) }))
        .min(1)
        .max(40),
      scripts: z.object({
        install: z.string().max(300).optional(),
        dev: z.string().max(300).optional(),
        build: z.string().max(300).optional(),
        start: z.string().max(300).optional(),
      }),
      preview: z.object({
        type: z.enum(PREVIEW_TYPES),
        port: z.number().int().min(1024).max(65535).optional(),
        url: z.string().max(300).optional(),
      }),
      entry: z.string().max(200).optional(),
      acceptance: z.string().min(1).max(500),
    }),
    execute: async (input) => {
      const result = await persistProjectDesign(task, { ...input, createdBy: 'lia' });
      if (!result.ok) return { success: false, error: result.error };
      return {
        success: true,
        manifest: PROJECT_MANIFEST_FILENAME,
        design: result.design,
        previewUrl: previewUrlForDesign(result.design),
      };
    },
  });
}

async function loadDesignFromCwd(cwd: string) {
  try {
    const text = await readFile(join(cwd, PROJECT_MANIFEST_FILENAME), 'utf8');
    return parseProjectDesignJson(text);
  } catch {
    return { ok: false as const, error: `${PROJECT_MANIFEST_FILENAME} not found` };
  }
}

export function makeRuntimeStartTool(task: AgentTask) {
  return tool({
    description:
      'Запустить долгоживущий процесс артефакта (dev-сервер / скрипт) по lia.project.json. '
      + 'Логи стримятся пользователю. После записи файлов обязательно вызови для verify.',
    inputSchema: z.object({
      scriptKey: z.enum(['dev', 'start']).default('dev'),
      /** Override script if manifest missing (must be allowlisted binary). */
      script: z.string().max(300).optional(),
      cwd: z.string().default('.'),
      port: z.number().int().min(1024).max(65535).optional(),
    }),
    execute: async ({ scriptKey, script, cwd, port }) => {
      const scoped = await resolveScopedPath(task, cwd || '.', 'Нет рабочей директории для runtime');
      if (!scoped.ok) return { success: false, error: scoped.error };

      if (script) {
        const result = await startRuntime({
          taskId: task.id,
          cwd: scoped.fullPath,
          script,
          scriptKey,
          port: port ?? null,
          previewUrl: port ? `http://127.0.0.1:${port}` : null,
        });
        return result;
      }

      const loaded = await loadDesignFromCwd(scoped.fullPath);
      if (!loaded.ok) {
        return {
          success: false,
          error: loaded.error + ' — вызови propose_design или передай script явно',
        };
      }
      const result = await startRuntimeFromDesign(
        task.id,
        scoped.fullPath,
        loaded.design,
        scriptKey,
      );
      return result;
    },
  });
}

export function makeRuntimeLogsTool(task: AgentTask) {
  return tool({
    description: 'Прочитать последние логи Process Supervisor (stdout/stderr) для диагностики.',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(200).default(60),
    }),
    execute: async ({ limit }) => {
      const logs = getRuntimeLogs(task.id, limit);
      const snap = getRuntimeSnapshot(task.id);
      return {
        success: true,
        status: snap?.status ?? 'idle',
        port: snap?.port ?? null,
        previewUrl: snap?.previewUrl ?? null,
        lastError: snap?.lastError ?? null,
        logs,
      };
    },
  });
}

export function makeRuntimeStopTool(task: AgentTask) {
  return tool({
    description: 'Остановить процесс артефакта (dev-сервер / скрипт).',
    inputSchema: z.object({}),
    execute: async () => {
      const result = await stopRuntime(task.id);
      return { success: result.success, status: result.status };
    },
  });
}

/** Re-export schema fragment for tests. */
export { projectDesignSchema };

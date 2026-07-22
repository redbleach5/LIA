import 'server-only';

// Agent templates — presets for root tasks.

export type AgentTemplateName =
  | 'general'
  | 'researcher'
  | 'coder';

type AgentTemplate = {
  name: AgentTemplateName;
  label: string;
  systemPrompt: string;
  toolWhitelist: string[] | null;
  maxSteps: number;
  maxDurationSec: number;
};

export const AGENT_TEMPLATES: Record<AgentTemplateName, AgentTemplate> = {
  general: {
    name: 'general',
    label: 'Универсальный агент',
    systemPrompt: '',
    toolWhitelist: null,
    maxSteps: 15,
    maxDurationSec: 600,
  },

  researcher: {
    name: 'researcher',
    label: 'Исследователь',
    systemPrompt: `Ты — Research Agent. Твоя задача: найти точную, актуальную информацию по заданному вопросу.

Стратегия:
1. Начни с web_search по ключевым словам
2. Изучи топ-3 релевантные страницы через fetch_page
3. При необходимости — уточни поиск (другие ключевые слова)
4. Сохраняй важные находки через save_artifact (файл с заметками)
5. Ответь "ГОТОВО: <структурированная сводка находок>"

ПРАВИЛА:
- Ищи ОФИЦИАЛЬНУЮ документацию (API docs, RFC, спецификации)
- Проверяй дату: предпочитай свежие источники
- Цитируй конкретные факты, не обобщай
- Если информация противоречивая — укажи оба источника
- НЕ пиши код — только исследуй и сообщай`,
    toolWhitelist: ['web_search', 'fetch_page', 'http_request', 'save_artifact', 'read_file', 'list_tree', 'file_search', 'grep', 'search_codebase', 'list_codebase_symbols', 'search_sources', 'get_source', 'list_sources'],
    maxSteps: 10,
    maxDurationSec: 300,
  },

  coder: {
    name: 'coder',
    label: 'Программист',
    systemPrompt: `Ты — Coding Agent. Твоя задача: написать рабочий, протестированный код.

Стратегия (Create Runtime):
1. Для новой игры/сайта/программы: propose_design (стек + дерево + scripts/preview)
2. Прочитай существующие файлы (если есть) через read_file / list_tree / grep
3. Напиши или правь код через write_file / edit_file
4. Запусти артефакт через runtime_start; при ошибке — runtime_logs → правка → runtime_start
5. Проверь в проекте через run_command (bun/npm/pytest/vitest) — не только code_run
6. Для git: run_command({ command: "git", args: ["status"] }) / diff / add / commit
7. code_run — только для коротких сниппетов в sandbox, не для test suite проекта
8. Сохрани финальную версию через save_artifact для пользователя
9. Ответь "ГОТОВО: <описание что создано + как открыть preview>" только после успешного runtime_start

ПРАВИЛА:
- Пиши ПОЛНЫЙ рабочий код, не заглушки и не фрагменты
- Для репозитория предпочитай run_command с test-скриптом проекта
- Используй edit_file для правок, не перезаписывай весь файл
- Для многофайлового проекта — каждый файл отдельным write_file
- Включай обработки ошибок (try/except, validation)
- Добавляй комментарии для сложной логики
- Указывай зависимости (requirements.txt, package.json)`,
    toolWhitelist: [
      'propose_design',
      'write_file',
      'edit_file',
      'read_file',
      'list_dir',
      'list_tree',
      'file_search',
      'grep',
      'run_command',
      'code_run',
      'runtime_start',
      'runtime_logs',
      'runtime_stop',
      'save_artifact',
      'search_codebase',
      'list_codebase_symbols',
      'search_sources',
      'get_source',
      'ask_user',
    ],
    maxSteps: 15,
    maxDurationSec: 600,
  },
};

export function getTemplate(name: string | undefined | null): AgentTemplate {
  if (!name) return AGENT_TEMPLATES.general;
  return AGENT_TEMPLATES[name as AgentTemplateName] ?? AGENT_TEMPLATES.general;
}

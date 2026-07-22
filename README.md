# Лия v2 — Personal AI Companion

Тёплый собеседник и помощник с собственным характером.

## Запуск

### 1. Зависимости и Ollama

```bash
bun install

# Ollama: https://ollama.com — затем:
ollama serve          # отдельный терминал
ollama pull qwen2.5:7b          # быстрый старт (чат + код)
ollama pull nomic-embed-text    # память (обязательно)
```

Windows: `bun install`, Ollama из Start Menu, те же `ollama pull` в PowerShell. Dev-сервер: `bun run dev`.

Модель выбирается в **Настройки → Модель** (клик сразу сохраняет). Рекомендации ниже.
Хост Ollama и модели хранятся в SQLite (UI) — это источник правды. Значения
`OLLAMA_*` в `.env` используются только как bootstrap при первом запуске
(пока в настройках ещё ничего не сохраняли).

**Удалённый Ollama (ноутбук + ПК с GPU):** в **Настройки → Модель → Хост Ollama**
укажи IP компьютера с видеокартой (LAN `192.168…` или Tailscale `100.x…`).
На том ПК: `OLLAMA_HOST=0.0.0.0 ollama serve`, на ноуте — `LIA_INFERENCE_VRAM_GB`
(ГБ VRAM удалённой карты). **С работы без белого IP** — см. корневой
[`REMOTE-OLLAMA.md`](./REMOTE-OLLAMA.md) (Tailscale, бесплатно для себя).

### Рекомендации по моделям (2026)

Ориентир железа Лии: stress floor **RTX 3060 12 GB**, комфортнее на **~16 GB+**. Chat и embeddings через Ollama.

| Роль | 12 GB (3060) | 16 GB | 24 GB+ |
|---|---|---|---|
| **Чат / companion** | `dolphin3` или `qwen3:8b` | `qwen3:14b` / `dolphin3` | `qwen3:14b` / крупнее |
| **Агент / код** | `qwen3:8b` или `qwen2.5-coder:7b` | `qwen3:14b` | `qwen3-coder:30b` |
| **Память** | `nomic-embed-text` (или `bge-m3`) | то же | то же |

**Практичный сетап на 12 GB** (живой чат + нормальный агент):

```bash
ollama pull dolphin3              # чат — uncensored, library-тег (лучше грузится)
ollama pull qwen3:8b              # агент / код (+ tools)
ollama pull nomic-embed-text      # память
```

В UI: чат → `dolphin3`; **Агент и память** → `qwen3:8b` (**не** «как у чата», если хочешь разделить роли).


### 2. Настройка (один раз)

```bash
bun run setup    # .env, ключи, БД, hooks — или вручную: cp .env.example .env && bun run db:push
```

### 3. Dev-сервер

```bash
bun run dev      # http://localhost:3000 (macOS/Linux/Windows)
```

Сервер по умолчанию привязан к `127.0.0.1`: API агента, файловые инструменты и
база знаний не должны быть доступны из LAN. Удалённый API включается только
явно через `LIA_ALLOW_REMOTE=true` вместе с `LIA_INTERNAL_TOKEN`; клиент обязан
передавать токен в `x-lia-internal`. Встроенный browser UI остаётся
localhost-only (обычный `EventSource` не передаёт произвольные заголовки).

<details>
<summary><b>Опционально: VRM, ручная настройка .env</b></summary>

**VRM 3D:** файла `/models/lia_v2.vrm` нет в репо — нормально: CTA «Показать образ Лии» / soft empty state. Загрузка: **Настройки → Вид**.

**Ручная настройка:** `cp .env.example .env`, `openssl rand -base64 32` → `LIA_ENCRYPTION_KEY`, `bun run db:push`, `bun run setup:hooks`.

</details>

## Тестирование

```bash
bun run test:ci          # основной локальный/CI прогон
bun run test             # все тесты (vitest)
bun run test:safe:local  # стоп Lia на :3000 → тесты → restart
bun run test -- tests/core   # только контракты ядра
```

Перед KB vec-тестами остановите `bun run dev` — иначе возможен `SQLITE_BUSY`. Подробности: [docs/testing/README.md](./docs/testing/README.md).

## Возможности

- **Чат со стримингом** — один LLM-вызов с tool calling, markdown-рендеринг (react-markdown + GFM)
- **Эпизодическая память** — каждый чат изолирован, факты не протекают между чатами
- **Векторная память с sqlite-vec** — семантический поиск с pre-filter по `episode_id` + `source_type` (`'dialogue'` / `'emotional'` — без перекрёстного загрязнения)
- **Агентский режим** — ReAct-loop с checkpointing (resume после restart), loop detection, ask_user, real-time SSE; шаблоны `general` / `researcher` / `coder`
- **3D VRM-аватар** — blendshapes для эмоций, дыхание, моргание, lip-sync; камера и фон в настройках
- **Capability tier** — авто-детект железа и размера модели → выбор стратегии (`micro` / `standard` / `plus` / `max`), кэш 1 час
- **Cognitive depth** — `classifyTaskComplexity` (regex) × `planExecution` (mode × tier × complexity) → адаптивное число LLM-вызовов, deliberate, self-check
- **24+ agent tools** — FS (`read/write/edit_file`, `grep`, `list_*`, `file_search`), **`run_command`**, `code_run`, **Create Runtime** (`propose_design`, `runtime_start`/`logs`/`stop`), web (`web_search`, `fetch_page`, `http_request`), `save_artifact`, KB (4), codebase (2), `ask_user` — см. `src/lib/agent/tools.ts`
- **Create Runtime** — Design Gate (стек + структура → `lia.project.json`) → scaffold → Process Supervisor (live logs + preview) → Verify/Heal перед ГОТОВО; вкладки Дизайн / Терминал / Preview в Agent Workbench
- **Тёплый лён UI** — светлая палитра, warm brown accent, Plus Jakarta Sans + JetBrains Mono
- **Knowledge Base** — hybrid search (vector + BM25 + RRF). Загрузка документов (.md/.txt/.pdf/.docx), папки проекта (docs/code), URL crawler (Readability), file watcher, BM25 inverted index, citations, KB drawer. См. [docs/kb/README.md](./docs/kb/README.md)

## Стек

| Слой | Технология |
|---|---|
| Framework | Next.js 16 (App Router, Server Components) |
| Package manager | Bun (`bun install`, `bun run dev`) |
| Runtime | Node.js (Next.js dev/prod server runs on Node, not Bun — `better-sqlite3` is a native C++ addon not yet supported by Bun runtime) |
| БД | SQLite + `better-sqlite3` + `sqlite-vec` (vec0 virtual table) |
| ORM | Prisma + raw SQL через инкапсулированный vec-client |
| LLM | Ollama через `@ai-sdk/openai-compatible` |
| Streaming | Vercel AI SDK `streamText` + `AbortSignal.timeout` |
| 3D | three.js 0.160 + `@pixiv/three-vrm` + `@react-three/fiber` |
| UI | React 19 + Tailwind 4 + shadcn/ui (Radix primitives) |
| State | Zustand (4 slices + devtools + persist) |
| Markdown | react-markdown + remark-gfm |
| Logging | Pino (JSON prod, pretty dev) |
| Validation | Zod (all API routes + tool inputs) |

## Архитектура

Подробная схема — в [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). KB security/ops — в [docs/kb/operations.md](./docs/kb/operations.md).

```
src/
├── app/
│   ├── page.tsx                    # Client — HomeShell (3-колонный layout)
│   ├── layout.tsx                  # fonts, Toaster, server startup log
│   ├── error.tsx / loading.tsx
│   └── api/                        # thin routes (zod → services)
│       ├── chat/                   # pipeline + attachments
│       ├── episodes/               # CRUD + cursor pagination + ensure-default
│       ├── agent/                  # CRUD, start, stream (SSE), input, cancel,
│       │                           # workspace, analysis, file-undo
│       ├── kb/                     # sources, search, project/codebase, health, …
│       ├── settings/               # Ollama, model-selection, VRM upload/download
│       ├── capability/             # GET profile + /refresh (backend tier, без UI-chip)
│       ├── artifacts/              # saved files download
│       └── health/
├── proxy.ts                        # Next.js proxy: X-Forwarded-For + LIA_INTERNAL_TOKEN
├── components/
│   ├── lia/
│   │   ├── settings/               # 4 tabs: model, avatar, kb, about
│   │   ├── vrm/                    # constants, background, blendshapes, gaze
│   │   ├── home-shell.tsx          # layout shell
│   │   ├── chat-*.tsx              # panel, message, input, attachments, mode
│   │   ├── kb-sidebar.tsx / source-detail-modal.tsx
│   │   ├── agent-workbench.tsx / workspace-panel.tsx / file-changes-panel.tsx
│   │   ├── vrm-avatar.tsx / avatar-column.tsx / presence-stage.tsx
│   │   └── …                      # episodes, markdown, bootstrap
│   └── ui/                         # shadcn (Radix)
├── hooks/                          # chat, episodes, agent(+stream), health, presence
├── lib/
│   ├── chat/                       # pipeline, phases, deliberate, self-check, attachments
│   ├── agent/                      # runner, tools, templates, fs-scope, loop-detector
│   ├── memory/                     # episodes, facts, vector, emotional, reflection
│   ├── kb/                         # indexer, search, bm25/FTS5, code-*
│   ├── identity/                   # character, monologue, decision, self-awareness
│   ├── llm/                        # resolve-agent-model, tool-support, error-summary
│   ├── tools/                      # web-search, save-artifact, code-run
│   ├── infra/                      # ssrf, api-validation, crypto, setup-wizard
│   ├── capability-profile.ts / cognitive-depth.ts / task-complexity.ts
│   ├── ollama.ts / db.ts / db-vec.ts / paths.ts / logger.ts / …
│   └── server-startup.ts
├── stores/                         # Zustand: episodes, messages, agent, health
└── prisma/schema.prisma            # Episode, Message, ChatAttachment, facts, vectors,
                                    # EmotionalMemory, AgentTask, Setting,
                                    # Source, Chunk
```

## Ключевые архитектурные решения

### 1. Один LLM-вызов на сообщение

Вместо цепочки `perceive → decideTool → deliberate → speak → consolidate` (3-5 LLM-вызовов в LIA v1) — один `streamText` с tools. Модель сама решает нужен ли инструмент и вызывает его. Cognitive depth добавляет deliberate / self-check только когда это оправдано tier'ом и сложностью задачи.

### 2. Память привязана к episode_id + source_type

```sql
SELECT v.rowid, v.distance, m.vector_id
FROM vec_virtual v
JOIN vec_rowid_map m ON v.rowid = m.rowid
WHERE m.episode_id = ?        -- PRE-FILTER на SQL уровне
  AND v.source_type = ?       -- 'dialogue' | 'emotional' — no cross-contamination
  AND v.embedding MATCH vec_f32(?)
ORDER BY v.distance LIMIT ?
```

Утечек между чатами нет архитектурно. Dialogue recall не возвращает emotional anchors и наоборот. `sourceType`: `'dialogue'` (реплики), `'emotional'` (якоря), `'fact'` (извлечённые факты), `'summary'` (итоги agent-задач) — recall в chat pipeline ищет `dialogue` + `fact` + `summary`.

### 3. Agent resume через checkpoint

После каждого шага сохраняется `checkpointJson = { plan, steps, savedAt }`. При restart сервера `sweepStaleTasks()` (вызывается из `server-startup.ts` на старте процесса) сбрасывает `executing`+`checkpoint` задачи в `pending` — runner пропускает PLAN и продолжает с `steps.length`. Задачи без checkpoint в transient-статусе помечаются `failed` с понятным сообщением.

### 4. Pino logging + Zod validation

Все API routes валидируются через Zod schemas (`parseBody` helper). Логирование через Pino — JSON в production (parser-friendly), pretty в development.

### 5. SSRF + sandbox + path traversal protection

- `lib/infra/ssrf.ts` — `assertSafeUrl` для всех URL от LLM (блокирует private IP, CGNAT, link-local, IPv4-mapped IPv6)
- `lib/tools/code-run.ts` — Python AST analysis + `resource.setrlimit` (CPU, memory, file, nproc)
- `lib/agent/fs-scope.ts` — `safePathWithinScope` с realpath для symlink protection

### 6. Кросс-платформенные пути

Все пути резолвятся через `src/lib/paths.ts` — `PROJECT_ROOT` из `LIA_ROOT` env или `process.cwd()`. Работает на macOS, Windows, Linux. `DATABASE_URL` в `.env` — `file:../db/custom.db`. Префикс `../` нужен, чтобы Prisma (которая резолвит путь относительно `prisma/schema.prisma`) и better-sqlite3 (которая резолвит относительно `process.cwd()`) открыли **один и тот же файл**. Если путь указать без `../`, два слоя будут писать в разные SQLite-файлы и векторная память «потеряется».

### 7. Capability tier — авто-адаптация под железо

`lib/capability-profile.ts` определяет GPU (через `nvidia-smi` / `system_profiler`), VRAM, размер модели (через Ollama `/api/show`) и классифицирует в один из 4 tier'ов:

| Tier | Условие | Стратегия | Agent limits |
|---|---|---|---|
| `micro` | ≤4B params, или CPU-only, или <8 GB VRAM | 1 LLM call, `web_search` компенсирует слабость модели, self-check OFF | 10 шагов / 10 мин |
| `standard` | 5-13B params, 8-24 GB VRAM | 1-2 LLM call, self-check на сложных задачах | 25 шагов / 1 час |
| `plus` | 14-32B params, 24-80 GB VRAM | 2-4 LLM call, deliberate + self-check | 100 шагов / 6 часов |
| `max` | 33B+ params, multi-GPU или 80+ GB VRAM | Полная когнитивная глубина, без лимитов | 500 шагов / 24 часа |

Профиль кэшируется в таблице `Setting` (ключ `capability_profile`) с TTL 1 час. Обновляется при смене модели или через `POST /api/capability/refresh`. Tier влияет на pipeline и лимиты агента; отдельного chip в шапке нет.

### 8. Cognitive depth — адаптивный pipeline

`lib/cognitive-depth.ts` комбинирует 3 сигнала:

1. **Mode** (user override): `auto` / `fast` / `standard` / `deep` / `agent`
2. **Tier** (из capability profile)
3. **Complexity** (`lib/task-complexity.ts` → regex-классификатор: `trivial` / `simple` / `moderate` / `complex` / `research`)

Результат — `ExecutionPlan`: сколько LLM-вызовов, нужны ли deliberate / self-check / autoWebSearch, maxTokens, лимиты для agent. В `auto`-mode на `micro`-tier даже сложная задача получит 1 вызов + web_search; на `max`-tier даже тривиальный вопрос не получит лишних вызовов.

### 9. Circuit breaker + LLM-error-aware loop detection

- `agent/runner.ts`: 3 consecutive `streamText` errors → задача fail'ится с понятным сообщением (вместо бесконечных ретраев).
- `agent/loop-detector.ts`: `LLM_ERROR_MARKERS` (timeout, `ECONNREFUSED`, `AI_APICallError`) НЕ считаются «пустым результатом» — иначе любая временная проблема с Ollama засчитывалась бы как empty-loop и могла преждевременно остановить задачу.
- `agent/loop-detector.ts`: pattern-loop сравнивает input через `stableStringify` (порядок ключей JSON не влияет).
- `chat/pipeline-stream.ts`: wrapped chat stream с `cancel()` — при закрытии вкладки reader освобождается сразу.
- `chat/pipeline.ts`: при падении модели — RU fallback в UI, не HTTP 500.

## Настройка через UI

Все повседневные настройки доступны в диалоге **Настройки** (иконка ⚙️):

1. **Модель** — Ollama: chat / agent / embed слоты
2. **Вид** — тема, VRM (загрузка/выбор), кадр и фон
3. **База** — Knowledge Base sources
4. **О Лии** — имя пользователя и описание продукта

Через терминал нужно только:
- Установить Ollama (один раз, системная утилита)
- Скачать модели в Ollama (`ollama pull ...`) — Ollama API не поддерживает pull программно

Всё остальное — через UI.

## Roadmap

- [x] MVP — chat, episodes, инструменты, 2D аватар
- [x] Agent runner — ReAct-loop с SSE
- [x] VRM 3D avatar — blendshapes, breathing, blink, lip-sync
- [x] 3D VRM-аватар (three.js + @pixiv/three-vrm)
- [x] Settings UI — все настройки в одном диалоге
- [x] Agent templates — `general` / `researcher` / `coder`
- [x] Resume after restart — checkpoint после каждого шага, восстановление при перезапуске
- [x] Capability tier — авто-адаптация под железо (micro / standard / plus / max)
- [x] Cognitive depth — adaptive pipeline (mode × tier × complexity)
- [x] Knowledge Base Phases 1-5 — Documents + hybrid search (vector + BM25 + RRF) + UI (см. [docs/kb/README.md](./docs/kb/README.md))
- [x] Knowledge Base Phase 7 — PDF/DOCX, URL crawler, file watcher, BM25 inverted index
- [x] ReflectionEngine — консолидация эмоциональной памяти
- [x] Core contract tests — `tests/core/**` (**118**) · **~785** collected — [docs/testing/README.md](./docs/testing/README.md)
- [ ] Local agent / coding loop — надёжность tool-calling / diff UX
- [ ] Work + memory/KB depth — groundedness, agent reliability
- [ ] Knowledge Base Phase 6 — SSH on-demand log search (отложено, см. [docs/kb/README.md](./docs/kb/README.md))

**Вне скоупа:** Voice/TTS, Tauri/mobile, multi-user/auth, plugin marketplace, паритет с облачными coding IDE.

## Документация

| Документ | Содержание |
|----------|------------|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Архитектура, chat/agent flow, memory, agent templates |
| [docs/kb/](./docs/kb/README.md) | Knowledge Base (Phases 1–5+7 ✅) |
| [docs/testing/](./docs/testing/README.md) | Стратегия тестов |
| [tests/core/README.md](./tests/core/README.md) | Core contract tests |
| [DESIGN-agent-instrument.md](./DESIGN-agent-instrument.md) | Черновик: лёгкая модель как инструмент агента |

## Диагностика проблем

Если что-то не работает — запусти диагностику:

**Быстрая (кросс-платформенная):** `bun run diagnose` — Node.js-скрипт, проверяет Ollama, БД, пути.

**Полная (с лог-файлом):**

### macOS / Linux

```bash
bash scripts/diagnose.sh
```

### Windows (PowerShell нативно, без WSL)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1
# С детализацией:
powershell -ExecutionPolicy Bypass -File scripts\diagnose.ps1 -Verbose
```

Полная диагностика сохраняет лог в `diagnose-YYYYMMDD-HHMMSS.log` — приложи его к сообщению об ошибке.

## Команды для Windows

Большинство npm-скриптов кросс-платформенные (`.mjs`). Отдельные PowerShell-варианты — только для tail логов:

| Действие | Команда |
|---|---|
| Dev-сервер | `bun run dev` |
| Тесты (CI) | `bun run test:ci` |
| Typecheck приложения и тестов | `bun run typecheck && bun run typecheck:tests` |
| Lint | `bun run lint` |
| Сборка | `bun run build` |
| Инициализация БД | `bun run db:push` (патчит схему без wipe) |
| Диагностика (быстрая) | `bun run diagnose` |
| Диагностика (полная) | `powershell -File scripts\diagnose.ps1` |
| Логи real-time | `bun run logs:tail:win` |
| Логи агента | `bun run logs:agent:win` |
| Логи ошибок | `bun run logs:errors:win` |

## Полезные команды

| Команда | Что делает |
|---|---|
| `bun run setup` | Полная настройка новой машины: .env, ключи, БД, hooks |
| `bun run setup:hooks` | Установить git pre-commit hook (защита от утечки токенов) |
| `bun run kb:backup [path]` | Атомарный backup SQLite DB (через Online Backup API) |
| `bun run diagnose` | Быстрая диагностика (Ollama, БД, пути) |
| `bun run diagnose:verbose` | То же с подробным выводом |
| `bun run test` | Vitest — все тесты |
| `bun run test:ci` | Основной CI gate (vitest) |
| `bun run typecheck` | TypeScript-проверка приложения |
| `bun run typecheck:tests` | TypeScript-проверка приложения и тестов |
| `bun run check:scripts` | Синтаксическая проверка всех JS/MJS-скриптов |
| `bun run lint` | ESLint для приложения и тестов |
| `bun run test:safe:local` | Стоп :3000 → тесты → restart |
| `bun run kb:e2e` | KB smoke: upload → chat → agent |
| `bun run db:push` | Инициализация БД + **additive schema patches** (без wipe) |
| `bun run db:patch` | Только additive patches (attachments и т.п.) |
| `bun run db:force-push` | Пересоздать БД с нуля (УДАЛЯЕТ все данные) |
| `bun run kb:export` / `kb:import` | Экспорт / импорт KB |
| `bun run ollama:backup` / `ollama:restore` | Бэкап / восстановление моделей Ollama |
| `bun run build:standalone` | Standalone Next build (deploy) |

## Отправка баг-репорта

При проблемах приложи:
1. **Лог диагностики**: `diagnose-*.log`
2. **Dev-лог**: `dev.log`
3. **GPU информация** (Windows): `nvidia-smi`
4. **Модели Ollama**: `ollama list`
5. **Шаги воспроизведения**: что делал, что ожидал, что получилось

## Лицензия

[MIT](./LICENSE) — используй, модифицируй, распространяй свободно с attribution.

Copyright © 2026 redbleach5

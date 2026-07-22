# Архитектура Лия v2

## Слои

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                          │
│  React 19 + Zustand (slices) + Tailwind 4 + shadcn/ui (Radix)   │
│  ├── page.tsx (Client) → HomeShell → ClientBootstrap (episodes, health, agent SSE)
│  ├── ChatPanel (IntersectionObserver auto-scroll)                │
│  ├── AvatarColumn (VRM, PresenceStage, agent ring/bubble) │
│  ├── HeaderStatus (чаты · образ · «Ещё»: KB, тема)              │
│  ├── AgentWorkbench (ход / правки / файлы над composer)          │
│  └── EpisodesSidebar (AlertDialog, cursor pagination)            │
├──────────────────────────────────────────────────────────────────┤
│                      Next.js API Routes                           │
│  Thin handlers: zod validation → service → response              │
│  ├── /api/chat         → lib/chat/pipeline.ts (+ phases/stream/helpers) │
│  ├── /api/agent/*      → lib/agent/runner.ts (+ runner-helpers)         │
│  ├── /api/episodes/*   → lib/memory/episodes.ts                  │
│  ├── /api/settings     → lib/ollama.ts + DB                      │
│  ├── /api/capability   → lib/capability-profile.ts (без UI-chip) │
│  ├── /api/kb/*         → lib/kb/ (search, indexer, …)            │
│  ├── /api/artifacts/[filename] → file download                   │
│  ├── /api/health       → basic health-check                      │
│  └── proxy.ts (Next.js) → X-Forwarded-For + LIA_INTERNAL_TOKEN│
├──────────────────────────────────────────────────────────────────┤
│                        Service Layer                              │
│  ├── lib/chat/         pipeline + phases/stream/helpers, deliberate, self-check │
│  ├── lib/agent/        runner + runner-helpers (ReAct, checkpoint, tools)│
│  ├── lib/memory/       episodes, facts, vector, emotional        │
│  ├── lib/kb/           Knowledge Base (Phase 1-5+7)                │
│  │   ├── chunkers/     document-chunker                          │
│  │   ├── search.ts     hybrid: vector + BM25 + RRF                 │
│  │   ├── indexer.ts    document/URL indexing + AbortController   │
│  │   ├── bm25.ts       JS BM25 (auto-switch to inverted index)   │
│  │   ├── inverted-index.ts SQLite inverted index (100k+ chunks)  │
│  │   ├── file-watcher.ts chokidar auto-reindex on file change    │
│  │   ├── rrf.ts        Reciprocal Rank Fusion                    │
│  │   ├── db-vec-kb.ts  kb_vec_virtual dual-write                 │
│  │   └── tools.ts      KB agent tools (+ codebase separately)    │
│  ├── lib/tools/        web-search, save-artifact, code-run        │
│  ├── lib/capability-profile.ts  GPU/VRAM/model → tier (+ remote Ollama pool) │
│  ├── lib/compute-budget.ts      roles + VRAM pool → headroom (observe/warn) │
│  ├── lib/cognitive-depth.ts     planExecution (mode×tier×complexity)│
│  └── lib/task-complexity.ts     regex classifier (trivial→research)│
├──────────────────────────────────────────────────────────────────┤
│                       Infrastructure                              │
│  ├── lib/db.ts         Prisma (singleton)                        │
│  ├── lib/db-vec.ts     better-sqlite3 + sqlite-vec (encapsulated)│
│  ├── lib/infra/        ssrf.ts, api-validation.ts (zod)          │
│  ├── lib/logger.ts     Pino (JSON prod, pretty dev)              │
│  ├── lib/paths.ts      cross-platform path resolution            │
│  ├── lib/rate-limit.ts per-IP rate limit (dev + prod)            │
│  └── lib/server-startup.ts startup log + sweepStaleTasks         │
├──────────────────────────────────────────────────────────────────┤
│                      External Services                            │
│  └── Ollama (LLM + embeddings)    http://127.0.0.1:11434         │
└──────────────────────────────────────────────────────────────────┘
```

## Chat message flow

```
User types message → ChatInput → useChat.sendMessage()

  ┌─ Agent mode ──────────────────────────────────────────────┐
  │ POST /api/agent { goal, autoStart }                        │
  │ → createAgentTask → runAgentTask (background)              │
  │ → SSE /api/agent/[id]/stream (real-time updates)           │
  │ → useAgentStream (ClientBootstrap) subscribes, updates store│
  │ → useAgent / AgentWorkbench — cancel, input, правки, файлы │
  └────────────────────────────────────────────────────────────┘

  ┌─ Chat mode (fast/standard/deep/auto) ─────────────────────┐
  │ POST /api/chat { text, episodeId, mode }                   │
  │ → parseBody (zod) → runChatPipeline                        │
  │                                                            │
  │ Pipeline steps:                                            │
  │ 1.  preflight (Ollama health)                              │
  │ 2.  capability (getCognitiveParams, cached 1h)             │
  │ 3.  complexity (classifyTaskComplexity, regex)             │
  │ 4.  plan (planExecution: mode × tier × complexity)         │
  │ 5.  perceive (emotion decay + regex triggers)              │
  │ 6.  disagreement (assessDisagreement)                      │
  │ 7.  save user message                                      │
  │ 8.  build context (parallel: facts, vector, emotional)     │
  │ 9.  build system prompt + messages                         │
  │ 10. deliberate (if planned, LLM call with 60s timeout)     │
  │ 11. streamText (main LLM, tools, onFinish callback)        │
  │ 12. response with metadata headers (-B64 for non-ASCII)    │
  │                                                            │
  │ onFinish (background, non-blocking):                       │
  │ ├── saveMessage (companion)                                │
  │ ├── remember (vector memory, sourceType='dialogue')        │
  │ ├── recordEmotionalAnchor (if intensity > 0.15)            │
  │ ├── extractAndSaveFacts (LLM call, background)             │
  │ └── runSelfCheck (LLM call; logs severity, no RL tables)   │
  │                                                            │
  │ Client reads stream:                                       │
  │ ├── X-Emotion-B64 header → setEmotion in store             │
  │ ├── text chunks → updateLastMessage (accumulated)          │
  │ └── done → finalizeLastMessage                             │
  └────────────────────────────────────────────────────────────┘
```

## Cognitive depth pipeline

```
User message + mode (auto/fast/standard/deep/agent)
  │
  ├─ capability-profile.ts: getCapabilityProfile()
  │   ├── detectGpu() → nvidia-smi (Linux/Win) / system_profiler (macOS)
  │   ├── fetchModelDetails(modelName) → Ollama /api/show
  │   └── classifyTier(modelSize, vramGb, gpuCount, isCpuOnly) → tier
  │       └── micro | standard | plus | max  (cached 1h в Setting)
  │
  ├─ task-complexity.ts: classifyTaskComplexity(text)
  │   └── trivial | simple | moderate | complex | research (regex)
  │
  └─ cognitive-depth.ts: planExecution(mode, tier, complexity)
      └── ExecutionPlan { calls, deliberate, selfCheck, maxTokens,
                          toolsEnabled, autoWebSearch }

  Tier → CognitiveParams (defaults):
  ├── micro:    1 call,  deliberate=false, selfCheck=false, autoWebSearch=true,  agent 10/10min
  ├── standard: 2 calls, deliberate=false, selfCheck=true,  autoWebSearch=true,  agent 25/1h
  ├── plus:     3 calls, deliberate=true,  selfCheck=true,  autoWebSearch=false, agent 100/6h
  └── max:      4 calls, deliberate=true,  selfCheck=true,  autoWebSearch=false, agent 500/24h

  Mode overrides (if user explicitly picked):
  ├── fast:     1 call, deliberate=false, selfCheck=false, tools=false
  ├── standard: 1 call, deliberate=false, selfCheck=false, tools=true
  ├── deep:     3 calls, deliberate=true, selfCheck=true
  └── agent:    0 chat calls (ReAct-loop in runner.ts instead)
```

## Agent task flow

### Workspace, KB, and tool lock (gotchas)

- **Agent workspace.** `resolveWorkspace` (`workspace-binding.ts`): explicit `fsScope` → **episode binding** (`EpisodeFact` `lia.workspace`) → `LIA_AGENT_DEFAULT_WORKSPACE` → ready KB folder/codebase whose **name** appears in the goal → Lia `PATHS.root` only if the goal mentions Lia (or `LIA_AGENT_MOUNT_SELF=true`) → coding sandbox → none. UI: chat header `WorkspaceBadge`. KB pin (`sourceIds`) hard-filters proactive search + `search_sources` (override: `searchEverywhere=true`). See `docs/drafts/workspace.md`.
- **Workspace modes (Phase 4).** `read` / `explore` / `edit` (`workspace-modes.ts`): tool whitelist + no write-sandbox for Read/Explore; Edit without project/KB → HTTP 409 `sandbox_confirm_required` until confirm. UI: `AgentWorkspaceModeSelector` next to Диалог/Агент.
- **Workspace memory (Phase 5).** Durable `GlobalFact` keys `workspace.<fingerprint>.*` — same project/KB pin across episodes injects remembered label/path/overview into chat + agent prompts. UI: Workspace → «Что Лия помнит…».
- **Workspace UX (Phase 6).** Citations `[text](#source:id[:chunkId])` open modal + scroll to chunk; empty-state copy; pinned KB index status on badge; click file change → preview in workspace tree.
- **Code exploration seed.** `docs/ARCHITECTURE.md` + key paths only when `fsScope` is Lia root.
- **KB-only whitelist** applies only to **pure lookup** goals (`isKbLookupGoal`: «найди/опиши … в базе знаний»). Mentions like «проект в базе знаний» + code exploration do **not** strip `search_codebase`.
- **folder vs codebase:** folder indexer indexes documents; use a separate **codebase** source for semantic `search_codebase`. Prefer `grep` for exact symbols when a real `fsScope` is mounted.
- **ГОТОВО:** only a line-start `ГОТОВО:` / `DONE:` ends the loop; ignored after empty tree / path errors. Early KB finalize needs deep read or ≥2 successful KB steps.

```
POST /api/agent { goal, autoStart: true }
  │
  ├─ createAgentTask → DB insert (status: pending)
  ├─ runAgentTask(taskId) — background
  │
  └─ runAgentTask:
     ├── Pre-flight: Ollama check
     ├── PLAN (or RESUME from checkpoint)
     │   ├── If checkpointJson exists:
     │   │   ├── Parse { plan, steps, savedAt }
     │   │   ├── Skip PLAN — restore plan + steps
     │   │   └── Emit replay events for UI
     │   └── Else:
     │       ├── generatePlan (LLM, AbortSignal.timeout)
     │       └── Save planJson
     │
     ├── EXECUTE LOOP (for i = steps.length; i < maxSteps; i++)
     │   ├── Check cancellation (isCancelled)
     │   ├── Check budget (ask user to extend if exceeded)
     │   ├── Loop detection (pattern, empty, semantic)
     │   │   └── LLM_ERROR_MARKERS (timeout, ECONNREFUSED) НЕ считаются empty
     │   ├── buildStepMessages (plan + previous steps + tools)
     │   ├── executeStep:
     │   │   ├── Attempt 1: streamText with tools
     │   │   ├── Attempt 2: without tools (fallback)
     │   │   └── Circuit breaker: 3 consecutive stream errors → fail task
     │   ├── Save checkpoint: { plan, steps, savedAt }
     │   ├── Emit step_end event (SSE)
     │   └── Check "ГОТОВО" signal → break
     │
     ├── SYNTHESIZE (LLM, AbortSignal.timeout)
     │   └── Final summary from all steps
     │
     ├── Update task: done, resultSummary, checkpointJson: null
     └── Emit task_done

  Cancel: POST /api/agent/[id]/cancel
    → signalCancellation + cancelWaiting + abortTask (AbortController)
    → streamText gets abort, exits cleanly

  Resume after restart:
    → server-startup.ts на старте процесса вызывает sweepStaleTasks()
    → executing+checkpoint → pending (resumable)
    → planning/synthesizing/waiting_input без checkpoint → failed
    → POST /api/agent/[id]/start → runAgentTask
    → checkpointJson exists → skip PLAN, continue from steps.length
    → (дополнительный lazy sweep в GET /api/agent как safety net)
```

## Agent templates (root tasks)

Один агент на задачу. Presets задают промпт и whitelist инструментов:

| Name | Назначение |
|------|------------|
| `general` | Все инструменты |
| `researcher` | Web + KB + чтение файлов |
| `coder` | FS, grep, run_command, codebase |

Точные whitelist — в `src/lib/agent/templates.ts`. `POST /api/agent` принимает optional `template`.

Template подставляет defaults для `toolsWhitelist`, `maxSteps`, `maxDurationSec`; явные поля в запросе имеют приоритет.

## RL feedback loop — removed (2026-07)

Python sidecar, `src/lib/rl/`, `/api/rl/*`, Learning tab и RL tables
(`RLExperience`, `RlModelVersion`) удалены. Тон ответа = inner monologue
(`liaDecision`). Self-check остаётся (tier-gated) и только логирует severity.

Orphan SQLite tables may remain until an optional `db:push`; Prisma client
no longer references them.

## Memory architecture

```
┌──────────────────────── SQLite (custom.db) ────────────────────────┐
│                                                                     │
│  Prisma-managed tables:                                            │
│  ├── Episode / Message / ChatAttachment                            │
│  ├── GlobalFact / EpisodeFact                                      │
│  ├── VectorMemory / EmotionalMemory                                │
│  ├── AgentTask (plan/steps/checkpoint, fsScope, toolsWhitelist,    │
│  │              artifactsJson)                                     │
│  ├── Setting (ollama, capability_profile, artifacts, …)            │
│  ├── Source / Chunk  (Knowledge Base)                              │
│                                                                     │
│  Raw SQL tables (vec0 extension, encapsulated in db-vec.ts):       │
│  ├── vec_virtual      (vec0: embedding float[768], episode_id,     │
│  │                     source_type) — KNN search index             │
│  └── vec_rowid_map    (rowid → vector_id, episode_id)              │
│                                                                     │
│  KB vec (db-vec-kb.ts): kb_vec_virtual + kb_rowid_map              │
│  (+ inverted index / FTS5 — см. docs/kb/)                          │
│                                                                     │
│  Dual-write (transactional):                                       │
│  ├── insertVectorMemory: VectorMemory + vec_virtual + rowid_map   │
│  ├── insertEmotionalVectorIndex: vec_virtual + rowid_map           │
│  └── deleteVectorsInEpisode: all three in transaction              │
│                                                                     │
│  Source types (no cross-contamination):                            │
│  ├── 'dialogue'  — реплики чата                                    │
│  ├── 'fact'      — извлечённые факты (fact-extraction.ts)        │
│  ├── 'summary'   — итоги agent-задач (runner.ts task_done)         │
│  │   recall() в chat pipeline ищет dialogue + fact + summary       │
│  └── 'emotional' — recallEmotionalAnchors (отдельно)               │
│                                                                     │
│  EmotionalMemory:                                                  │
│  ├── decay: halfTime=180 дней (emotional-memory.ts)                │
│  ├── anti-pattern "не бередить раны": warning при past ≥0.8 +      │
│  │   current neutral                                               │
│  └── consolidated/sourceIds — заполняются ReflectionEngine         │
│      (`src/lib/memory/reflection-engine.ts`; summary → vec_virtual) │
│                                                                     │
│  AgentTask.artifactsJson:                                           │
│  ├── JSON inline: [{ kind, path, meta }]                            │
│  ├── Дополнительно: Setting ключ `artifact:<id>`                    │
│  └── (Отдельная таблица AgentArtifact удалена из схемы — не исп.)   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## State management

```
Zustand store (4 slices + devtools + persist):

  episodesSlice    episodes[], currentEpisodeId
                   setEpisodes, addEpisode, removeEpisode, setCurrentEpisode
                   
  messagesSlice    messages[], emotion, isStreaming, mode
                   setMessages, addMessage, updateLastMessage, finalizeLastMessage
                   setEmotion, setStreaming, setMode
                   
  agentSlice       agentTasks[], activeTaskId, activeTaskStatus,
                   activeTaskPlan, activeTaskSteps, activeTaskQuestion,
                   activeTaskResult, activeTaskError, activeTaskArtifacts
                   setActiveTask, addActiveTaskStep, resetActiveTask, ...
                   
  healthSlice      ollamaOk, ollamaError
                   setOllamaHealth

  Middleware:
  ├── devtools    — Redux DevTools integration
  └── persist     — mode saved to localStorage (user preference survives reload)
```

## Error handling strategy

```
Panel-level (React Error Boundary):
  PanelErrorBoundary → fallback UI with "Попробовать снова"
  ├── AgentWorkbench
  ├── ChatPanel / AvatarColumn
  └── (VRM already has VrmErrorBoundary)

Route-level:
  Global error.tsx → fallback for entire page crash
  Loading.tsx → initial load state

Service-level:
  try/catch + logger.warn/error (non-fatal — chat continues)
  ├── Memory operations (remember, recall) — silent failure, log
  └── Self-check — log only, doesn't block response

Streaming-level:
  AbortSignal.timeout on all LLM calls (no Promise.race leaks)
  ├── Plan generation: LLM_TIMEOUT_MS (3 min)
  ├── Step execution: LLM_TIMEOUT_MS (3 min)
  ├── Synthesis: SYNTHESIS_TIMEOUT_MS (4 min)
  ├── Deliberate: 60s
  └── Self-check: 60s

Agent watchdog:
  Wall-time scales with task.maxDurationSec (tier-dependent:
  micro=10min, standard=1h, plus=6h, max=24h)
  → abortTask() sends AbortController signal to active streamText

Circuit breaker:
  3 consecutive streamText errors → fail task с понятным сообщением
  (защита от бесконечных ретраев при устойчивой проблеме с LLM)

Loop detector (LLM-error-aware):
  LLM_ERROR_MARKERS (timeout, ECONNREFUSED, AI_APICallError)
  НЕ считаются «пустым результатом» — иначе временная проблема с
  Ollama засчитывалась бы как empty-loop и могла прервать задачу.
```

## Knowledge Base search pipeline

```
User asks question in chat
  → Лия decides to use search_sources tool (system prompt instructs)
  → search_sources → searchKB({ query, sourceTypes, limit })

Pipeline (lib/kb/search.ts):
  1. Parallel: vector search + BM25 keyword search
     ├── Vector: embed(query) → searchKbVectors (kb_vec_virtual KNN)
     │   └── pre-filter by source_id / source_type
     │   └── over-fetch topK*4 (mitigate KNN + partition filter)
     └── BM25: bm25Search (linear scan over Chunk table)
         └── Unicode tokenizer, EN+RU stopwords, k1=1.5 b=0.75

  2. RRF fusion: rrf([vectorHits, bm25Hits], k=60)
     └── combines ranks without score normalization

  3. Metadata post-filter (state, assignee, project, heading where applicable)

  4. Enrich with citation ("Source > Heading" for docs; legacy ticket id in metadata if any)

  5. Return to Лия → she includes [citation](#source:SOURCE_ID) in answer

Citation rendering:
  markdown-renderer.tsx catches href="#source:..."
  → renders as clickable badge
  → click opens SourceDetailModal with full chunk list

Indexing pipeline (lib/kb/indexer.ts):
  1. Parse file → markdown
     ├── .md/.txt — native UTF-8 read
     ├── .pdf — pdf-parse v2 (PDFParse.getText())
     └── .docx/.doc — mammoth (DOCX → HTML → htmlToMarkdown)
  2. Chunk (DocumentChunker: headings + paragraphs + overlap)
  3. Incremental reindex ([docs/kb](./kb/operations.md) optimization):
     ├── Load existing chunks by contentHash
     ├── Reuse unchanged (skip embedding — 20× faster for small edits)
     ├── Embed only new/changed chunks (batch 8 parallel)
     └── Delete chunks no longer in document
  4. Dual-write: Prisma Chunk + kb_vec_virtual (transactional)
  5. Inverted index: addToInvertedIndex (Phase 7) — term → chunk_id, tf, doc_length
  6. EventEmitter emits progress → SSE stream → UI toasts

URL indexing (lib/kb/indexer.ts: indexUrlSource):
  1. Fetch URL (SSRF protection via assertSafeUrl)
  2. Parse HTML через jsdom → extract via @mozilla/readability
  3. Build markdown: # title + source URL + article text
  4. Chunk + embed (reuses document indexing logic with incremental reindex)

File watcher (lib/kb/file-watcher.ts, Phase 7):
  chokidar watches kb-uploads/ directory
  ├── On file change → debounce 2 sec
  ├── Find document sources with matching filePath
  └── Trigger auto-reindex (indexDocumentSource)

BM25 scalability (lib/kb/bm25.ts + inverted-index.ts):
  ├── < 5000 chunks: linear scan O(N×Q) — simpler, no index overhead
  └── > 5000 chunks: auto-switch to inverted index O(Q×postings)
      SQLite table kb_inverted_index (term, chunk_id, tf, doc_length)
      Maintained on every chunk insert/delete
      Light stemmer (Russian + English) ~80% wordform coverage
      Cached corpus stats: kb_index_stats (total_docs, avg_doc_length)
                          + kb_term_df (per-term document frequency)
      KB_TOKENIZER_VERSION — auto-reindex на смену стеммера/токенизатора

KB security & integrity (см. docs/kb/operations.md):
  Atomic dual-write (Prisma + better-sqlite3)
  ├── Silent try/catch убран из deleteKbVector/removeFromInvertedIndex
  ├── Rollback Prisma chunk при ошибке insertKbVector
  ├── DELETE source: sqlite first, потом Prisma (идемпотентно при retry)
  ├── Lazy ghost cleanup в search.ts/bm25.ts (setImmediate fire-and-forget)
  └── Periodic reconciliation job (src/lib/kb/reconcile.ts, каждые 10 мин)

  Schema versioning для raw SQL таблиц
  ├── kb_schema_version (name, version, updated_at)
  ├── KB_VEC_SCHEMA_VERSION — DROP + CREATE + auto-reindex при bump
  └── KB_TOKENIZER_VERSION — clearInvertedIndex + auto-reindex при bump

  KB utilities
  ├── bun run setup — full onboarding (.env, ключи, БД, hooks)
  ├── bun run kb:backup [path] — atomic SQLite Online Backup
  ├── bun run setup:hooks — git pre-commit hook для детекции утечки токенов
  ├── GET /api/kb/health — sources stats, chunkVectorDrift, encryption status
  └── .github/workflows/ci.yml — tsc --noEmit + vitest на каждый PR
```

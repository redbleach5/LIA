# DESIGN: Agentic chat parts protocol

> Draft for Cursor-like inline agent UX (plan rev.2).  
> Code: `src/lib/agent/message-parts.ts`

## Source of truth

One agent turn = one chat message with `parts: MessagePart[]`.

- SSE `AgentEvent` / `AgentPartEvent` → **only** `reduceAgentParts`
- Chat bubble renders **only** `parts`
- Workbench may mirror the same state; it must not write into the bubble

## MessagePart union

| type | Role |
|------|------|
| `status` | planning / executing / waiting_input / synthesizing / done / failed / cancelled |
| `plan` | goal + step titles |
| `text` | assistant prose (deltas accumulate into one part) |
| `tool_call` | tool card; `collapsed` when done |
| `edit_proposed` | pending Apply (ask mode) |
| `edit_applied` / `edit_rejected` | after user/auto decision |
| `ask` | ask_user question |
| `permission_request` | shell / network / mcp / write |
| `runtime_log` | stdout/stderr snippet |

## Event → mutation

See `reduceAgentParts` in `message-parts.ts`. Key rules:

1. **Idempotency:** each event has `eventId` or a derived key; duplicates no-op (reconnect safe).
2. **`task_done`:** upserts status + merges `resultSummary` into text part — does not invent a second message truth.
3. **`file_changed` + `pending: true`:** → `edit_proposed`; else → `edit_applied`.
4. **Tool end:** auto-`collapsed: true` for perf.

## Perf defaults

- `MAX_EXPANDED_DIFFS = 3` (UI)
- `DIFF_PREVIEW_CHARS = 4000` (UI truncate)
- Completed tools show one-line `summary`

## Apply gate (P3)

- Sticky client preference `agentApplyMode`: `ask` (default) | `auto`
- Persisted in `localStorage` (`lia.agentApplyMode`); sent as `applyMode` on `POST /api/agent`
- UI: workspace mode badge shield/zap + menu; hotkey **Ctrl+Shift+A**
- First switch to auto shows a short confirm
- Ask: `write_file` / `edit_file` stage `edit_proposed` (disk untouched; `read_file` sees overlay)
- APIs: `POST /api/agent/:id/file-apply` `{ changeId }`, `{ changeId, reject: true }`, `{ all: true }`
- Rollback: `POST /api/agent/:id/rollback` (git snapshot if available, else undo stack)

## Mentions / rules (P2)

- Goal may include `@file:path`, `@folder:path`, optional `#L10-40`
- Loader: `AGENTS.md` / `.lia/rules.md` / `.cursorrules` with caps + signature compress for large files

## Metrics (`AgentTurnMetrics`)

- `startedAt`, `firstTextAt` (TTFT)
- `toolStarts` / `toolSuccesses` / `toolFailures`
- `applyAccepts` / `applyRejects`

Log via `logger.debug('agent', 'turn metrics', metrics)` when task completes.

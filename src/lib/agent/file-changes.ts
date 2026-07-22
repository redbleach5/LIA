import 'server-only';

// ============================================================================
// Agent file-change undo stack (review / revert applied edits).
// ============================================================================
// edit_file / write_file still write immediately (agent must see changes).
// Short in-memory previous-content stack for UI Undo. HMR-safe via globalThis.
// Not durable across process restarts — OK for local-first.

import { unlink } from 'node:fs/promises';
import { safeWriteFile, safePathWithinScope } from './fs-scope';
import { emitAgentEvent } from './events';
import { logger } from '@/lib/logger';

const MAX_PREV_CHARS = 200_000;
const MAX_DIFF_CHARS = 8_000;
const MAX_PER_TASK = 20;

export type FileChangeRecord = {
  id: string;
  taskId: string;
  path: string;
  tool: 'edit_file' | 'write_file';
  /** Present when undo can restore prior text. */
  previousContent?: string;
  /** True when write_file created a new file (undo = delete). */
  created: boolean;
  canUndo: boolean;
  diff?: string;
  createdAt: number;
};

type Store = Map<string, FileChangeRecord[]>;

const globalKey = '__lia_file_changes__';
function getStore(): Store {
  const g = globalThis as unknown as { [key: string]: Store | undefined };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n…[truncated]';
}

export function recordFileChange(params: {
  taskId: string;
  path: string;
  tool: 'edit_file' | 'write_file';
  /** null = file did not exist before write. */
  previousContent: string | null;
  diff?: string;
  step?: number;
}): FileChangeRecord {
  const id = crypto.randomUUID();
  const created = params.previousContent === null;

  let canUndo = true;
  let previousContent: string | undefined;
  if (created) {
    previousContent = undefined;
  } else if (params.previousContent!.length > MAX_PREV_CHARS) {
    canUndo = false;
    logger.debug('agent', 'file change previousContent too large — undo disabled', {
      path: params.path,
      taskId: params.taskId.slice(0, 8),
    });
  } else {
    previousContent = params.previousContent!;
  }

  const record: FileChangeRecord = {
    id,
    taskId: params.taskId,
    path: params.path,
    tool: params.tool,
    previousContent,
    created,
    canUndo,
    diff: params.diff ? truncate(params.diff, MAX_DIFF_CHARS) : undefined,
    createdAt: Date.now(),
  };

  const store = getStore();
  const list = store.get(params.taskId) ?? [];
  list.push(record);
  while (list.length > MAX_PER_TASK) list.shift();
  store.set(params.taskId, list);

  emitAgentEvent({
    type: 'file_changed',
    taskId: params.taskId,
    step: params.step ?? 0,
    changeId: id,
    path: params.path,
    tool: params.tool,
    diff: record.diff,
    canUndo,
    ts: record.createdAt,
  });

  return record;
}

export function getFileChange(taskId: string, changeId: string): FileChangeRecord | null {
  const list = getStore().get(taskId) ?? [];
  return list.find(c => c.id === changeId) ?? null;
}

export function removeFileChange(taskId: string, changeId: string): void {
  const store = getStore();
  const list = store.get(taskId);
  if (!list) return;
  const next = list.filter(c => c.id !== changeId);
  if (next.length === 0) store.delete(taskId);
  else store.set(taskId, next);
}

export function clearFileChanges(taskId: string): void {
  getStore().delete(taskId);
}

/** Restore previous content or delete if the file was created. */
export async function undoFileChange(
  taskId: string,
  changeId: string,
  fsScope: string | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const record = getFileChange(taskId, changeId);
  if (!record) return { ok: false, error: 'change not found (expired or already undone)' };
  if (!record.canUndo) return { ok: false, error: 'undo not available for this change' };
  if (!fsScope) return { ok: false, error: 'no fsScope on task' };

  const fullPath = await safePathWithinScope(record.path, fsScope);
  if (!fullPath) return { ok: false, error: 'path outside fsScope' };

  try {
    if (record.created) {
      await unlink(fullPath);
    } else if (record.previousContent !== undefined) {
      await safeWriteFile(record.path, fsScope, record.previousContent);
    } else {
      return { ok: false, error: 'undo not available for this change' };
    }
    removeFileChange(taskId, changeId);
    logger.info('agent', 'file change undone', {
      taskId: taskId.slice(0, 8),
      path: record.path,
      changeId: changeId.slice(0, 8),
    });
    return { ok: true, path: record.path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Undo all undoable changes for a task in LIFO order (newest first).
 * Required so stacked edits on the same path restore correctly.
 */
export async function undoAllFileChanges(
  taskId: string,
  fsScope: string | null,
): Promise<{ ok: true; undone: string[]; skipped: Array<{ path: string; error: string }> }> {
  const list = [...(getStore().get(taskId) ?? [])];
  const undone: string[] = [];
  const skipped: Array<{ path: string; error: string }> = [];

  for (let i = list.length - 1; i >= 0; i--) {
    const rec = list[i];
    if (!rec.canUndo) {
      skipped.push({ path: rec.path, error: 'undo not available' });
      continue;
    }
    // May already be removed by a previous undo in this loop
    if (!getFileChange(taskId, rec.id)) continue;
    const result = await undoFileChange(taskId, rec.id, fsScope);
    if (result.ok) undone.push(result.path);
    else skipped.push({ path: rec.path, error: result.error });
  }

  return { ok: true, undone, skipped };
}

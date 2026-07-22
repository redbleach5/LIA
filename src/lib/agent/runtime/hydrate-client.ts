'use client';

// Hydrate Create Runtime Studio (design / logs / preview) after reload or task select.

import { useChatStore } from '@/stores/chat-store';
import type { ProjectDesignLive, RuntimeLogLive, RuntimeStatusLive } from '@/stores/slices/types';

type RuntimeApiPayload = {
  design?: ProjectDesignLive | null;
  snapshot?: {
    status?: string;
    port?: number | null;
    previewUrl?: string | null;
    pid?: number | null;
    restartCount?: number;
    lastError?: string | null;
    scriptKey?: string | null;
  } | null;
  logs?: Array<{ stream?: string; text?: string; ts?: number }>;
};

function toDesignLive(raw: ProjectDesignLive): ProjectDesignLive {
  return {
    name: String(raw.name ?? ''),
    kind: String(raw.kind ?? ''),
    stack: Array.isArray(raw.stack) ? raw.stack.map(String) : [],
    tree: Array.isArray(raw.tree)
      ? raw.tree.map((t) => ({ path: String(t.path ?? ''), role: String(t.role ?? '') }))
      : [],
    scripts: (raw.scripts && typeof raw.scripts === 'object') ? raw.scripts : {},
    preview: raw.preview && typeof raw.preview === 'object'
      ? {
          type: String(raw.preview.type ?? 'none'),
          port: typeof raw.preview.port === 'number' ? raw.preview.port : undefined,
          url: typeof raw.preview.url === 'string' ? raw.preview.url : undefined,
        }
      : { type: 'none' },
    entry: typeof raw.entry === 'string' ? raw.entry : undefined,
    acceptance: String(raw.acceptance ?? ''),
    createdBy: 'lia',
  };
}

/** Apply GET /api/agent/:id/runtime payload into the active-task studio slices. */
export function applyCreateRuntimeHydration(taskId: string, data: RuntimeApiPayload) {
  const store = useChatStore.getState();
  if (store.activeTaskId !== taskId) return;

  if (data.design) {
    store.setActiveTaskDesign(toDesignLive(data.design));
  }

  if (data.snapshot?.status) {
    const runtime: RuntimeStatusLive = {
      status: String(data.snapshot.status),
      port: data.snapshot.port ?? null,
      previewUrl: data.snapshot.previewUrl ?? null,
      pid: data.snapshot.pid ?? null,
      restartCount: data.snapshot.restartCount,
      lastError: data.snapshot.lastError ?? null,
      scriptKey: data.snapshot.scriptKey ?? null,
    };
    // If process died but design has iframe port, still expose preview URL for reopen.
    if (!runtime.previewUrl && data.design?.preview?.type === 'iframe' && data.design.preview.port) {
      runtime.previewUrl = `http://127.0.0.1:${data.design.preview.port}`;
    }
    store.setActiveTaskRuntime(runtime);
  } else if (data.design?.preview?.type === 'iframe' && data.design.preview.port) {
    store.setActiveTaskRuntime({
      status: 'idle',
      port: data.design.preview.port,
      previewUrl: `http://127.0.0.1:${data.design.preview.port}`,
      pid: null,
      lastError: null,
    });
  }

  if (Array.isArray(data.logs) && data.logs.length > 0) {
    store.clearActiveTaskRuntimeLogs();
    for (const line of data.logs) {
      if (!line?.text) continue;
      const stream: RuntimeLogLive['stream'] =
        line.stream === 'stderr' || line.stream === 'system' ? line.stream : 'stdout';
      store.addActiveTaskRuntimeLog({
        stream,
        text: String(line.text),
        ts: Number(line.ts ?? Date.now()),
      });
    }
  }
}

export async function hydrateCreateRuntimeStudio(taskId: string): Promise<void> {
  try {
    const res = await fetch(`/api/agent/${taskId}/runtime`);
    if (!res.ok) return;
    if (useChatStore.getState().activeTaskId !== taskId) return;
    const data = (await res.json()) as RuntimeApiPayload;
    if (useChatStore.getState().activeTaskId !== taskId) return;
    applyCreateRuntimeHydration(taskId, data);
  } catch (e) {
    console.warn('[create-runtime] hydrate failed:', e);
  }
}

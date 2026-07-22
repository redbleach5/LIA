'use client';

import { useEffect, useRef } from 'react';
import { useChatStore, type AgentTask } from '@/stores/chat-store';
import type { AgentPlanLive, AgentStepLive } from '@/stores/slices/types';
import { mergeAgentSteps } from '@/lib/agent/step-merge';

type StreamCtx = {
  activeTaskId: string;
  /** Captured at SSE subscribe — survives episode switch clearing agentTasks. */
  taskEpisodeId: string | null;
  updateAgentTaskInList: (id: string, patch: Partial<AgentTask>) => void;
};

function parseEventData(e: Event): Record<string, unknown> | null {
  try {
    return JSON.parse((e as MessageEvent).data);
  } catch {
    return null;
  }
}

function applyTerminalStatus(
  ctx: StreamCtx,
  status: 'done' | 'failed' | 'cancelled',
  patch: Partial<AgentTask>,
  opts?: { chatMessageId?: string; chatContent?: string },
) {
  const store = useChatStore.getState();
  store.setActiveTaskStatus(status);
  // UI-C1 fix: always set result/error even if empty — caller may have
  // passed an empty string to clear a stale value.
  if (status === 'done') {
    store.setActiveTaskResult(patch.resultSummary ?? '');
  }
  if (status === 'failed') {
    store.setActiveTaskError(patch.error ?? 'unknown error');
  }
  ctx.updateAgentTaskInList(ctx.activeTaskId, { status, ...patch });

  // Mirror final answer into the main chat list (server also persists to DB).
  // Only when the user is still viewing the task's episode — otherwise the
  // message would land in the wrong chat (DB is already correct for the task episode).
  const content = opts?.chatContent?.trim();
  if (content && (status === 'done' || status === 'failed')) {
    const taskEpisodeId = ctx.taskEpisodeId
      ?? store.agentTasks.find(t => t.id === ctx.activeTaskId)?.episodeId
      ?? null;
    if (!taskEpisodeId || store.currentEpisodeId !== taskEpisodeId) {
      return;
    }
    const id = opts?.chatMessageId;
    const already = id
      ? store.messages.some(m => m.id === id)
      : store.messages.some(m => m.role === 'companion' && m.content === content);
    if (!already) {
      store.addMessage({
        id: id ?? crypto.randomUUID(),
        role: 'companion',
        content,
        createdAt: Date.now(),
      });
    }
  }
}

function createSseHandlers(ctx: StreamCtx): Record<string, (e: Event) => void> {
  return {
    task_init: (e) => {
      const task = parseEventData(e);
      if (!task) return;
      if (typeof task.episodeId === 'string') {
        ctx.taskEpisodeId = task.episodeId;
      }
      const store = useChatStore.getState();
      store.setActiveTaskStatus(task.status as AgentTask['status']);
      store.setActiveTaskPlan(null);
      useChatStore.setState({ activeTaskSteps: [] });
      store.setActiveTaskQuestion(null);
      useChatStore.setState({ activeTaskArtifacts: [] });
      useChatStore.setState({ activeTaskFileChanges: [] });
      if (task.status === 'failed' && task.error) {
        store.setActiveTaskError(String(task.error));
      } else {
        store.setActiveTaskError(null);
      }
      if (task.status === 'done' && task.resultSummary) {
        store.setActiveTaskResult(String(task.resultSummary));
      } else {
        store.setActiveTaskResult(null);
      }
      // Keep fsScope on the task list so workspace UI can show project vs sandbox.
      if (typeof task.id === 'string') {
        ctx.updateAgentTaskInList(task.id, {
          fsScope: task.fsScope != null ? String(task.fsScope) : null,
          ...(typeof task.episodeId === 'string' ? { episodeId: task.episodeId } : {}),
        });
      }
    },
    task_planning: () => {
      useChatStore.getState().setActiveTaskStatus('planning');
    },
    task_plan_ready: (e) => {
      const data = parseEventData(e);
      if (!data?.plan) return;
      useChatStore.getState().setActiveTaskPlan(data.plan as AgentPlanLive);
      useChatStore.getState().setActiveTaskStatus('executing');
    },
    step_start: (e) => {
      const data = parseEventData(e);
      if (!data) return;
      const step = Number(data.step);
      useChatStore.getState().addActiveTaskStep({
        step,
        thought: String(data.thought ?? ''),
        action: '',
        observation: '',
        ts: Number(data.ts),
      });
      const patch: Partial<AgentTask> = {};
      if (Number.isFinite(step) && step > 0) patch.currentStep = step;
      const maxSteps = Number(data.maxSteps);
      if (Number.isFinite(maxSteps) && maxSteps > 0) patch.maxSteps = maxSteps;
      if (Object.keys(patch).length > 0) {
        ctx.updateAgentTaskInList(ctx.activeTaskId, patch);
      }
    },
    step_end: (e) => {
      const data = parseEventData(e);
      if (!data) return;
      const store = useChatStore.getState();
      const step = Number(data.step);
      if (!store.activeTaskSteps.some(st => st.step === step)) {
        store.addActiveTaskStep({
          step,
          thought: '',
          action: '',
          observation: '',
          ts: Number(data.ts),
        });
      }
      store.updateActiveTaskStep(step, {
        action: String(data.action ?? ''),
        thought: String(data.thought ?? ''),
        observation: String(data.observation ?? ''),
        durationMs: Number(data.durationMs ?? 0),
      });
      // Keep task list counter in sync with live SSE (panel shows currentStep/maxSteps).
      ctx.updateAgentTaskInList(ctx.activeTaskId, { currentStep: step });
    },
    tool_start: (e) => {
      const data = parseEventData(e);
      if (!data) return;
      const store = useChatStore.getState();
      const step = Number(data.step);
      const tool = String(data.tool ?? '');
      if (!tool || !Number.isFinite(step)) return;

      if (!store.activeTaskSteps.some(st => st.step === step)) {
        store.addActiveTaskStep({
          step,
          thought: '',
          action: tool,
          observation: '',
          tools: [{ name: tool, input: data.input, success: false, output: null }],
          ts: Number(data.ts ?? Date.now()),
        });
        return;
      }

      const existing = store.activeTaskSteps.find(st => st.step === step);
      const prevTools = existing?.tools ?? [];
      store.updateActiveTaskStep(step, {
        action: tool,
        tools: [...prevTools, { name: tool, input: data.input, success: false, output: null }],
      });
    },
    tool_end: (e) => {
      const data = parseEventData(e);
      if (!data) return;
      const store = useChatStore.getState();
      const step = Number(data.step);
      const tool = String(data.tool ?? '');
      if (!tool || !Number.isFinite(step)) return;

      const existing = store.activeTaskSteps.find(st => st.step === step);
      const prevTools = existing?.tools ?? [];
      // Mark the last matching in-flight tool call as finished.
      let marked = false;
      const nextTools = [...prevTools].reverse().map((t) => {
        if (!marked && t.name === tool && t.success === false && t.output == null) {
          marked = true;
          return {
            ...t,
            success: Boolean(data.success),
            output: data.output ?? null,
          };
        }
        return t;
      }).reverse();

      if (!marked) {
        nextTools.push({
          name: tool,
          input: null,
          success: Boolean(data.success),
          output: data.output ?? null,
        });
      }

      const names = nextTools.map(t => t.name);
      const uniqueJoined = names.filter((n, i) => names.indexOf(n) === i).join(' + ');
      store.updateActiveTaskStep(step, {
        action: uniqueJoined || tool,
        tools: nextTools,
      });
    },
    task_waiting_input: (e) => {
      const data = parseEventData(e);
      if (!data?.question) return;
      useChatStore.getState().setActiveTaskStatus('waiting_input');
      useChatStore.getState().setActiveTaskQuestion(String(data.question));
    },
    task_synthesizing: () => {
      useChatStore.getState().setActiveTaskStatus('synthesizing');
    },
    task_done: (e) => {
      // UI-C1 fix: previously `if (!data?.resultSummary) return;` — if the
      // server emitted task_done without resultSummary (empty result,
      // schema drift, cancelled-then-done), the handler silently returned
      // and activeTaskStatus stayed at 'synthesizing' forever. Now we
      // ALWAYS apply the terminal status; only include the field if present.
      const data = parseEventData(e) ?? {};
      const resultSummary = data.resultSummary != null ? String(data.resultSummary) : '';
      applyTerminalStatus(
        ctx,
        'done',
        { resultSummary },
        {
          chatMessageId: data.chatMessageId ? String(data.chatMessageId) : undefined,
          chatContent: resultSummary,
        },
      );
    },
    task_failed: (e) => {
      // UI-C1 fix: same — always apply terminal status.
      const data = parseEventData(e) ?? {};
      const error = String(data.error ?? 'unknown error');
      applyTerminalStatus(
        ctx,
        'failed',
        { error },
        {
          chatMessageId: data.chatMessageId ? String(data.chatMessageId) : undefined,
          chatContent: `Не удалось выполнить задачу.\n\n${error}`,
        },
      );
    },
    task_cancelled: () => {
      applyTerminalStatus(ctx, 'cancelled', {});
    },
    artifact_saved: (e) => {
      const data = parseEventData(e);
      if (!data?.filename || !data?.url) return;
      useChatStore.getState().addActiveTaskArtifact({
        filename: String(data.filename),
        url: String(data.url),
        step: Number(data.step ?? 0),
      });
    },
    file_changed: (e) => {
      const data = parseEventData(e);
      if (!data?.changeId || !data?.path) return;
      useChatStore.getState().addActiveTaskFileChange({
        changeId: String(data.changeId),
        path: String(data.path),
        tool: data.tool === 'write_file' ? 'write_file' : 'edit_file',
        diff: typeof data.diff === 'string' ? data.diff : undefined,
        canUndo: data.canUndo !== false,
        step: Number(data.step ?? 0),
        ts: Number(data.ts ?? Date.now()),
      });
    },
  };
}

export function useAgentStream() {
  const updateAgentTaskInList = useChatStore(s => s.updateAgentTaskInList);
  const currentEpisodeId = useChatStore(s => s.currentEpisodeId);
  const activeTaskId = useChatStore(s => s.activeTaskId);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectCountRef = useRef(0);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    reconnectCountRef.current = 0;

    if (!activeTaskId) return;

    const listed = useChatStore.getState().agentTasks.find(t => t.id === activeTaskId);
    const ctx: StreamCtx = {
      activeTaskId,
      taskEpisodeId: listed?.episodeId ?? null,
      updateAgentTaskInList,
    };

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };

    const startPolling = () => {
      console.warn('[agent] SSE failed multiple times, falling back to polling');
      stopPolling();
      // UI-H2 fix: previously polling only fetched task.status — steps, plan,
      // children, artifacts, and questions were NEVER loaded in polling mode,
      // so the user saw a spinning ring with no detail. Now we also fetch
      // the /analysis endpoint which returns steps + plan + error analysis.
      // We fetch both endpoints in parallel; if /analysis fails (e.g., older
      // server without the endpoint), we still have task status.
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const [taskRes, analysisRes] = await Promise.all([
            fetch(`/api/agent/${activeTaskId}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/agent/${activeTaskId}/analysis`).then(r => r.ok ? r.json() : null).catch(() => null),
          ]);
          if (!taskRes) return;
          const task = taskRes.task as AgentTask | undefined;
          if (!task) return;
          if (task.episodeId) ctx.taskEpisodeId = task.episodeId;

          // Populate steps + plan from /analysis (if available)
          if (analysisRes) {
            const store = useChatStore.getState();
            if (analysisRes.steps && Array.isArray(analysisRes.steps) && analysisRes.steps.length > 0) {
              const persistedSteps: AgentStepLive[] = analysisRes.steps.map((s: Record<string, unknown>) => ({
                step: Number(s.step ?? 0),
                thought: String(s.thought ?? ''),
                action: String(s.action ?? ''),
                observation: String(s.observation ?? ''),
                durationMs: Number(s.durationMs ?? 0),
                tools: Array.isArray(s.tools) ? s.tools as AgentStepLive['tools'] : undefined,
                ts: Number(s.ts ?? Date.now()),
              })).filter((s: AgentStepLive) => Number.isFinite(s.step) && s.step > 0);
              const mergedSteps = mergeAgentSteps(store.activeTaskSteps, persistedSteps);
              if (mergedSteps !== store.activeTaskSteps) {
                useChatStore.setState({ activeTaskSteps: mergedSteps });
              }
            }
            if (analysisRes.plan && !store.activeTaskPlan) {
              store.setActiveTaskPlan(analysisRes.plan);
            }
          }

          // Hydrate artifacts from persisted artifactsJson (SSE may have been missed)
          if (
            Array.isArray(taskRes.artifacts)
            && taskRes.artifacts.length > 0
            && useChatStore.getState().activeTaskArtifacts.length === 0
          ) {
            const store = useChatStore.getState();
            for (const a of taskRes.artifacts as Array<{
              path?: string;
              meta?: { filename?: string; url?: string; step?: number };
            }>) {
              const filename = String(a.meta?.filename ?? a.path ?? '');
              if (!filename) continue;
              const url = String(a.meta?.url ?? `/api/artifacts/${filename}`);
              store.addActiveTaskArtifact({
                filename,
                url,
                step: Number(a.meta?.step ?? 0),
              });
            }
          }

          if (task.status === 'done') {
            applyTerminalStatus(
              ctx,
              'done',
              { resultSummary: task.resultSummary ?? '' },
              { chatContent: task.resultSummary ?? '' },
            );
            stopPolling();
          } else if (task.status === 'failed') {
            const error = task.error ?? 'unknown error';
            applyTerminalStatus(
              ctx,
              'failed',
              { error },
              { chatContent: `Не удалось выполнить задачу.\n\n${error}` },
            );
            stopPolling();
          } else if (task.status === 'cancelled') {
            applyTerminalStatus(ctx, 'cancelled', {});
            stopPolling();
          } else {
            useChatStore.getState().setActiveTaskStatus(task.status);
          }
        } catch (e) {
          console.warn('[agent] polling error:', e);
        }
      }, 2000);
    };

    const es = new EventSource(`/api/agent/${activeTaskId}/stream`);
    eventSourceRef.current = es;

    const handlers = createSseHandlers(ctx);
    for (const [type, handler] of Object.entries(handlers)) {
      es.addEventListener(type, (e: Event) => {
        // UI-H2 fix: reset reconnect counter on ANY successful SSE event.
        // Previously a slow drip of errors (one per minute) would accumulate
        // to 5 and trigger permanent polling fallback even though SSE was
        // mostly working. Now any successful event resets the counter.
        reconnectCountRef.current = 0;
        handler(e);
      });
    }

    es.onerror = () => {
      reconnectCountRef.current += 1;
      if (reconnectCountRef.current >= 5 && !pollingIntervalRef.current) {
        es.close();
        eventSourceRef.current = null;
        startPolling();
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      stopPolling();
    };
  }, [activeTaskId, updateAgentTaskInList]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const epId = useChatStore.getState().currentEpisodeId;
        const url = epId ? `/api/agent?episodeId=${epId}` : '/api/agent';
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        useChatStore.getState().setAgentTasks((data.tasks ?? []) as AgentTask[]);
      } catch (e) {
        console.error('[useAgentStream] refresh failed:', e);
      }
    };

    const t = setTimeout(() => { refresh(); }, 100);
    return () => clearTimeout(t);
  }, [currentEpisodeId]);
}

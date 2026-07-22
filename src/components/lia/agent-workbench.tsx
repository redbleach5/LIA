'use client';

// AgentWorkbench — агент рядом с чатом + Create Runtime Studio tabs.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ExternalLink,
  Eye,
  FilePenLine,
  FolderTree,
  ListOrdered,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  Terminal,
  LayoutTemplate,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { isAgentBusyStatus } from '@/lib/agent/task-status-ui';
import { cn } from '@/lib/utils';
import { AgentThoughtBubble } from './agent-thought-bubble';
import { AgentWaitingPrompt } from './agent-waiting-prompt';
import { FileChangesPanel } from './file-changes-panel';
import { WorkspacePanel } from './workspace-panel';
import { PanelErrorBoundary } from './panel-error-boundary';
import type { ProjectDesignLive, RuntimeLogLive, RuntimeStatusLive } from '@/stores/slices/types';

type TabId = 'flow' | 'design' | 'terminal' | 'preview' | 'edits' | 'files';

const STATUS_LABEL: Record<string, string> = {
  pending: 'ожидает',
  planning: 'планирует',
  executing: 'работает',
  waiting_input: 'ждёт ответ',
  synthesizing: 'собирает ответ',
  done: 'готово',
  failed: 'ошибка',
  cancelled: 'отменено',
};

type AgentWorkbenchProps = {
  /** Thought + waiting live here when full avatar stage is off. */
  includeLiveChrome?: boolean;
};

export function AgentWorkbench({ includeLiveChrome = false }: AgentWorkbenchProps) {
  const activeTaskId = useChatStore(s => s.activeTaskId);
  const status = useChatStore(s => s.activeTaskStatus);
  const plan = useChatStore(s => s.activeTaskPlan);
  const steps = useChatStore(s => s.activeTaskSteps);
  const fileChanges = useChatStore(s => s.activeTaskFileChanges);
  const artifacts = useChatStore(s => s.activeTaskArtifacts);
  const error = useChatStore(s => s.activeTaskError);
  const agentTasks = useChatStore(s => s.agentTasks);
  const design = useChatStore(s => s.activeTaskDesign);
  const runtimeLogs = useChatStore(s => s.activeTaskRuntimeLogs);
  const runtime = useChatStore(s => s.activeTaskRuntime);

  const busy = isAgentBusyStatus(status);
  const editCount = fileChanges.length;
  const undoableCount = fileChanges.filter(c => c.canUndo && !c.undone).length;
  const hasFlow = Boolean(plan?.steps?.length || steps.length > 0 || error || artifacts.length > 0);
  const hasEdits = editCount > 0;
  const hasDesign = Boolean(design);
  const hasRuntime = Boolean(runtime || runtimeLogs.length > 0);
  const show = Boolean(activeTaskId && (busy || hasEdits || hasFlow || hasDesign || hasRuntime));

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<TabId>('flow');

  useEffect(() => {
    if (editCount === 0) return;
    setExpanded(true);
    setTab('edits');
  }, [editCount]);

  useEffect(() => {
    if (status === 'waiting_input') setExpanded(true);
  }, [status]);

  useEffect(() => {
    if (!design) return;
    setExpanded(true);
    setTab(t => (t === 'flow' || t === 'edits' ? 'design' : t));
  }, [design?.name, design?.kind]);

  useEffect(() => {
    if (runtime?.status === 'healthy' || runtime?.status === 'running') {
      setExpanded(true);
      setTab(t => (runtime.previewUrl ? 'preview' : 'terminal'));
    }
  }, [runtime?.status, runtime?.previewUrl]);

  const summary = useMemo(() => {
    if (busy) return STATUS_LABEL[status ?? ''] ?? 'агент';
    if (runtime?.status === 'healthy') return 'preview жив';
    if (undoableCount > 0) return `${undoableCount} можно откатить`;
    if (hasEdits) return `${editCount} правок`;
    if (hasDesign) return `дизайн: ${design?.kind}`;
    if (status === 'done') return 'готово';
    if (status === 'failed') return 'ошибка';
    return STATUS_LABEL[status ?? ''] ?? 'агент';
  }, [busy, status, undoableCount, hasEdits, editCount, hasDesign, design?.kind, runtime?.status]);

  if (!show || !activeTaskId) return null;

  const tabs: { id: TabId; label: string; count?: number; show: boolean }[] = [
    { id: 'flow', label: 'Ход', show: hasFlow || busy },
    { id: 'design', label: 'Дизайн', show: hasDesign || busy },
    { id: 'terminal', label: 'Терминал', count: runtimeLogs.length || undefined, show: hasRuntime || hasDesign },
    { id: 'preview', label: 'Preview', show: hasDesign || hasRuntime },
    { id: 'edits', label: 'Правки', count: editCount || undefined, show: true },
    { id: 'files', label: 'Файлы', show: true },
  ];
  const visibleTabs = tabs.filter(t => t.show);
  const activeTab = visibleTabs.some(t => t.id === tab) ? tab : visibleTabs[0]?.id ?? 'flow';

  return (
    <div className="lia-agent-workbench shrink-0 border-t border-border/70 bg-gradient-to-b from-surface/80 to-background">
      <div className="lia-chat-rail px-5 py-2.5 space-y-2">
        {includeLiveChrome && (
          <div className="min-w-0">
            <AgentThoughtBubble />
          </div>
        )}

        <div className="rounded-xl border border-border/80 bg-surface/70 shadow-sm overflow-hidden lia-bubble-enter">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2/50 transition-colors"
            aria-expanded={expanded}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                busy ? 'bg-accent/12 text-accent' : 'bg-accent-2/10 text-accent-2',
              )}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground truncate">
                {busy ? 'Лия за работой' : 'След агента'}
              </span>
              <span className="block text-[11px] text-text-dim truncate">
                {summary}
                {steps.length > 0 ? ` · шаг ${steps.length}` : ''}
                {agentTasks.length > 1 ? ` · задач ${agentTasks.length}` : ''}
              </span>
            </span>
            {hasEdits && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                <FilePenLine className="w-3 h-3" />
                {editCount}
              </span>
            )}
            <ChevronDown
              className={cn(
                'w-4 h-4 shrink-0 text-text-dim transition-transform duration-200',
                expanded && 'rotate-180',
              )}
            />
          </button>

          {expanded && (
            <div className="border-t border-border/60">
              <div className="flex gap-0.5 px-2 pt-2 overflow-x-auto" role="tablist" aria-label="Панель агента">
                {visibleTabs.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap',
                      activeTab === t.id
                        ? 'bg-accent/12 text-accent'
                        : 'text-text-dim hover:text-foreground hover:bg-surface-2/60',
                    )}
                  >
                    {t.id === 'flow' && <ListOrdered className="w-3 h-3" />}
                    {t.id === 'design' && <LayoutTemplate className="w-3 h-3" />}
                    {t.id === 'terminal' && <Terminal className="w-3 h-3" />}
                    {t.id === 'preview' && <Eye className="w-3 h-3" />}
                    {t.id === 'edits' && <FilePenLine className="w-3 h-3" />}
                    {t.id === 'files' && <FolderTree className="w-3 h-3" />}
                    {t.label}
                    {typeof t.count === 'number' && t.count > 0 && (
                      <span className="tabular-nums opacity-80">{t.count}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="px-2 pb-2 pt-1.5 max-h-[min(48vh,26rem)] overflow-y-auto">
                <PanelErrorBoundary fallbackTitle="Панель агента недоступна">
                  {activeTab === 'flow' && (
                    <FlowTab
                      planSteps={plan?.steps ?? []}
                      steps={steps}
                      error={error}
                      artifacts={artifacts}
                      busy={busy}
                      status={status}
                    />
                  )}
                  {activeTab === 'design' && (
                    <DesignTab design={design} />
                  )}
                  {activeTab === 'terminal' && (
                    <TerminalTab
                      taskId={activeTaskId}
                      logs={runtimeLogs}
                      runtime={runtime}
                    />
                  )}
                  {activeTab === 'preview' && (
                    <PreviewTab
                      taskId={activeTaskId}
                      design={design}
                      runtime={runtime}
                    />
                  )}
                  {activeTab === 'edits' && (
                    <div className="lia-workbench-embed rounded-lg border border-border/70 bg-background/60 overflow-hidden">
                      {hasEdits ? (
                        <FileChangesPanel taskId={activeTaskId} />
                      ) : (
                        <EmptyHint>
                          Когда Лия изменит файлы, здесь появятся диффы и Undo.
                        </EmptyHint>
                      )}
                    </div>
                  )}
                  {activeTab === 'files' && (
                    <div className="lia-workbench-embed rounded-lg border border-border/70 bg-background/60 p-2">
                      <WorkspacePanel taskId={activeTaskId} />
                    </div>
                  )}
                </PanelErrorBoundary>
              </div>
            </div>
          )}
        </div>

        {includeLiveChrome && (
          <div className="lia-focus-waiting">
            <AgentWaitingPrompt />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 py-4 text-center text-[11px] text-text-dim leading-relaxed">
      {children}
    </p>
  );
}

function DesignTab({ design }: { design: ProjectDesignLive | null }) {
  if (!design) {
    return <EmptyHint>Лия ещё не предложила стек и структуру — появится на этапе Design Gate.</EmptyHint>;
  }
  return (
    <div className="space-y-3 px-1 py-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-foreground">{design.name}</span>
        <span className="text-[10px] uppercase tracking-wider text-text-dim font-mono">{design.kind}</span>
      </div>
      <section>
        <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5">Стек</h4>
        <p className="text-[11px] text-foreground/85 font-mono leading-relaxed">
          {design.stack.join(' · ')}
        </p>
      </section>
      <section>
        <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5">Файлы</h4>
        <ul className="space-y-1">
          {design.tree.map((t) => (
            <li key={t.path} className="flex gap-2 text-[11px]">
              <span className="font-mono text-accent shrink-0">{t.path}</span>
              <span className="text-text-dim truncate">{t.role}</span>
            </li>
          ))}
        </ul>
      </section>
      {(design.scripts.dev || design.scripts.start) && (
        <section>
          <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5">Scripts</h4>
          <pre className="text-[10px] font-mono text-foreground/80 bg-background/70 rounded-lg px-2.5 py-2 overflow-x-auto">
            {design.scripts.dev ? `dev: ${design.scripts.dev}\n` : ''}
            {design.scripts.start ? `start: ${design.scripts.start}` : ''}
          </pre>
        </section>
      )}
      <section>
        <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5">Acceptance</h4>
        <p className="text-[11px] text-foreground/85 leading-relaxed">{design.acceptance}</p>
      </section>
    </div>
  );
}

function TerminalTab({
  taskId,
  logs,
  runtime,
}: {
  taskId: string;
  logs: RuntimeLogLive[];
  runtime: RuntimeStatusLive | null;
}) {
  const [busyAction, setBusyAction] = useState<'stop' | 'restart' | null>(null);

  async function runtimeAction(action: 'stop' | 'restart') {
    setBusyAction(action);
    try {
      await fetch(`/api/agent/${taskId}/runtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] uppercase tracking-wider text-text-dim">
          {runtime?.status ?? 'idle'}
          {runtime?.port != null ? ` · :${runtime.port}` : ''}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-dim hover:bg-surface-2/60 hover:text-foreground disabled:opacity-40"
          disabled={busyAction !== null || !runtime || runtime.status === 'stopped' || runtime.status === 'idle'}
          onClick={() => runtimeAction('stop')}
        >
          <Square className="w-3 h-3" />
          Стоп
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-dim hover:bg-surface-2/60 hover:text-foreground disabled:opacity-40"
          disabled={busyAction !== null}
          onClick={() => runtimeAction('restart')}
        >
          <RotateCcw className={cn('w-3 h-3', busyAction === 'restart' && 'animate-spin')} />
          Рестарт
        </button>
      </div>
      {runtime?.lastError && (
        <p className="px-2 text-[11px] text-destructive/90">{runtime.lastError}</p>
      )}
      {logs.length === 0 ? (
        <EmptyHint>Логи появятся, когда Лия вызовет runtime_start.</EmptyHint>
      ) : (
        <pre className="rounded-lg border border-border/60 bg-[#1a1612] text-[#e8dcc8] text-[10px] font-mono leading-relaxed px-2.5 py-2 max-h-[18rem] overflow-auto">
          {logs.slice(-120).map((l, i) => (
            <div
              key={`${l.ts}-${i}`}
              className={cn(
                l.stream === 'stderr' && 'text-red-300/90',
                l.stream === 'system' && 'text-amber-200/80',
              )}
            >
              <span className="opacity-40 mr-1.5">{l.stream === 'system' ? '·' : l.stream === 'stderr' ? '!' : '>'}</span>
              {l.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function PreviewTab({
  taskId,
  design,
  runtime,
}: {
  taskId: string;
  design: ProjectDesignLive | null;
  runtime: RuntimeStatusLive | null;
}) {
  const [busyAction, setBusyAction] = useState<'stop' | 'restart' | null>(null);
  const url = runtime?.previewUrl
    ?? (design?.preview?.port ? `http://127.0.0.1:${design.preview.port}` : null);
  const canIframe = design?.preview?.type === 'iframe' || Boolean(runtime?.previewUrl);
  const healthy = runtime?.status === 'healthy' || runtime?.status === 'running';

  async function runtimeAction(action: 'stop' | 'restart') {
    setBusyAction(action);
    try {
      await fetch(`/api/agent/${taskId}/runtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (!canIframe) {
    return (
      <EmptyHint>
        Для этого артефакта preview — терминал (см. вкладку Терминал).
        {url ? ` URL: ${url}` : ''}
      </EmptyHint>
    );
  }

  const canShowFrame = Boolean(url) && (
    healthy
    || runtime?.status === 'starting'
    || runtime?.status === 'idle'
    || runtime?.status === 'unhealthy'
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 flex-wrap">
        <span className="text-[10px] font-mono text-text-dim truncate max-w-[14rem]">
          {url ?? 'нет URL'}
          {runtime?.status ? ` · ${runtime.status}` : ''}
        </span>
        <div className="flex-1" />
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-accent hover:bg-accent/10"
          >
            <ExternalLink className="w-3 h-3" />
            Открыть
          </a>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-dim hover:bg-surface-2/60 disabled:opacity-40"
          disabled={busyAction !== null || !healthy}
          onClick={() => runtimeAction('stop')}
        >
          <Square className="w-3 h-3" />
          Стоп
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-dim hover:bg-surface-2/60 disabled:opacity-40"
          disabled={busyAction !== null}
          onClick={() => runtimeAction('restart')}
        >
          <RotateCcw className={cn('w-3 h-3', busyAction === 'restart' && 'animate-spin')} />
          Рестарт
        </button>
      </div>
      {!url ? (
        <EmptyHint>
          Preview появится после успешного runtime_start (status: healthy).
        </EmptyHint>
      ) : canShowFrame ? (
        <iframe
          title="Lia artifact preview"
          src={url}
          className="w-full h-[min(36vh,18rem)] rounded-lg border border-border/70 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        />
      ) : (
        <EmptyHint>
          Процесс остановлен — нажми «Рестарт», чтобы снова поднять preview.
        </EmptyHint>
      )}
    </div>
  );
}

function FlowTab({
  planSteps,
  steps,
  error,
  artifacts,
  busy,
  status,
}: {
  planSteps: string[];
  steps: Array<{ step: number; action?: string; thought?: string; observation?: string }>;
  error: string | null;
  artifacts: Array<{ filename: string; url: string }>;
  busy: boolean;
  status: string | null;
}) {
  if (!planSteps.length && !steps.length && !error && !artifacts.length) {
    return (
      <EmptyHint>
        {busy
          ? `Лия ${STATUS_LABEL[status ?? ''] ?? 'думает'}… план появится здесь.`
          : 'Пока нет шагов по этой задаче.'}
      </EmptyHint>
    );
  }

  return (
    <div className="space-y-3 px-1 py-1">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-destructive mb-1">Ошибка</p>
          <p className="text-[11px] text-foreground/90 leading-relaxed">{error}</p>
        </div>
      )}

      {planSteps.length > 0 && (
        <section>
          <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5 px-0.5">План</h4>
          <ol className="space-y-1">
            {planSteps.map((step, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-foreground/85">
                <span className="font-mono text-text-dim shrink-0 tabular-nums">{i + 1}.</span>
                <span className="leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {steps.length > 0 && (
        <section>
          <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5 px-0.5">Шаги</h4>
          <div className="space-y-2">
            {[...steps].slice(-8).map(s => (
              <div key={s.step} className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-mono text-text-dim">#{s.step}</span>
                  {s.action && (
                    <span className="font-mono text-accent truncate">{s.action}</span>
                  )}
                </div>
                {s.thought && (
                  <p className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">
                    {s.thought}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {artifacts.length > 0 && (
        <section>
          <h4 className="text-[10px] uppercase tracking-wider text-text-dim mb-1.5 px-0.5">
            Артефакты
          </h4>
          <ul className="space-y-1">
            {artifacts.map((a, i) => (
              <li key={`${a.url}-${i}`}>
                <a
                  href={a.url}
                  download={a.filename}
                  className="text-[11px] text-accent hover:underline font-mono truncate block"
                >
                  {a.filename}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

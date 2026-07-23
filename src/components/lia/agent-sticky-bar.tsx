'use client';

import { useState } from 'react';
import { Shield, Zap, RotateCcw } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { isAgentBusyStatus, agentWorkbenchSummary } from '@/lib/agent/task-status-ui';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Sticky mini-bar over composer while an agent turn is busy:
 * status + Apply mode + rollback. Stop lives in ChatInput (Esc).
 */
export function AgentStickyBar() {
  const activeTaskId = useChatStore(s => s.activeTaskId);
  const status = useChatStore(s => s.activeTaskStatus);
  const plan = useChatStore(s => s.activeTaskPlan);
  const steps = useChatStore(s => s.activeTaskSteps);
  const fileChanges = useChatStore(s => s.activeTaskFileChanges);
  const applyMode = useChatStore(s => s.agentApplyMode);
  const setApplyMode = useChatStore(s => s.setAgentApplyMode);
  const executor = useChatStore(s => s.activeTaskExecutor);
  const markUndoneMany = useChatStore(s => s.markActiveTaskFileChangesUndone);
  const [rollbackBusy, setRollbackBusy] = useState(false);

  const busy = isAgentBusyStatus(status);
  if (!activeTaskId || !busy) return null;

  const isClaudeCode = executor === 'claude_code';
  const undoable = fileChanges.filter(c => c.canUndo && !c.undone);
  const summary = isClaudeCode
    ? (plan?.goal ? plan.goal.slice(0, 80) : 'Claude Code…')
    : (agentWorkbenchSummary({
      status,
      busy,
      stepCount: steps.length,
      editCount: fileChanges.length,
      undoableCount: undoable.length,
      runtimeHealthy: false,
      designKind: undefined,
    }) || (plan?.goal ? plan.goal.slice(0, 80) : 'Агент работает…'));

  const toggleApply = () => {
    const next = applyMode === 'ask' ? 'auto' : 'ask';
    setApplyMode(next);
    toast.message(next === 'auto' ? 'Авто-применение правок' : 'Спрашивать перед записью');
  };

  const rollback = async () => {
    if (rollbackBusy) return;
    setRollbackBusy(true);
    try {
      const res = await fetch(`/api/agent/${activeTaskId}/rollback`, { method: 'POST' });
      if (res.ok) {
        markUndoneMany(fileChanges.map(c => c.changeId));
        toast.message('Ход откатан');
      } else {
        toast.error('Не удалось откатить ход');
      }
    } catch {
      toast.error('Не удалось откатить ход');
    } finally {
      setRollbackBusy(false);
    }
  };

  return (
    <div className="border-t border-border/60 bg-surface/90 backdrop-blur-sm px-5 py-1.5 shrink-0">
      <div className="lia-chat-rail flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" aria-hidden />
        <span className="text-[11px] text-text-muted truncate flex-1 min-w-0" title={summary}>
          {summary}
        </span>
        {!isClaudeCode && (
        <button
          type="button"
          onClick={toggleApply}
          title={applyMode === 'ask' ? 'Спрашивать перед записью (Ctrl+Shift+A)' : 'Авто-применение (Ctrl+Shift+A)'}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] shrink-0',
            applyMode === 'ask'
              ? 'text-amber-200/90 hover:bg-amber-500/10'
              : 'text-emerald-300/90 hover:bg-emerald-500/10',
          )}
        >
          {applyMode === 'ask' ? <Shield className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
          {applyMode === 'ask' ? 'Ask' : 'Auto'}
        </button>
        )}
        {isClaudeCode && (
          <span className="text-[10px] text-text-muted/80 shrink-0 px-1" title="Запись через Claude Code (auto)">
            CC
          </span>
        )}
        {undoable.length > 0 && (
          <button
            type="button"
            disabled={rollbackBusy}
            onClick={() => void rollback()}
            title="Откатить ход"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-rose-300/90 hover:bg-rose-500/10 shrink-0 disabled:opacity-50"
          >
            <RotateCcw className={cn('w-3 h-3', rollbackBusy && 'animate-spin')} />
            Откатить
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

// ============================================================================
// AgentThoughtBubble — облако мыслей Лии во время работы агента.
// ============================================================================
//
// Показывается поверх сцены с аватаром (absolute positioned) когда агент активен.
// Содержит:
//   - Иконку + название фазы (планирование, выполнение, синтез, готово, ошибка)
//   - Текущую мысль (thought последнего шага) с typewriter effect
//   - Когда waiting_input — показывает вопрос Лии
//   - Когда done — краткий результат
//   - Когда failed — сообщение об ошибке
//
// Анимации:
//   - Появление: fade-in + slide-up (0.3s ease-out)
//   - Смена шага: легкий bounce (привлекает внимание)
//   - Typewriter: текст печатается по словам (~30ms/слово)
//   - Завершение: «Готово!» остаётся на 5 сек, потом dissolve
//
// ВАЖНО: компонент не должен перекрывать лицо аватара. Позиционируется
// в верхней части сцены, под индикатором стриминга.

import { useEffect, useState } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { displayAgentGoal } from '@/lib/agent/goal-display';
import {
  Lightbulb,
  Loader2,
  Search,
  Code2,
  Sparkles,
  CheckCircle2,
  XCircle,
  MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Тип фазы агента — определяет иконку, цвет, текст
// ============================================================================
type Phase = {
  icon: typeof Lightbulb;
  label: string;
  color: string;        // text color
  bgColor: string;      // background tint
  borderColor: string;  // border color
  spin?: boolean;       // крутить иконку (для loading фаз)
};

const PHASES: Record<string, Phase> = {
  planning: {
    icon: Lightbulb,
    label: 'План',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/40',
  },
  executing: {
    icon: Loader2,
    label: 'Шаги',
    color: 'text-accent',
    bgColor: 'bg-accent/10',
    borderColor: 'border-accent/40',
    spin: true,
  },
  waiting_input: {
    icon: MessageCircle,
    label: 'Вопрос',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    borderColor: 'border-warning/40',
  },
  synthesizing: {
    icon: Sparkles,
    label: 'Итог',
    color: 'text-accent-2',
    bgColor: 'bg-accent-2/10',
    borderColor: 'border-accent-2/40',
  },
  done: {
    icon: CheckCircle2,
    label: 'Готово',
    color: 'text-success',
    bgColor: 'bg-success/10',
    borderColor: 'border-success/40',
  },
  failed: {
    icon: XCircle,
    label: 'Ошибка',
    color: 'text-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/40',
  },
  cancelled: {
    icon: XCircle,
    label: 'Отменено',
    color: 'text-text-dim',
    bgColor: 'bg-surface-2/50',
    borderColor: 'border-border',
  },
};

// ============================================================================
// Маппинг action → понятная фраза для thought bubble
// Когда агент вызывает tool (web_search, code_run, etc) — показываем что делает
// ============================================================================
const ACTION_LABELS: Record<string, { icon: typeof Search; label: string }> = {
  web_search:    { icon: Search,    label: 'веб' },
  fetch_page:    { icon: Search,    label: 'страница' },
  http_request:  { icon: Search,    label: 'запрос' },
  read_file:     { icon: Code2,     label: 'чтение' },
  write_file:    { icon: Code2,     label: 'запись' },
  edit_file:     { icon: Code2,     label: 'правка' },
  list_dir:      { icon: Code2,     label: 'дерево' },
  list_tree:     { icon: Code2,     label: 'дерево' },
  file_search:   { icon: Search,    label: 'файлы' },
  grep:          { icon: Search,    label: 'grep' },
  search_codebase: { icon: Search,  label: 'код' },
  list_codebase_symbols: { icon: Code2, label: 'символы' },
  search_sources: { icon: Search,   label: 'KB' },
  list_sources:  { icon: Search,    label: 'источники' },
  get_source:    { icon: Search,    label: 'источник' },
  read_folder_file: { icon: Code2,  label: 'документ' },
  code_run:      { icon: Code2,     label: 'запуск' },
  save_artifact: { icon: Sparkles,  label: 'артефакт' },
  ask_user:      { icon: MessageCircle, label: 'вопрос' },
  reason:        { icon: Sparkles,  label: 'рассуждение' },
  propose_design: { icon: Sparkles, label: 'дизайн' },
  runtime_start: { icon: Code2,     label: 'preview' },
  runtime_logs:  { icon: Code2,     label: 'логи' },
  runtime_stop:  { icon: Code2,     label: 'стоп' },
};

/** Backend may send compound actions: "list_tree + grep + read_file". */
function describeAction(action: string | undefined | null): string | null {
  if (!action?.trim()) return null;
  const exact = ACTION_LABELS[action];
  if (exact) return exact.label;
  const parts = action.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return action;
  const labels = parts.map((p) => ACTION_LABELS[p]?.label ?? p);
  return labels.join(', ');
}


// ============================================================================
// Typewriter hook — печатает текст по словам
// ============================================================================
// Реализация без setState-in-effect: используем interval только для увеличения
// индекса. Текст вычисляется через derived value из index + words.
// Когда текст меняется — индекс сбрасывается через key (см. useEffect ниже
// который только перезапускает interval, не вызывает setState напрямую).
function useTypewriter(text: string, enabled: boolean, speedMs = 35, resetKey?: string | number): string {
  const [wordCount, setWordCount] = useState(0);

  // UI-H15 fix: reset wordCount when `resetKey` changes (e.g., step number),
  // NOT when `text` changes. Previously every streaming chunk that updated
  // `bubbleText` (which happens on every step thought update) reset the
  // typewriter to 0 words — the user only saw the first few words before
  // they were cleared. Now we reset only when the step number (or status)
  // changes, so the typewriter can actually complete within a step.
  // If resetKey is not provided, fall back to the old text-based reset.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  const [prevText, setPrevText] = useState(text);
  if (resetKey !== undefined) {
    if (prevResetKey !== resetKey) {
      setPrevResetKey(resetKey);
      setWordCount(0);
    }
  } else {
    // Legacy behavior: reset on text change.
    if (prevText !== text) {
      setPrevText(text);
      setWordCount(0);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const interval = setInterval(() => {
      setWordCount(prev => {
        if (prev >= words.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, speedMs);

    return () => clearInterval(interval);
  }, [text, enabled, speedMs]);

  if (!enabled) return text;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;
  // Когда wordCount >= words.length — показываем весь текст
  return words.slice(0, wordCount).join(' ') || '';
}

// ============================================================================
// Главный компонент
// ============================================================================
export function AgentThoughtBubble() {
  const status = useChatStore(s => s.activeTaskStatus);
  const steps = useChatStore(s => s.activeTaskSteps);
  const result = useChatStore(s => s.activeTaskResult);
  const error = useChatStore(s => s.activeTaskError);
  const plan = useChatStore(s => s.activeTaskPlan);
  const activeTaskId = useChatStore(s => s.activeTaskId);
  const agentTasks = useChatStore(s => s.agentTasks);

  const isActive = status !== null && status !== 'pending' && status !== 'cancelled';
  const phase = PHASES[status ?? 'executing'] ?? PHASES.executing;
  const currentStep = steps.length > 0 ? steps[steps.length - 1] : null;
  const stepNum = currentStep?.step ?? steps.length;
  // Budget ceiling from the task (e.g. 25) — NOT plan.steps.length.
  // Plan is often 3–4 high-level items; the ReAct loop can run many more steps.
  const activeTask = agentTasks.find(t => t.id === activeTaskId);
  const maxSteps = activeTask?.maxSteps ?? 0;
  const progressPct = maxSteps > 0 && status === 'executing'
    ? Math.min(100, Math.round((stepNum / maxSteps) * 100))
    : status === 'synthesizing'
      ? 92
      : status === 'planning'
        ? 12
        : status === 'done'
          ? 100
          : 0;

  let bubbleText = '';
  let bubbleSubtext = '';
  if (status === 'done' && result) {
    bubbleText = result.split(/[.!?]/)[0].slice(0, 100) + (result.length > 100 ? '…' : '');
  } else if (status === 'failed' && error) {
    bubbleText = error.slice(0, 120);
  } else if (status === 'planning') {
    // Phase badge already says «План» — body is the goal, not another «составляю план».
    const g = plan?.goal ? displayAgentGoal(plan.goal) : '';
    bubbleText = g ? g.slice(0, 100) : '…';
  } else if (status === 'synthesizing') {
    bubbleText = '…';
  } else if (currentStep?.thought) {
    // Skip regurgitated system/template lines in the first sentence.
    const thoughtLine = currentStep.thought
      .split(/\n/)
      .map(l => l.trim())
      .find(l => l && !/^(ты —|правила:|стратегия:|---+$|##\s)/i.test(l))
      ?? currentStep.thought;
    bubbleText = thoughtLine.split(/[.!?]/)[0].slice(0, 100);
    const actionLabel = describeAction(currentStep.action);
    if (actionLabel) bubbleSubtext = actionLabel;
  } else if (currentStep?.action) {
    bubbleText = describeAction(currentStep.action) ?? currentStep.action;
  } else {
    bubbleText = '…';
  }

  // Typewriter only for live step thoughts — not for static phase filler.
  const useTypewriterEffect = status === 'executing' && Boolean(currentStep?.thought);
  // UI-H15 fix: reset the typewriter when the step number OR status changes,
  // not when the text changes (which happens on every streaming chunk).
  const typewriterResetKey = `${status}:${currentStep?.step ?? 0}`;
  const typedText = useTypewriter(bubbleText, useTypewriterEffect, 35, typewriterResetKey);

  // waiting_input — только AgentWaitingPrompt (иначе вопрос дважды).
  if (!isActive || status === 'waiting_input') return null;

  const Icon = phase.icon;

  return (
    <div className="pointer-events-none w-full">
      <div
        className={cn(
          'rounded-xl border backdrop-blur-md lia-glass-strong shadow-sm',
          'px-3 py-2 lia-bubble-enter',
          phase.bgColor,
          phase.borderColor,
        )}
      >
        <div className="flex items-start gap-2">
          <Icon
            className={cn(
              'w-3.5 h-3.5 shrink-0 mt-0.5',
              phase.color,
              phase.spin && 'animate-spin',
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={cn('text-[10px] font-medium tracking-wide', phase.color)}>
                {phase.label}
              </span>
              {stepNum > 0 && status === 'executing' && maxSteps > 0 && (
                <span className="text-[9px] text-text-dim font-mono">
                  · {stepNum}/{maxSteps}
                </span>
              )}
            </div>
            {(typedText && typedText !== '…') && (
              <p className="text-[11px] text-foreground/90 leading-snug line-clamp-2">
                {typedText}
                {useTypewriterEffect && typedText !== bubbleText && (
                  <span className="inline-block w-0.5 h-3 bg-current ml-0.5 lia-typewriter-cursor align-middle" />
                )}
              </p>
            )}
            {bubbleSubtext && (
              <p className="text-[10px] text-text-dim leading-snug mt-0.5 line-clamp-1">
                {bubbleSubtext}
              </p>
            )}
            {(status === 'executing' || status === 'planning' || status === 'synthesizing') && (
              <div className={cn('mt-2 h-1 rounded-full bg-border/50 overflow-hidden', phase.color)}>
                <div
                  className="h-full rounded-full bg-current transition-all duration-500 opacity-70"
                  style={{ width: `${Math.max(progressPct, status === 'planning' ? 12 : 8)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

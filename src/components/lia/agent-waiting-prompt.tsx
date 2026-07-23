'use client';

import { useState, useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useAgent } from '@/hooks/use-agent';
import { AlertCircle, Loader2 } from 'lucide-react';

export function AgentWaitingPrompt() {
  const status = useChatStore(s => s.activeTaskStatus);
  const question = useChatStore(s => s.activeTaskQuestion);
  const activeTaskId = useChatStore(s => s.activeTaskId);
  const { provideInput } = useAgent();
  const [answer, setAnswer] = useState('');
  // UI-C7 fix: track submitting state so we can disable the button + show
  // a spinner, and so we don't clear the answer until the request succeeds.
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (status !== 'waiting_input' || !question) return;
    textareaRef.current?.focus();
  }, [status, question, activeTaskId]);

  if (status !== 'waiting_input' || !question || !activeTaskId) return null;

  const handleSubmit = async () => {
    const text = answer.trim();
    if (!text || submitting) return;
    // UI-C7 fix: previously `provideInput(...)` was not awaited, and
    // `setAnswer('')` cleared the textarea immediately. If the request
    // failed (network error, 409 conflict), the user's typed answer was
    // lost — they had to re-type it. Now we await, only clear on success,
    // and show a spinner during the request.
    setSubmitting(true);
    try {
      const ok = await provideInput(activeTaskId, text);
      if (ok) setAnswer('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pointer-events-auto mx-3 mb-2 rounded-xl border border-warning/40 bg-warning/8 backdrop-blur-sm p-3 shadow-lg lia-bubble-enter">
      <div className="flex items-center gap-1.5 mb-2">
        <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0" />
        <span className="text-[10px] font-medium tracking-wide text-warning">
          Вопрос
        </span>
      </div>
      <p className="text-xs text-foreground/90 leading-relaxed mb-2">{question}</p>
      <textarea
        ref={textareaRef}
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        disabled={submitting}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder="Твой ответ…"
        rows={2}
        aria-label="Ответ агенту"
        className="w-full text-xs px-2.5 py-2 rounded-lg border border-border/70 bg-background/90 placeholder:text-text-dim focus:outline-none focus:border-accent resize-none disabled:opacity-60"
      />
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!answer.trim() || submitting}
          className="px-3 py-1.5 text-[11px] rounded-lg bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
          {submitting ? 'Отправка…' : 'Ответить'}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMode, ChatAttachmentMeta } from '@/stores/chat-store';
import { useChatStore } from '@/stores/chat-store';
import { normalizeChatMode } from '@/lib/chat-modes';
import { ChatModeSelector } from '@/components/lia/chat-mode-indicator';
import { AgentWorkspaceModeSelector } from '@/components/lia/agent-workspace-mode-selector';
import { ChatAttachButton, PendingAttachmentChips } from '@/components/lia/chat-attachments';
import { cn } from '@/lib/utils';
import { ArrowUp, Square } from 'lucide-react';

type ChatInputProps = {
  onSend: (text: string, mode: ChatMode) => void;
  isStreaming: boolean;
  onStop: () => void;
  disabled?: boolean;
  pendingAttachments?: ChatAttachmentMeta[];
  onPickFiles?: (files: FileList | null) => void;
  onRemoveAttachment?: (id: string) => void;
  isAgentMode?: boolean;
  uploading?: boolean;
  /** Override stop button tooltip (e.g. agent cancel). */
  stopLabel?: string;
};

export function ChatInput({
  onSend,
  isStreaming,
  onStop,
  disabled,
  pendingAttachments = [],
  onPickFiles,
  onRemoveAttachment,
  isAgentMode,
  uploading = false,
  stopLabel,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [hasSent, setHasSent] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const mode = useChatStore(s => s.mode);
  const episodeId = useChatStore(s => s.currentEpisodeId);
  const isAgent = normalizeChatMode(mode) === 'agent';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);

  const showAttach = !isAgentMode && !!onPickFiles && !!onRemoveAttachment;

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    const handler = (e: Event) => {
      const suggestion = (e as CustomEvent<string>).detail;
      if (suggestion && typeof suggestion === 'string') {
        setText(suggestion);
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('lia-suggestion', handler);
    return () => window.removeEventListener('lia-suggestion', handler);
  }, []);

  useEffect(() => {
    const focusComposer = () => {
      if (disabled) return;
      textareaRef.current?.focus();
    };
    window.addEventListener('lia-focus-composer', focusComposer);
    return () => window.removeEventListener('lia-focus-composer', focusComposer);
  }, [disabled]);

  useEffect(() => {
    if (!isStreaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onStop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStreaming, onStop]);

  const handleSend = () => {
    const t = text.trim();
    const hasFiles = pendingAttachments.length > 0;
    if ((!t && !hasFiles) || isStreaming || disabled || uploading) return;
    onSend(t, mode);
    setText('');
    setHasSent(true);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isStreaming || disabled || uploading) return;
      e.preventDefault();
      handleSend();
    }
  };

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!showAttach || disabled || isStreaming) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  }, [showAttach, disabled, isStreaming]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!showAttach) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, [showAttach]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!showAttach) return;
    e.preventDefault();
    e.stopPropagation();
  }, [showAttach]);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!showAttach || !onPickFiles) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    if (disabled || isStreaming || uploading) return;
    if (e.dataTransfer.files?.length) onPickFiles(e.dataTransfer.files);
  }, [showAttach, onPickFiles, disabled, isStreaming, uploading]);

  const canSend =
    (!!text.trim() || pendingAttachments.length > 0) &&
    !disabled &&
    !isStreaming &&
    !uploading;
  const showHint = !disabled && (focused || !hasSent || pendingAttachments.length > 0);

  return (
    <div className="border-t border-border/80 bg-background px-5 py-3 shrink-0">
      <div className="lia-chat-rail">
        <div
          className={cn(
            'lia-chat-composer overflow-hidden transition-shadow relative',
            disabled && 'opacity-[0.55]',
            dragOver && 'border-accent/50 ring-2 ring-accent/15',
          )}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {dragOver && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-accent/8 pointer-events-none">
              <p className="text-xs font-medium text-accent">Отпусти файлы сюда</p>
            </div>
          )}

          {showAttach && (
            <PendingAttachmentChips
              pending={pendingAttachments}
              episodeId={episodeId}
              onRemove={onRemoveAttachment!}
              disabled={disabled || isStreaming || uploading}
            />
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              disabled
                ? 'Создай чат, чтобы начать…'
                : isStreaming
                  ? (isAgentMode || isAgent
                    ? 'Агент работает… Esc — стоп'
                    : 'Лия отвечает… Esc — стоп')
                  : isAgent
                    ? 'Опиши многошаговую задачу…'
                    : pendingAttachments.length > 0
                      ? 'Добавь комментарий или отправь…'
                      : 'Сообщение для Лии…'
            }
            disabled={disabled}
            rows={1}
            aria-label="Сообщение для Лии"
            className={cn(
              'w-full resize-none min-h-[44px] max-h-[160px] px-3.5 pt-3 pb-1',
              'bg-transparent text-sm text-foreground placeholder:text-text-dim',
              'focus:outline-none disabled:cursor-not-allowed',
            )}
          />

          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <div className="flex items-center gap-0.5 min-w-0">
              <ChatModeSelector disabled={isStreaming || disabled} />
              {(isAgentMode || isAgent) && (
                <AgentWorkspaceModeSelector disabled={isStreaming || disabled} />
              )}
              {showAttach && (
                <ChatAttachButton
                  onPickFiles={onPickFiles!}
                  disabled={disabled || isStreaming}
                  uploading={uploading}
                />
              )}
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                title={stopLabel ?? 'Остановить (Esc)'}
                aria-label={stopLabel ?? 'Остановить ответ (Esc)'}
                className={cn(
                  'h-8 w-8 shrink-0 rounded-lg flex items-center justify-center transition-colors',
                  'bg-destructive/10 text-destructive hover:bg-destructive/20',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30',
                )}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                title="Отправить (Enter)"
                aria-label="Отправить сообщение"
                className={cn(
                  'h-8 w-8 shrink-0 rounded-lg flex items-center justify-center transition-all',
                  'bg-accent text-accent-foreground hover:bg-accent/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  !canSend && 'opacity-40 cursor-not-allowed',
                )}
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>

        {showHint && (
          <p className="mt-2 text-[10px] text-text-dim text-center">
            Enter — отправить · Shift+Enter — новая строка
            {showAttach ? ' · можно перетащить файл' : ''}
            {isStreaming ? ' · Esc — стоп' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

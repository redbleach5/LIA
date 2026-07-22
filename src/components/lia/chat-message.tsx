'use client';

import { memo } from 'react';
import type { ChatMessage as ChatMessageType } from '@/stores/chat-store';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './markdown-renderer';
import { MessageAttachmentList } from './chat-attachments';

// ============================================================================
// ChatMessage — visual hierarchy через lia-msg-* классы
//   • User: справа, тёплый фон, accent border
//   • Companion: слева, neutral surface, мягкая тень
//   • Streaming: blinking cursor
//   • Author label: над сообщением, маленький, dim
//   • Timestamp: под сообщением (только companion)
// ============================================================================

export const ChatMessage = memo(function ChatMessage({
  message,
  episodeId,
}: {
  message: ChatMessageType;
  episodeId?: string | null;
}) {
  const isUser = message.role === 'user';
  const isStreaming = message.streaming === true;

  return (
    <div className={cn('lia-fade-in flex flex-col gap-0.5', isUser ? 'items-end' : 'items-start')}>
      {/* Author label */}
      <div className={cn(
        'text-[11px] text-text-dim px-1 font-display',
        isUser ? 'text-right' : 'text-left',
      )}>
        {isUser ? 'Ты' : 'Лия'}
      </div>

      {/* Message bubble — companion starts at the left rail (toward portrait) */}
      <div
        className={cn(
          isUser ? 'lia-msg-user' : 'lia-msg-companion',
          isStreaming && 'lia-cursor',
          isUser && message.attachments?.length ? 'flex flex-col gap-2' : undefined,
        )}
      >
        {isUser && message.attachments && message.attachments.length > 0 && episodeId && (
          <MessageAttachmentList attachments={message.attachments} episodeId={episodeId} />
        )}
        {(message.content || isStreaming) && (
          <MessageContent text={message.content} isStreaming={isStreaming} isUser={isUser} />
        )}
      </div>

      {/* Timestamp — only for companion messages when not streaming */}
      {!isStreaming && !isUser && (
        <div className="text-[10px] text-text-faint px-1">
          {new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// MessageContent — markdown для ответов Лии, plain text для пользователя.
// ============================================================================

function MessageContent({ text, isStreaming, isUser }: { text: string; isStreaming: boolean; isUser: boolean }) {
  if (!text && isStreaming) {
    return <span className="text-text-dim italic">думаю…</span>;
  }

  // User messages — plain text, no markdown (security: prevent interpretation)
  if (isUser) {
    return <div className="whitespace-pre-wrap break-words">{text}</div>;
  }

  // Companion messages — full markdown
  return <MarkdownRenderer content={text} />;
}

// ============================================================================
// Messages slice — сообщения текущего эпизода + эмоции + chat state.
// ============================================================================

import type { StateCreator } from 'zustand';
import type { EmotionVector } from '@/lib/personality';
import type { ChatMessage, ChatMode, AgentWorkspaceModeInput } from './types';
import { INITIAL_EMOTION } from './types';
import type { EpisodesSlice } from './episodes-slice';
import type { AgentSlice } from './agent-slice';
import type { HealthSlice } from './health-slice';

export type PendingSandboxConfirm = {
  goal: string;
  workspaceMode: AgentWorkspaceModeInput;
  /** Optimistic user message id to remove on cancel / keep on confirm. */
  userMessageId: string;
  source: 'chat' | 'panel';
  template?: 'general' | 'researcher' | 'coder';
};

export type MessagesSlice = {
  messages: ChatMessage[];
  /** True when older messages exist beyond the loaded window (cursor pagination). */
  messagesHasMore: boolean;
  messagesLoadingOlder: boolean;
  emotion: EmotionVector;
  isStreaming: boolean;
  mode: ChatMode;
  /** Phase 4: Read / Explore / Edit (auto = infer). */
  agentWorkspaceMode: AgentWorkspaceModeInput;
  pendingSandboxConfirm: PendingSandboxConfirm | null;

  setMessages: (msgs: ChatMessage[], opts?: { hasMore?: boolean }) => void;
  prependMessages: (msgs: ChatMessage[], opts?: { hasMore?: boolean }) => void;
  setMessagesLoadingOlder: (v: boolean) => void;
  addMessage: (msg: ChatMessage) => void;
  /** Remove one message and decrement optimistic episode.messageCount. */
  removeMessage: (id: string) => void;
  updateLastMessage: (content: string) => void;
  finalizeLastMessage: () => void;
  setEmotion: (e: EmotionVector) => void;
  setStreaming: (s: boolean) => void;
  setMode: (m: ChatMode) => void;
  setAgentWorkspaceMode: (m: AgentWorkspaceModeInput) => void;
  setPendingSandboxConfirm: (p: PendingSandboxConfirm | null) => void;
};

export const createMessagesSlice: StateCreator<
  EpisodesSlice & MessagesSlice & AgentSlice & HealthSlice,
  [],
  [],
  MessagesSlice
> = (set) => ({
  messages: [],
  messagesHasMore: false,
  messagesLoadingOlder: false,
  emotion: INITIAL_EMOTION,
  isStreaming: false,
  mode: 'auto',
  agentWorkspaceMode: 'auto',
  pendingSandboxConfirm: null,

  setMessages: (msgs, opts) => set({
    messages: msgs,
    messagesHasMore: opts?.hasMore ?? false,
    messagesLoadingOlder: false,
  }),
  prependMessages: (msgs, opts) => set((s) => {
    const existing = new Set(s.messages.map(m => m.id));
    const novel = msgs.filter(m => !existing.has(m.id));
    if (novel.length === 0 && opts?.hasMore === undefined) return s;
    return {
      messages: [...novel, ...s.messages],
      ...(opts?.hasMore !== undefined ? { messagesHasMore: opts.hasMore } : {}),
    };
  }),
  setMessagesLoadingOlder: (v) => set({ messagesLoadingOlder: v }),
  addMessage: (msg) => set((s) => {
    const preview = truncatePreview(msg.content);
    const episodes = s.currentEpisodeId
      ? s.episodes.map(e => e.id === s.currentEpisodeId
        ? {
            ...e,
            messageCount: e.messageCount + 1,
            preview: preview || e.preview,
            updatedAt: new Date().toISOString(),
          }
        : e)
      : s.episodes;
    return { messages: [...s.messages, msg], episodes };
  }),
  removeMessage: (id) => set((s) => {
    if (!s.messages.some(m => m.id === id)) return s;
    const episodes = s.currentEpisodeId
      ? s.episodes.map(e => e.id === s.currentEpisodeId
        ? {
            ...e,
            messageCount: Math.max(0, e.messageCount - 1),
            updatedAt: new Date().toISOString(),
          }
        : e)
      : s.episodes;
    return { messages: s.messages.filter(m => m.id !== id), episodes };
  }),
  updateLastMessage: (content) => set((s) => {
    if (s.messages.length === 0) return s;
    const last = s.messages[s.messages.length - 1];
    if (last.role !== 'companion' || !last.streaming) return s;
    const updated = { ...last, content };
    return { messages: [...s.messages.slice(0, -1), updated] };
  }),
  finalizeLastMessage: () => set((s) => {
    if (s.messages.length === 0) return s;
    const last = s.messages[s.messages.length - 1];
    if (last.role !== 'companion' || !last.streaming) return s;
    const updated = { ...last, streaming: false };
    const preview = truncatePreview(updated.content);
    const episodes = s.currentEpisodeId
      ? s.episodes.map(e => e.id === s.currentEpisodeId
        ? { ...e, preview: preview || e.preview, updatedAt: new Date().toISOString() }
        : e)
      : s.episodes;
    return { messages: [...s.messages.slice(0, -1), updated], episodes };
  }),

  setEmotion: (e) => set({ emotion: e }),
  setStreaming: (s) => set({ isStreaming: s }),
  setMode: (m) => set({ mode: m }),
  setAgentWorkspaceMode: (m) => set({ agentWorkspaceMode: m }),
  setPendingSandboxConfirm: (p) => set({ pendingSandboxConfirm: p }),
});

function truncatePreview(content: string): string | null {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length <= 80 ? cleaned : `${cleaned.slice(0, 79)}…`;
}

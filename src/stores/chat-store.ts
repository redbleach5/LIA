'use client';

// ============================================================================
// Chat store — композиция slices.
// ============================================================================
//
// Структура:
//   - episodesSlice — список эпизодов, текущий выбранный
//   - messagesSlice — сообщения, эмоции, chat state (isStreaming, mode)
//   - agentSlice    — список задач + активная задача (real-time SSE)
//   - healthSlice   — Ollama health
//
// Middleware:
//   - devtools: Redux DevTools интеграция (видеть все state changes в браузере)
//   - persist: mode сохраняется в localStorage (пользователь не теряет
//     выбранный режим чата при перезагрузке)
//
// Все типы (ChatMessage, Episode, AgentTask, и т.д.) вынесены в slices/types.ts
// чтобы избежать циклических зависимостей между slices.

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import type { EpisodesSlice } from './slices/episodes-slice';
import { createEpisodesSlice } from './slices/episodes-slice';
import type { MessagesSlice } from './slices/messages-slice';
import { createMessagesSlice } from './slices/messages-slice';
import type { AgentSlice } from './slices/agent-slice';
import { createAgentSlice } from './slices/agent-slice';
import type { HealthSlice } from './slices/health-slice';
import { createHealthSlice } from './slices/health-slice';
import { normalizeChatMode } from '@/lib/chat-modes';

// Re-export типов для обратной совместимости — компоненты импортируют
// ChatMessage, Episode, AgentTask и т.д. из '@/stores/chat-store'.
export type {
  ChatMessage,
  ChatAttachmentMeta,
  Episode,
  AgentTask,
  AgentTaskStatus,
  AgentStepLive,
  AgentPlanLive,
  ChatMode,
  AgentWorkspaceModeInput,
} from './slices/types';

export type { PendingSandboxConfirm } from './slices/messages-slice';

type ChatStore = EpisodesSlice & MessagesSlice & AgentSlice & HealthSlice;

export const useChatStore = create<ChatStore>()(
  devtools(
    persist(
      (set, get, store) => ({
        ...createEpisodesSlice(set as never, get as never, store as never),
        ...createMessagesSlice(set as never, get as never, store as never),
        ...createAgentSlice(set as never, get as never, store as never),
        ...createHealthSlice(set as never, get as never, store as never),
      }),
      {
        name: 'lia-chat-store',
        partialize: (state) => ({
          mode: state.mode,
          agentWorkspaceMode: state.agentWorkspaceMode,
        }) as Pick<ChatStore, 'mode' | 'agentWorkspaceMode'>,
        merge: (persisted, current) => {
          const saved = persisted as Partial<Pick<ChatStore, 'mode' | 'agentWorkspaceMode'>> | undefined;
          const rawMode = saved?.mode ?? current.mode;
          const rawWs = saved?.agentWorkspaceMode ?? current.agentWorkspaceMode;
          const ws =
            rawWs === 'read' || rawWs === 'explore' || rawWs === 'edit' || rawWs === 'auto'
              ? rawWs
              : 'auto';
          return {
            ...current,
            ...saved,
            mode: normalizeChatMode(String(rawMode)),
            agentWorkspaceMode: ws,
          };
        },
      },
    ),
    {
      name: 'lia-chat-store',
    },
  ),
);

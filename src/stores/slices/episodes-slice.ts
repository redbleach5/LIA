// ============================================================================
// Episodes slice — список эпизодов + текущий выбранный.
// ============================================================================

import type { StateCreator } from 'zustand';
import type { Episode } from './types';
// Forward declarations для cross-slice type dependencies.
// MessagesSlice нужен потому что setCurrentEpisode сбрасывает messages.
import type { MessagesSlice } from './messages-slice';
import type { AgentSlice } from './agent-slice';
import type { HealthSlice } from './health-slice';

export type EpisodesSlice = {
  episodes: Episode[];
  currentEpisodeId: string | null;

  setEpisodes: (eps: Episode[]) => void;
  addEpisode: (ep: Episode) => void;
  removeEpisode: (id: string) => void;
  setCurrentEpisode: (id: string | null) => void;
};

export const createEpisodesSlice: StateCreator<
  EpisodesSlice & MessagesSlice & AgentSlice & HealthSlice,
  [],
  [],
  EpisodesSlice
> = (set) => ({
  episodes: [],
  currentEpisodeId: null,

  setEpisodes: (eps) => set({ episodes: eps }),
  addEpisode: (ep) => set((s) => ({ episodes: [ep, ...s.episodes] })),
  removeEpisode: (id) => set((s) => ({
    episodes: s.episodes.filter(e => e.id !== id),
    currentEpisodeId: s.currentEpisodeId === id ? null : s.currentEpisodeId,
  })),
  // setCurrentEpisode сбрасывает messages + активный агент/sandbox —
  // иначе SSE/пульс/Esc «живут» в новом чате от задачи предыдущего.
  setCurrentEpisode: (id) => set({
    currentEpisodeId: id,
    messages: [],
    messagesHasMore: false,
    messagesLoadingOlder: false,
    pendingSandboxConfirm: null,
    activeTaskId: null,
    activeTaskStatus: null,
    activeTaskPlan: null,
    activeTaskSteps: [],
    activeTaskQuestion: null,
    activeTaskResult: null,
    activeTaskError: null,
    activeTaskArtifacts: [],
    activeTaskFileChanges: [],
  }),
});

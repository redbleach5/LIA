// Chat system-prompt profile — companion vs assistant vs minimal (no tools).

export type ChatPromptProfile = 'minimal' | 'companion' | 'assistant';

export type ChatProfileInput = {
  toolsEnabled: boolean;
  isTrivial: boolean;
  isAgent: boolean;
  /** Proactive KB block or heuristic KB question */
  isKbQuestion: boolean;
  hasKbContext: boolean;
  hasWebContext: boolean;
  isCodeTask: boolean;
  complexity: string;
};

/**
 * Pick prompt profile for this turn.
 * - minimal: model without tools (Gemma etc.) — no tool playbooks
 * - companion: small talk, emotions, simple chat — no tool manuals
 * - assistant: facts, KB, web, code, agent — full playbooks when adaptive/full
 */
export function resolveChatPromptProfile(input: ChatProfileInput): ChatPromptProfile {
  if (!input.toolsEnabled) return 'minimal';

  const needsAssistant = input.isAgent
    || input.hasKbContext
    || input.hasWebContext
    || input.isKbQuestion
    || input.isCodeTask
    || input.complexity === 'complex'
    || input.complexity === 'research'
    || input.complexity === 'moderate';

  if (needsAssistant) return 'assistant';
  if (input.isTrivial) return 'companion';

  return 'companion';
}

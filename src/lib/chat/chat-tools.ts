import 'server-only';

/**
 * Whether chat-mode streamText should expose tool definitions.
 *
 * Proactive web search and KB answer-lock inject context into the system
 * prompt — enabling tools again causes redundant multi-turn loops and empty
 * responses (prod regression, 2026-07).
 */
export function decideChatTools(params: {
  planToolsEnabled: boolean;
  toolsSupported: boolean;
  kbAnswerLocked: boolean;
  webSearchContext: string | undefined;
}): boolean {
  const { planToolsEnabled, toolsSupported, kbAnswerLocked, webSearchContext } = params;
  return planToolsEnabled && toolsSupported && !kbAnswerLocked && !webSearchContext;
}

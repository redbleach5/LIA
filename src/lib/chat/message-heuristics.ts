// Heuristics for greeting / acquaintance — shared by pipeline and tests.

export type TrivialMessageFlags = {
  isTrivialGreeting: boolean;
  isTrivialHowAreYou: boolean;
  isAcquaintanceRequest: boolean;
};

const GREETING_RE =
  /(?<![\p{L}\p{N}])(привет|здравствуй|hi|hello|hey|ку|даров|доброе утро|добрый вечер|добрый день)(?![\p{L}\p{N}])/iu;

const HOW_ARE_YOU_RE =
  /(?<![\p{L}\p{N}])(как дела|как ты|что делаешь|как настроение|чем занимаешься)(?![\p{L}\p{N}])/iu;

/** «Давай знакомиться», представиться, спросить имя — не сжимать до «короткое привет». */
const ACQUAINTANCE_RE =
  /(?<![\p{L}\p{N}])(?:знаком\p{L}*|представ\p{L}*|как\s+(?:тебя|меня)\s+зовут|who are you|what'?s your name)/iu;

export function detectAcquaintanceRequest(text: string): boolean {
  return ACQUAINTANCE_RE.test(text.toLowerCase().trim());
}

export function detectTrivialMessageFlags(text: string): TrivialMessageFlags {
  const textLower = text.toLowerCase().trim();
  const isAcquaintanceRequest = detectAcquaintanceRequest(text);

  const isTrivialGreeting = !isAcquaintanceRequest
    && text.length < 50
    && GREETING_RE.test(textLower);

  const isTrivialHowAreYou = text.length < 60 && HOW_ARE_YOU_RE.test(textLower);

  return { isTrivialGreeting, isTrivialHowAreYou, isAcquaintanceRequest };
}

const GREETING_IN_HISTORY_RE =
  /(?<![\p{L}\p{N}])(?:привет|здравствуй|hi|hello|доброе утро|добрый день|добрый вечер)(?![\p{L}\p{N}])/iu;

/** True if chat already had a greeting (user or Lia) — avoid hello loops. */
export function episodeHasPriorGreeting(
  messages: Array<{ role: string; content: string }>,
): boolean {
  return messages.some(m =>
    (m.role === 'user' || m.role === 'companion')
    && GREETING_IN_HISTORY_RE.test(m.content),
  );
}

export function countUserTurnsInEpisode(
  messages: Array<{ role: string }>,
  includeCurrentTurn = true,
): number {
  const fromHistory = messages.filter(m => m.role === 'user').length;
  return fromHistory + (includeCurrentTurn ? 1 : 0);
}

/**
 * Acquaintance / greeting hints for the system prompt.
 *
 * `recentMessages` may be a truncated window (last N). For long episodes we
 * also use `storedMessageCountBeforeTurn` so we don't treat turn 150 as "first hello".
 */
export function resolveAcquaintanceContext(params: {
  recentMessages: Array<{ role: string; content: string }>;
  /** Message rows already in DB before the current user turn was saved. */
  storedMessageCountBeforeTurn: number;
}): {
  episodeUserTurnCount: number;
  episodeHasPriorGreeting: boolean;
} {
  const { recentMessages, storedMessageCountBeforeTurn } = params;

  const fromWindow = countUserTurnsInEpisode(recentMessages, true);
  // Lower bound when the fetch window is shorter than the episode.
  const fromTotal = storedMessageCountBeforeTurn === 0
    ? 1
    : Math.ceil((storedMessageCountBeforeTurn + 1) / 2);

  return {
    episodeUserTurnCount: Math.max(fromWindow, fromTotal),
    episodeHasPriorGreeting:
      episodeHasPriorGreeting(recentMessages)
      || storedMessageCountBeforeTurn >= 2,
  };
}

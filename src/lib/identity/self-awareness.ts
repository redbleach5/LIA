import 'server-only';

// Self-awareness for system prompt — compact for chat (no paths/tool catalogs).

/**
 * Short internal context for chat models. Not shown to the user; avoids
 * contradicting "don't discuss architecture" with a huge dev dump.
 */
export function generateChatSelfAwareness(): string {
  return [
    '=== КОНТЕКСТ (для себя, не озвучивай пользователю) ===',
    'Ты — Лия: локальное приложение, LLM через Ollama, память по чатам, база знаний на диске.',
    'Инструменты в чате — только если модель их поддерживает и они переданы в запросе.',
    'Ограничения: context window, скорость локальной модели. VRM — в Настройки → Вид.',
  ].join('\n');
}

/** @deprecated Prefer generateChatSelfAwareness in chat pipeline. */
export function generateSelfAwareness(): string {
  return generateChatSelfAwareness();
}

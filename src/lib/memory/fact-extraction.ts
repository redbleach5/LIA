import 'server-only';

// Fact extraction — извлечение фактов из диалога через LLM.
//
// Вызывается после каждого ответа Лии (в onFinish callback chat route).
// Использует отдельный LLM-вызов с жёстким JSON-промптом:
//   "Извлеки факты из этого диалога в формате key:value"
//
// Глобальные факты (user.name, user.profession) — переживают смену чата.
// Эпизодные факты (current_project, topic) — только для этого чата.
//
// Чтобы не делать LLM-вызов на каждое сообщение (дорого), используется
// эвристика: извлекаем только если сообщение содержит "меня зовут",
// "я работаю", "мой проект" и подобные паттерны, ИЛИ если сообщение
// длиннее 200 символов (возможно содержит контекст).

import { streamText } from 'ai';
import { getChatModel } from '@/lib/ollama';
import { upsertGlobalFact, upsertEpisodeFact } from './facts';
import { remember } from './vector';
import { GROUNDING } from '@/lib/prompts/grounding';
import { logger } from '@/lib/logger';

// ============================================================================
// Эвристика — стоит ли извлекать факты из этого сообщения
// ============================================================================
// P2-1 fix (M-X-6): use Unicode property escapes instead of \b.
// JavaScript \b is based on ASCII \w — does NOT work for Cyrillic letters.
// The patterns below now use (?<![\p{L}\p{N}]) and (?![\p{L}\p{N}]) with the `u` flag.
const FACT_TRIGGER_PATTERNS = [
  // Имя, профессия, личное
  /(?<![\p{L}\p{N}])(меня зовут|моё имя|я [\wа-яё]+,? а ты|зови меня)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(я работаю|я учусь|моя профессия|по профессии)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(мне \d+ лет|мне исполнилось)(?![\p{L}\p{N}])/iu,
  // Проекты, контекст
  /(?<![\p{L}\p{N}])(мой проект|я делаю|я пишу|я разрабатываю|мы работаем над)(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(использую|пишу на|язык программирования|фреймворк)(?![\p{L}\p{N}])/iu,
  // Предпочтения
  /(?<![\p{L}\p{N}])(мне нравится|я люблю|не люблю|предпочитаю|мой любимый)(?![\p{L}\p{N}])/iu,
  // Цели, задачи
  /(?<![\p{L}\p{N}])(моя цель|я хочу сделать|планирую|задача —)(?![\p{L}\p{N}])/iu,
];

const MIN_LENGTH_FOR_EXTRACTION = 200;

function shouldExtractFacts(userMessage: string): boolean {
  // Короткие сообщения типа "привет" / "да" / "спасибо" — не извлекаем
  if (userMessage.length < 30) return false;
  // Длинные сообщения — возможно содержат контекст
  if (userMessage.length > MIN_LENGTH_FOR_EXTRACTION) return true;
  // Проверяем триггер-паттерны
  return FACT_TRIGGER_PATTERNS.some(re => re.test(userMessage));
}

// ============================================================================
// Промпт для извлечения фактов
// ============================================================================
const EXTRACTION_PROMPT = `Проанализируй диалог между пользователем и ассистентом Лией.
Извлеки ФАКТЫ — устойчивую информацию о пользователе и контексте.

Правила:
1. Только ФАКТЫ, не интерпретации. "Меня зовут Иван" → user.name: Иван. Не "пользователь представился".
2. Глобальные факты (профиль пользователя): префикс "user."
   - user.name — имя
   - user.profession — профессия
   - user.age — возраст
   - user.favorite_language — любимый язык программирования
   - user.location — где живёт
3. Эпизодные факты (контекст текущего чата): префикс "current."
   - current.project — над чем работает
   - current.task — что делает сейчас
   - current.topic — тема обсуждения
   - current.tech_stack — используемые технологии
4. ${GROUNDING.noFabricateFacts} Если информации нет — не включай.
5. Если факт уже известен и не изменился — не дублируй.
6. Формат: строго JSON {"global": {"name": "Иван", ...}, "episode": {"project": "...", ...}}
   В ключах JSON — БЕЗ префиксов user./current. (их добавит система). Допустимы и полные ключи — дубль префикса будет снят.
7. Если фактов нет — верни {"global": {}, "episode": {}}

Диалог:
Пользователь: {USER_MSG}
Лия: {LIA_MSG}

Извлеки факты (JSON):`;

/** Снять дубли user./current. и собрать канонический ключ. */
export function normalizeFactStorageKey(
  rawKey: string,
  prefix: 'user' | 'current',
): string | null {
  let key = rawKey.trim();
  if (!key) return null;
  // LLM часто возвращает уже с префиксом — снимаем все ведущие user./current.
  while (/^(user|current)\./i.test(key)) {
    key = key.replace(/^(user|current)\./i, '');
  }
  key = key.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/_+/g, '_').replace(/^[._]+|[._]+$/g, '');
  if (!key || key.length > 64) return null;
  return `${prefix}.${key.toLowerCase()}`;
}

// ============================================================================
// Извлечь факты из диалога и сохранить в БД
// ============================================================================
export async function extractAndSaveFacts(params: {
  userMessage: string;
  liaMessage: string;
  episodeId: string;
}): Promise<{ globalCount: number; episodeCount: number }> {
  const { userMessage, liaMessage, episodeId } = params;

  // Эвристика — не делаем LLM-вызов на каждое сообщение
  if (!shouldExtractFacts(userMessage)) {
    return { globalCount: 0, episodeCount: 0 };
  }

  try {
    const model = await getChatModel();
    const prompt = EXTRACTION_PROMPT
      .replace('{USER_MSG}', userMessage.slice(0, 1000))
      .replace('{LIA_MSG}', liaMessage.slice(0, 500));

    const result = streamText({
      model,
      system: 'Ты — модуль извлечения фактов. Возвращай только валидный JSON, без markdown.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1, // низкая температура — детерминированность
      maxOutputTokens: 300,
      // Таймаут 30 сек — fact extraction в background, не должен блокировать чат.
      // Если LLM таймаутит — просто пропускаем (non-fatal).
      abortSignal: AbortSignal.timeout(30_000),
      onError: (error) => {
        logger.warn('memory', 'Fact extraction streamText onError', {
          userMsgPreview: userMessage.slice(0, 60),
        }, error instanceof Error ? error : undefined);
      },
    });

    const text = await result.text;

    // P1-3 fix (H-MEM-2): use shared extractJson instead of greedy regex.
    const { extractJson } = await import('@/lib/infra/prompt-safety');
    const parsed = extractJson<{
      global?: Record<string, string>;
      episode?: Record<string, string>;
    }>(text);
    if (!parsed) {
      return { globalCount: 0, episodeCount: 0 };
    }

    let globalCount = 0;
    let episodeCount = 0;

    // Сохраняем глобальные факты
    if (parsed.global && typeof parsed.global === 'object') {
      for (const [key, value] of Object.entries(parsed.global)) {
        if (typeof value === 'string' && value.trim().length > 0 && value.trim().length < 500) {
          const trimmed = value.trim();
          const storageKey = normalizeFactStorageKey(key, 'user');
          if (!storageKey) continue;
          await upsertGlobalFact(storageKey, trimmed);
          await remember({
            episodeId,
            sourceType: 'fact',
            text: `[global] ${storageKey}: ${trimmed}`,
          });
          globalCount++;
        }
      }
    }

    if (parsed.episode && typeof parsed.episode === 'object') {
      for (const [key, value] of Object.entries(parsed.episode)) {
        if (typeof value === 'string' && value.trim().length > 0 && value.trim().length < 500) {
          const trimmed = value.trim();
          const storageKey = normalizeFactStorageKey(key, 'current');
          if (!storageKey) continue;
          await upsertEpisodeFact(episodeId, storageKey, trimmed);
          await remember({
            episodeId,
            sourceType: 'fact',
            text: `[episode] ${storageKey}: ${trimmed}`,
          });
          episodeCount++;
        }
      }
    }

    if (globalCount + episodeCount > 0) {
      logger.info('memory', `Facts extracted`, { globalCount, episodeCount });
    }

    return { globalCount, episodeCount };
  } catch (e) {
    logger.warn('memory', 'extraction failed (non-fatal)', {}, e);
    return { globalCount: 0, episodeCount: 0 };
  }
}

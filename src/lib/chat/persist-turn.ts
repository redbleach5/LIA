import 'server-only';

import { logger } from '@/lib/logger';
import { saveMessage } from '@/lib/memory/episodes';
import { remember } from '@/lib/memory/vector';
import {
  recordEmotionalAnchor,
  detectEmotionType,
} from '@/lib/memory/emotional-memory';
import { extractAndSaveFacts } from '@/lib/memory/fact-extraction';
import { shouldSelfCheck, type ExecutionPlan } from '@/lib/cognitive-depth';
import { runSelfCheck } from './self-check';
import type { EmotionVector } from '@/lib/personality';

type PersistChatTurnParams = {
  fullText: string;
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
  startTime: number;
  episodeId: string;
  text: string;
  perceivedEmotion: EmotionVector;
  triggers: string[];
  plan: ExecutionPlan;
  log: ReturnType<typeof logger.context>;
};

export async function persistChatTurn(params: PersistChatTurnParams): Promise<void> {
  const {
    fullText, usage, startTime, episodeId, text, perceivedEmotion, triggers,
    plan, log,
  } = params;

  const durationMs = Date.now() - startTime;
  // Prompt cache insight: log prompt tokens so the operator can see whether
  // the stable-prefix optimisation is working. When KV-cache hits, the
  // prompt-token count stays roughly constant across turns in the same
  // episode (system prompt + tier + self-awareness + facts = stable prefix).
  // If it grows linearly with conversation length, cache is missing — check
  // system prompt ordering (system-prompt.ts: stableParts must precede
  // volatileParts).
  log.info('chat', `Response finished (${durationMs}ms)`, {
    responseLength: fullText.length,
    responsePreview: fullText.slice(0, 120),
    tokensIn: usage?.inputTokens,
    tokensOut: usage?.outputTokens,
    // AI SDK exposes cachedInputTokens when the upstream provider reports it
    // (OpenAI, Anthropic). Ollama's OpenAI-compat layer doesn't currently
    // surface this — but the field is logged anyway so the day Ollama adds
    // it, the metric is visible without code change.
    cachedTokensIn: (usage as Record<string, unknown> | undefined)?.cachedInputTokens ?? undefined,
  });

  try {
    await saveMessage(episodeId, {
      role: 'companion',
      content: fullText,
      emotionJson: JSON.stringify(perceivedEmotion),
      tokensIn: usage?.inputTokens ?? null,
      tokensOut: usage?.outputTokens ?? null,
      durationMs,
    });
  } catch (e) {
    log.error('chat', 'Failed to save companion message', {}, e);
  }

  // P2-3 fix (M-X-1): log persistence failures instead of silently swallowing.
  remember({
    episodeId,
    sourceType: 'dialogue',
    text: `User: ${text}\nLia: ${fullText.slice(0, 500)}`,
  }).catch((e) => {
    log.warn('chat', 'remember() failed — dialogue vector not stored (non-fatal)', { episodeId: episodeId.slice(0, 8) }, e);
  });

  const emotionType = detectEmotionType(perceivedEmotion, triggers);
  const maxDelta = Math.max(
    Math.abs(perceivedEmotion.joy - 0.55),
    Math.abs(perceivedEmotion.irritation - 0.1),
    Math.abs(perceivedEmotion.sadness - 0.15),
  );
  if (maxDelta > 0.15) {
    recordEmotionalAnchor({
      episodeId,
      emotion: emotionType,
      intensity: Math.min(1, maxDelta * 1.5),
      trigger: text.slice(0, 100),
      context: text.slice(0, 500),
      emotionVector: perceivedEmotion,
    }).catch((e) => {
      // P2-3 fix (M-X-1): log instead of silently swallowing.
      log.warn('chat', 'recordEmotionalAnchor() failed (non-fatal)', { episodeId: episodeId.slice(0, 8) }, e);
    });
  }

  if (shouldSelfCheck(plan)) {
    runSelfCheck({ userMessage: text, liaResponse: fullText, episodeId })
      .then((checkResult) => {
        if (checkResult.severity !== 'ok') {
          log.info('chat', 'Self-check found issues', {
            severity: checkResult.severity,
            issues: checkResult.issues.slice(0, 5),
            episodeId: episodeId.slice(0, 8),
          });
        } else {
          log.debug('chat', 'Self-check ok', { episodeId: episodeId.slice(0, 8) });
        }
      })
      .catch(e => log.warn('chat', 'Self-check failed (non-fatal)', {}, e));
  }

  try {
    await extractAndSaveFacts({ userMessage: text, liaMessage: fullText, episodeId });
  } catch (e) {
    log.warn('chat', 'Fact extraction failed (non-fatal)', {}, e);
  }
}

import 'server-only';

// ============================================================================
// Auto model selection — pick smaller/faster model for trivial queries.
// ============================================================================
//
// Problem: One model for everything. "Привет" and "проанализируй архитектуру
// микросервиса" both go through the same 7B model — but trivial queries can
// run on 1-3B (3-5× faster, less VRAM).
//
// Solution: Based on task complexity + configured secondary model, decide
// which model to use for the main streamText call.
//
// Rules:
//   - complexity === 'trivial'  → use secondary (small) model if available
//   - complexity === 'simple'   → use primary (configured) model
//   - complexity === 'moderate' → use primary
//   - complexity === 'complex'  → use primary
//   - complexity === 'research' → use primary
//
// Secondary model is configured via Setting 'ollama_secondary_model'. If not
// set or not currently pulled, falls back to primary (no error).
//
// Tier compatibility:
//   - 'micro' tier (≤4B) — secondary would be even smaller, often unusable.
//     Skip secondary for micro tier (always use primary).
//   - 'standard' and up — secondary makes sense.
//
// Cost: 0 LLM calls. Decision is rule-based. The model swap happens in
// pipeline.ts when calling getChatModel() — we pass the chosen model name.

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkOllamaHealth, getOllamaSettings } from '@/lib/ollama';
import type { Tier } from '@/lib/capability-profile';
import type { TaskComplexity } from '@/lib/task-complexity';

const SECONDARY_MODEL_SETTING_KEY = 'ollama_secondary_model';
const TIERS_OK_FOR_SECONDARY: Tier[] = ['standard', 'plus', 'max'];

/**
 * Get the configured secondary (small) model name, if any.
 *
 * Returns null if:
 *   - Setting not set
 *   - Setting is empty string
 *   - DB unavailable (e.g. during build)
 */
export async function getSecondaryModelName(): Promise<string | null> {
  try {
    const row = await db.setting.findUnique({
      where: { key: SECONDARY_MODEL_SETTING_KEY },
    });
    const val = row?.value?.trim();
    return val || null;
  } catch {
    return null;
  }
}

/**
 * Set or clear the secondary model. Pass null to disable.
 */
export async function setSecondaryModelName(model: string | null): Promise<void> {
  if (model === null) {
    await db.setting.delete({
      where: { key: SECONDARY_MODEL_SETTING_KEY },
    }).catch(() => null);  // ignore if not exists
  } else {
    await db.setting.upsert({
      where: { key: SECONDARY_MODEL_SETTING_KEY },
      create: { key: SECONDARY_MODEL_SETTING_KEY, value: model },
      update: { value: model },
    });
  }
}

export interface ModelChoice {
  /** Final model name to pass to getChatModel() / streamText */
  modelName: string;
  /** Why this model was chosen — for logging/UI */
  reason: 'trivial-use-secondary' | 'no-secondary-configured' | 'complexity-not-trivial' | 'tier-too-small' | 'secondary-not-pulled';
  /** Whether the secondary model was used */
  usedSecondary: boolean;
  /** Configured secondary model name (may differ from chosen if not available) */
  secondaryModelName: string | null;
}

/**
 * Decide which model to use for the main streamText call.
 *
 * @param complexity Task complexity from classifyTaskComplexity
 * @param tier Capability tier from capability-profile
 * @returns ModelChoice with final model name + reason
 */
export async function chooseModelForQuery(
  complexity: TaskComplexity,
  tier: Tier,
): Promise<ModelChoice> {
  const settings = await getOllamaSettings();

  // Only use secondary for 'trivial' complexity
  if (complexity !== 'trivial') {
    return {
      modelName: settings.model,
      reason: 'complexity-not-trivial',
      usedSecondary: false,
      secondaryModelName: await getSecondaryModelName(),
    };
  }

  // Skip secondary for micro tier — primary is already small enough
  if (!TIERS_OK_FOR_SECONDARY.includes(tier)) {
    return {
      modelName: settings.model,
      reason: 'tier-too-small',
      usedSecondary: false,
      secondaryModelName: await getSecondaryModelName(),
    };
  }

  const secondary = await getSecondaryModelName();
  if (!secondary) {
    return {
      modelName: settings.model,
      reason: 'no-secondary-configured',
      usedSecondary: false,
      secondaryModelName: null,
    };
  }

  // Verify secondary model is actually pulled in Ollama
  const health = await checkOllamaHealth({ timeoutMs: 5_000 });
  if (!health.ok || !health.models.includes(secondary)) {
    logger.warn('chat', 'Secondary model not available, falling back to primary', {
      secondary,
      available: health.models.length,
    });
    return {
      modelName: settings.model,
      reason: 'secondary-not-pulled',
      usedSecondary: false,
      secondaryModelName: secondary,
    };
  }

  return {
    modelName: secondary,
    reason: 'trivial-use-secondary',
    usedSecondary: true,
    secondaryModelName: secondary,
  };
}

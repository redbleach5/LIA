// Cognitive Depth — adaptive pipeline selection (tier × complexity × mode).

import type { CognitiveParams, Tier } from '@/lib/capability-profile';
import { getTierParams } from '@/lib/capability-profile';
import type { TaskComplexity } from '@/lib/task-complexity';

export type CognitiveMode = 'auto' | 'agent';

export type ExecutionPlan = {
  mode: CognitiveMode;
  tier: Tier;
  complexity: TaskComplexity;
  /** Soft budget hint for gates (shouldDeliberate needs calls>=2). Not a multi-pass loop. */
  calls: number;
  deliberate: boolean;
  /** Always false in streaming; kept for plan/header compatibility. */
  selfCheck: boolean;
  maxTokens: number;
  toolsEnabled: boolean;
  autoWebSearch: boolean;
};

type PlanSlice = Pick<
  ExecutionPlan,
  'calls' | 'deliberate' | 'selfCheck' | 'maxTokens' | 'autoWebSearch'
>;

const AGENT_PLAN: Omit<ExecutionPlan, 'tier' | 'complexity' | 'maxTokens'> = {
  mode: 'agent',
  // Chat latency pass: no deliberate pre-call on any path (ReAct agent is separate).
  calls: 1,
  deliberate: false,
  // Streaming self-check cannot revise the answer — keep off (quality-log theater).
  selfCheck: false,
  toolsEnabled: true,
  autoWebSearch: true,
};

/** Latency pass: deliberate always off — character via STATIC_CORE + fallback decision. */
const EXECUTION_MATRIX: Record<Tier, Record<TaskComplexity, PlanSlice>> = {
  micro: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 512, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 1024, autoWebSearch: true },
    moderate: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: true },
    complex: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: true },
    research: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: true },
  },
  standard: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 512, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: false },
    moderate: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 4096, autoWebSearch: false },
    complex: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 4096, autoWebSearch: false },
    research: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 4096, autoWebSearch: true },
  },
  plus: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 1024, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: false },
    moderate: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 4096, autoWebSearch: false },
    complex: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 8192, autoWebSearch: false },
    research: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 8192, autoWebSearch: true },
  },
  max: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 1024, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: false },
    moderate: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 8192, autoWebSearch: false },
    complex: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 16384, autoWebSearch: false },
    research: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 16384, autoWebSearch: true },
  },
};

function planAuto(tier: Tier, complexity: TaskComplexity, tierParams: CognitiveParams): ExecutionPlan {
  const slice = EXECUTION_MATRIX[tier][complexity];
  // Latency: no tool schemas on light turns (companion path). Moderate+ keep tools.
  const lightTurn = complexity === 'trivial' || complexity === 'simple';
  return {
    mode: 'auto',
    tier,
    complexity,
    calls: slice.calls,
    deliberate: slice.deliberate,
    selfCheck: slice.selfCheck,
    maxTokens: slice.maxTokens,
    toolsEnabled: tierParams.toolsEnabled && !lightTurn,
    autoWebSearch: slice.autoWebSearch ?? tierParams.autoWebSearch,
  };
}

export function planExecution(params: {
  mode: CognitiveMode;
  tier: Tier;
  complexity: TaskComplexity;
}): ExecutionPlan {
  const { mode, tier, complexity } = params;

  if (mode === 'agent') {
    const tierParams = getTierParams(tier);
    return {
      ...AGENT_PLAN,
      tier,
      complexity,
      maxTokens: tierParams.maxTokens,
    };
  }

  return planAuto(tier, complexity, getTierParams(tier));
}

/** Always false — chat latency pass removed deliberate pre-calls. */
export function shouldDeliberate(_plan: ExecutionPlan): boolean {
  return false;
}

/** Always false while streaming: post-hoc LLM check cannot revise the answer. */
export function shouldSelfCheck(_plan: ExecutionPlan): boolean {
  return false;
}

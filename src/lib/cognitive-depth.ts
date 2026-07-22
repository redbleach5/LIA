// Cognitive Depth — adaptive pipeline selection (tier × complexity × mode).

import type { CapabilityProfile, CognitiveParams, Tier } from '@/lib/capability-profile';
import { getTierParams } from '@/lib/capability-profile';
import type { TaskComplexity } from '@/lib/task-complexity';

export type CognitiveMode = 'auto' | 'agent';

export type ExecutionPlan = {
  mode: CognitiveMode;
  tier: Tier;
  complexity: TaskComplexity;
  calls: number;
  deliberate: boolean;
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
  // calls>=2 required by shouldDeliberate / shouldSelfCheck — was 0, which
  // silently dead-gated both flags despite deliberate/selfCheck: true.
  calls: 2,
  deliberate: true,
  selfCheck: true,
  toolsEnabled: true,
  autoWebSearch: true,
};

const EXECUTION_MATRIX: Record<Tier, Record<TaskComplexity, PlanSlice>> = {
  micro: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 512, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 1024, autoWebSearch: true },
    moderate: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: true },
    complex: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: true },
    research: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: true },
  },
  standard: {
    // Latency tradeoff (not permanent lobotomy):
    //   trivial/simple/moderate → single call (8B meta-reasoning often hurts
    //     quality and adds 30–60s; path back = upgrade tier or raise complexity).
    //   complex/research → deliberate + self-check (hard work must not be
    //     silently dumbed down on the default 7–13B install).
    // See Sprint 8B-audit (B2) + PRIORITIES "never choke Lia".
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 512, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: false },
    moderate: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 4096, autoWebSearch: false },
    complex: { calls: 2, deliberate: true, selfCheck: true, maxTokens: 4096, autoWebSearch: false },
    research: { calls: 2, deliberate: true, selfCheck: true, maxTokens: 4096, autoWebSearch: true },
  },
  plus: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 1024, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: false },
    moderate: { calls: 2, deliberate: true, selfCheck: true, maxTokens: 4096, autoWebSearch: false },
    complex: { calls: 4, deliberate: true, selfCheck: true, maxTokens: 8192, autoWebSearch: false },
    research: { calls: 3, deliberate: true, selfCheck: true, maxTokens: 8192, autoWebSearch: true },
  },
  max: {
    trivial: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 1024, autoWebSearch: false },
    simple: { calls: 1, deliberate: false, selfCheck: false, maxTokens: 2048, autoWebSearch: false },
    moderate: { calls: 2, deliberate: true, selfCheck: true, maxTokens: 8192, autoWebSearch: false },
    complex: { calls: 4, deliberate: true, selfCheck: true, maxTokens: 16384, autoWebSearch: false },
    research: { calls: 4, deliberate: true, selfCheck: true, maxTokens: 16384, autoWebSearch: true },
  },
};

function planAuto(tier: Tier, complexity: TaskComplexity, tierParams: CognitiveParams): ExecutionPlan {
  const slice = EXECUTION_MATRIX[tier][complexity];
  return {
    mode: 'auto',
    tier,
    complexity,
    calls: slice.calls,
    deliberate: slice.deliberate,
    selfCheck: slice.selfCheck,
    maxTokens: slice.maxTokens,
    toolsEnabled: tierParams.toolsEnabled,
    autoWebSearch: slice.autoWebSearch ?? tierParams.autoWebSearch,
  };
}

export function planExecution(params: {
  mode: CognitiveMode;
  tier: Tier;
  complexity: TaskComplexity;
  profile: CapabilityProfile | null;
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

export function shouldDeliberate(plan: ExecutionPlan): boolean {
  return plan.deliberate && plan.calls >= 2;
}

export function shouldSelfCheck(plan: ExecutionPlan): boolean {
  return plan.selfCheck && plan.calls >= 2;
}

import { describe, it, expect } from 'vitest';
import {
  planExecution,
  shouldDeliberate,
  shouldSelfCheck,
  type ExecutionPlan,
} from '@/lib/cognitive-depth';
import type { TaskComplexity } from '@/lib/task-complexity';

function plan(tier: 'micro' | 'standard' | 'plus' | 'max', complexity: TaskComplexity) {
  return planExecution({ mode: 'auto', tier, complexity, profile: null });
}

describe('planExecution', () => {
  it('agent mode returns agent plan with tools always enabled', () => {
    const p = planExecution({
      mode: 'agent',
      tier: 'standard',
      complexity: 'moderate',
      profile: null,
    });
    expect(p.mode).toBe('agent');
    expect(p.toolsEnabled).toBe(true);
    expect(p.deliberate).toBe(true);
    expect(p.selfCheck).toBe(true);
    expect(p.calls).toBe(2);
    expect(p.maxTokens).toBe(4096); // standard tierParams.maxTokens
    expect(p.autoWebSearch).toBe(true);
    expect(shouldDeliberate(p)).toBe(true);
    expect(shouldSelfCheck(p)).toBe(true);
  });

  it('agent mode maxTokens follows tier (max)', () => {
    const p = planExecution({
      mode: 'agent',
      tier: 'max',
      complexity: 'complex',
      profile: null,
    });
    expect(p.maxTokens).toBe(16384);
  });

  describe('standard tier — latency tradeoff on easy traffic; depth on hard work', () => {
    it.each(['trivial', 'simple', 'moderate'] as TaskComplexity[])(
      'complexity=%s: single-call, no meta-reasoning',
      (complexity) => {
        const p = plan('standard', complexity);
        expect(p.deliberate).toBe(false);
        expect(p.selfCheck).toBe(false);
        expect(p.calls).toBe(1);
      },
    );

    it.each(['complex', 'research'] as TaskComplexity[])(
      'complexity=%s: deliberate + selfCheck enabled',
      (complexity) => {
        const p = plan('standard', complexity);
        expect(p.deliberate).toBe(true);
        expect(p.selfCheck).toBe(true);
        expect(p.calls).toBe(2);
        expect(shouldDeliberate(p)).toBe(true);
        expect(shouldSelfCheck(p)).toBe(true);
      },
    );

    it('research enables proactive web search flag in matrix', () => {
      expect(plan('standard', 'research').autoWebSearch).toBe(true);
    });

    it('simple does not auto-enable web search in matrix', () => {
      expect(plan('standard', 'simple').autoWebSearch).toBe(false);
    });

    it('tools stay enabled via tier params', () => {
      expect(plan('standard', 'moderate').toolsEnabled).toBe(true);
    });
  });

  describe('plus tier — deliberate on moderate+', () => {
    it('moderate uses 2 calls with deliberate and selfCheck', () => {
      const p = plan('plus', 'moderate');
      expect(p.calls).toBe(2);
      expect(p.deliberate).toBe(true);
      expect(p.selfCheck).toBe(true);
      expect(p.maxTokens).toBe(4096);
    });

    it('trivial stays single-call without deliberate', () => {
      const p = plan('plus', 'trivial');
      expect(p.calls).toBe(1);
      expect(p.deliberate).toBe(false);
    });

    it('research enables autoWebSearch', () => {
      expect(plan('plus', 'research').autoWebSearch).toBe(true);
    });
  });

  describe('max tier — highest budgets', () => {
    it('complex uses 4 calls and 16k max tokens', () => {
      const p = plan('max', 'complex');
      expect(p.calls).toBe(4);
      expect(p.deliberate).toBe(true);
      expect(p.maxTokens).toBe(16384);
    });
  });

  describe('micro tier', () => {
    it('trivial uses minimal maxTokens', () => {
      expect(plan('micro', 'trivial').maxTokens).toBe(512);
    });
  });

  it('includes tier and complexity on every auto plan', () => {
    const p = plan('standard', 'simple');
    expect(p.tier).toBe('standard');
    expect(p.complexity).toBe('simple');
    expect(p.mode).toBe('auto');
  });
});

describe('shouldDeliberate', () => {
  it('is false when deliberate flag is off even with calls>=2', () => {
    const p = plan('standard', 'moderate');
    expect(p.deliberate).toBe(false);
    expect(shouldDeliberate(p)).toBe(false);
  });

  it('is true when deliberate and calls>=2 (plus moderate)', () => {
    const p = plan('plus', 'moderate');
    expect(shouldDeliberate(p)).toBe(true);
  });

  it('is false when deliberate but calls=1', () => {
    const p: ExecutionPlan = {
      ...plan('plus', 'trivial'),
      deliberate: true,
      calls: 1,
    };
    expect(shouldDeliberate(p)).toBe(false);
  });
});

describe('shouldSelfCheck', () => {
  it('mirrors shouldDeliberate gating (calls>=2 required)', () => {
    expect(shouldSelfCheck(plan('standard', 'moderate'))).toBe(false);
    expect(shouldSelfCheck(plan('plus', 'moderate'))).toBe(true);
  });

  it('is false when selfCheck off on plus-tier slice with forced calls=1', () => {
    const p: ExecutionPlan = {
      ...plan('plus', 'simple'),
      selfCheck: true,
      calls: 1,
    };
    expect(shouldSelfCheck(p)).toBe(false);
  });
});

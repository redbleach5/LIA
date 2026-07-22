import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCognitiveParamsMock = vi.fn();

vi.mock('@/lib/capability-profile', () => ({
  getCognitiveParams: () => getCognitiveParamsMock(),
}));

describe('resolveAgentPhaseMaxTokens', () => {
  beforeEach(() => {
    vi.resetModules();
    getCognitiveParamsMock.mockReset();
  });

  it('planning stays at compact floor', async () => {
    getCognitiveParamsMock.mockResolvedValue({
      params: { maxTokens: 16384 },
      profile: { tier: 'max' },
    });
    const { resolveAgentPhaseMaxTokens, PLANNING_MAX_TOKENS } = await import(
      '@/lib/agent/runner-helpers'
    );
    expect(await resolveAgentPhaseMaxTokens('planning')).toBe(PLANNING_MAX_TOKENS);
  });

  it('execution/synthesis follow tier maxTokens on plus/max', async () => {
    getCognitiveParamsMock.mockResolvedValue({
      params: { maxTokens: 8192 },
      profile: { tier: 'plus' },
    });
    const { resolveAgentPhaseMaxTokens } = await import('@/lib/agent/runner-helpers');
    expect(await resolveAgentPhaseMaxTokens('execution')).toBe(8192);
    expect(await resolveAgentPhaseMaxTokens('synthesis')).toBe(8192);
  });

  it('micro may return below legacy execution floor', async () => {
    getCognitiveParamsMock.mockResolvedValue({
      params: { maxTokens: 2048 },
      profile: { tier: 'micro' },
    });
    const { resolveAgentPhaseMaxTokens } = await import('@/lib/agent/runner-helpers');
    expect(await resolveAgentPhaseMaxTokens('execution')).toBe(2048);
  });
});

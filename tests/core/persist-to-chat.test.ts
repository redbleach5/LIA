import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const saveMessage = vi.fn();
vi.mock('@/lib/memory/episodes', () => ({
  saveMessage: (...args: unknown[]) => saveMessage(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const emitAgentEvent = vi.fn();
vi.mock('@/lib/agent/events', () => ({
  emitAgentEvent: (...args: unknown[]) => emitAgentEvent(...args),
}));

describe('persist-to-chat', () => {
  beforeEach(() => {
    saveMessage.mockReset();
    emitAgentEvent.mockReset();
    saveMessage.mockResolvedValue({ id: 'msg-1' });
  });

  it('persistAgentGoalToChat writes a user message', async () => {
    const { persistAgentGoalToChat } = await import('@/lib/agent/persist-to-chat');
    const id = await persistAgentGoalToChat('ep-1', '  найти EGTS  ');
    expect(id).toBe('msg-1');
    expect(saveMessage).toHaveBeenCalledWith('ep-1', { role: 'user', content: 'найти EGTS' });
  });

  it('persistAgentResultToChat writes companion message', async () => {
    const { persistAgentResultToChat } = await import('@/lib/agent/persist-to-chat');
    const id = await persistAgentResultToChat({ episodeId: 'ep-1' }, 'итог');
    expect(id).toBe('msg-1');
    expect(saveMessage).toHaveBeenCalledWith('ep-1', { role: 'companion', content: 'итог' });
  });
});

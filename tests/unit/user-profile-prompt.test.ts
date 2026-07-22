import { describe, it, expect } from 'vitest';
import {
  detectTrivialMessageFlags,
  detectAcquaintanceRequest,
  episodeHasPriorGreeting,
  resolveAcquaintanceContext,
} from '@/lib/chat/message-heuristics';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { createInitialEmotion } from '@/lib/emotion';
import { MAX_MESSAGES_TO_CONSIDER } from '@/lib/chat/context-budget';

describe('message heuristics — acquaintance', () => {
  it('treats «давай знакомиться» as acquaintance, not trivial greeting', () => {
    const flags = detectTrivialMessageFlags('Привет. Давай знакомиться');
    expect(flags.isAcquaintanceRequest).toBe(true);
    expect(flags.isTrivialGreeting).toBe(false);
  });

  it('plain привет stays trivial greeting', () => {
    const flags = detectTrivialMessageFlags('Привет!');
    expect(flags.isTrivialGreeting).toBe(true);
    expect(flags.isAcquaintanceRequest).toBe(false);
  });

  it('detectAcquaintanceRequest matches представься', () => {
    expect(detectAcquaintanceRequest('Давай представимся')).toBe(true);
  });

  it('episodeHasPriorGreeting sees earlier hello', () => {
    expect(episodeHasPriorGreeting([
      { role: 'user', content: 'Привет' },
      { role: 'companion', content: 'Привет!' },
    ])).toBe(true);
  });
});

describe('resolveAcquaintanceContext — long episodes', () => {
  it('dialogue fetch cap matches budget max', () => {
    expect(MAX_MESSAGES_TO_CONSIDER).toBe(50);
  });

  it('first turn: ask-name window', () => {
    const ctx = resolveAcquaintanceContext({
      recentMessages: [],
      storedMessageCountBeforeTurn: 0,
    });
    expect(ctx.episodeUserTurnCount).toBe(1);
    expect(ctx.episodeHasPriorGreeting).toBe(false);
  });

  it('does not treat turn ~150 as first hello when window is truncated', () => {
    // Last 4 messages only in the window, but episode already has 298 stored.
    const ctx = resolveAcquaintanceContext({
      recentMessages: [
        { role: 'user', content: 'ок' },
        { role: 'companion', content: 'поняла' },
        { role: 'user', content: 'продолжим' },
        { role: 'companion', content: 'да' },
      ],
      storedMessageCountBeforeTurn: 298,
    });
    expect(ctx.episodeUserTurnCount).toBeGreaterThan(4);
    expect(ctx.episodeHasPriorGreeting).toBe(true);
  });
});

describe('system prompt — user name hints', () => {
  const emotion = createInitialEmotion();

  it('first hello without name asks for name', () => {
    const prompt = buildSystemPrompt({
      emotion,
      tier: 'standard',
      isTrivialGreeting: true,
      userNameKnown: false,
      episodeUserTurnCount: 1,
      episodeHasPriorGreeting: false,
    });
    expect(prompt).toContain('как зовут');
  });

  it('ongoing chat forbids opening with Привет', () => {
    const prompt = buildSystemPrompt({
      emotion: createInitialEmotion(),
      tier: 'standard',
      episodeHasPriorGreeting: true,
      episodeUserTurnCount: 3,
      recentLiaMessages: '1. Привет! Как дела?',
    });
    expect(prompt).toContain('ПРИВЕТСТВИЕ');
    expect(prompt).toContain('не открывай реплику приветствием');
    expect(prompt).toContain('не копируй');
  });

  it('acquaintance without name', () => {
    const prompt = buildSystemPrompt({
      emotion,
      tier: 'standard',
      isAcquaintanceRequest: true,
      userNameKnown: false,
    });
    expect(prompt).toContain('познакомиться');
    expect(prompt).toContain('как зовут');
  });

  it('known name skips ask hint on trivial', () => {
    const prompt = buildSystemPrompt({
      emotion,
      tier: 'standard',
      isTrivialGreeting: true,
      userNameKnown: true,
      episodeUserTurnCount: 1,
    });
    expect(prompt).not.toContain('имя собеседника неизвестно');
    expect(prompt).not.toContain('задай один вопрос — как зовут');
    expect(prompt).toContain('короткая реплика');
  });
});

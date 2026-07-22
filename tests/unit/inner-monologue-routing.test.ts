import { describe, it, expect } from 'vitest';
import {
  classifyIntent,
  shouldRunInnerMonologue,
} from '@/lib/identity/inner-monologue';

describe('classifyIntent (companion cues)', () => {
  it('detects classic emotional markers', () => {
    expect(classifyIntent('Мне очень грустно сегодня')).toBe('emotional');
    expect(classifyIntent('Мне страшно и одиноко')).toBe('emotional');
  });

  it('detects relational / support phrasing', () => {
    expect(classifyIntent('Мне тяжело, просто поговори со мной')).toBe('emotional');
    expect(classifyIntent('Я скучаю по тебе')).toBe('emotional');
    expect(classifyIntent('Мне нужна поддержка')).toBe('emotional');
  });

  it('keeps tasks as instruction / learning', () => {
    expect(classifyIntent('Сделай рефакторинг pipeline.ts')).toBe('instruction');
    expect(classifyIntent('Как работает agent runner?')).toBe('learning');
  });

  it('classifies how-are-you as trivial, not learning', () => {
    expect(classifyIntent('как дела')).toBe('trivial');
    expect(classifyIntent('Как дела?')).toBe('trivial');
    expect(classifyIntent('привет')).toBe('trivial');
  });
});

describe('shouldRunInnerMonologue (P1b routing)', () => {
  const base = {
    isTrivialGreeting: false,
    isTrivialHowAreYou: false,
    isAgent: false,
    emotionTriggers: [] as string[],
  };

  it('never on micro', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'micro', intent: 'emotional',
    })).toBe(false);
  });

  it('never on trivial greeting / how-are-you', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'emotional', isTrivialGreeting: true,
    })).toBe(false);
    expect(shouldRunInnerMonologue({
      ...base, tier: 'plus', intent: 'learning', isTrivialHowAreYou: true,
    })).toBe(false);
  });

  it('never in agent mode', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'plus', intent: 'emotional', isAgent: true,
    })).toBe(false);
  });

  it('always on plus/max (non-trivial)', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'plus', intent: 'learning',
    })).toBe(true);
    expect(shouldRunInnerMonologue({
      ...base, tier: 'max', intent: 'instruction',
    })).toBe(true);
  });

  it('on standard: emotional and urgent intents', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'emotional',
    })).toBe(true);
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'urgent',
    })).toBe(true);
  });

  it('on standard: skip instruction/learning without affective triggers', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'instruction',
    })).toBe(false);
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'learning',
    })).toBe(false);
  });

  it('on standard: affective perceive triggers enable monologue', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'learning', emotionTriggers: ['sadTopic'],
    })).toBe(true);
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'learning', emotionTriggers: ['warmth'],
    })).toBe(true);
  });

  it('on standard: acquaintance request enables monologue', () => {
    expect(shouldRunInnerMonologue({
      ...base, tier: 'standard', intent: 'learning', isAcquaintanceRequest: true,
    })).toBe(true);
  });
});

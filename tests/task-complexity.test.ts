import { describe, expect, it } from 'vitest';
import {
  classifyTaskComplexity,
  isConversationalMessage,
  isFactualQuestion,
  needsProactiveWebSearch,
} from '@/lib/task-complexity';

describe('needsProactiveWebSearch', () => {
  it('skips conversational greetings and open-ended check-ins', () => {
    const msg = 'Привет. что полезного можем сделать сегодня?';
    const complexity = classifyTaskComplexity(msg);
    expect(complexity).toBe('simple');
    expect(isConversationalMessage(msg, complexity)).toBe(true);
    expect(needsProactiveWebSearch(msg, complexity)).toBe(false);
  });

  it('searches for factual external questions', () => {
    const msg = 'Какая сейчас актуальная версия Node.js LTS?';
    const complexity = classifyTaskComplexity(msg);
    expect(isFactualQuestion(msg)).toBe(true);
    expect(needsProactiveWebSearch(msg, complexity)).toBe(true);
  });

  it('searches for explicit research intent', () => {
    const msg = 'Найди информацию про изменения в React 19';
    const complexity = classifyTaskComplexity(msg);
    expect(complexity).toBe('research');
    expect(needsProactiveWebSearch(msg, complexity)).toBe(true);
  });

  it('does not pre-search complex reasoning without external facts', () => {
    const msg = 'Проанализируй плюсы и минусы microservices для нашего pet-проекта';
    const complexity = classifyTaskComplexity(msg);
    expect(complexity).toBe('complex');
    expect(needsProactiveWebSearch(msg, complexity)).toBe(false);
  });

  it('short Cyrillic acronym is simple, not trivial', () => {
    expect(classifyTaskComplexity('интересует СМСВ')).toBe('simple');
  });

  it('social chatter stays trivial/simple — not moderate (no deliberate×2)', () => {
    expect(classifyTaskComplexity('Спасибо 😁')).toBe('trivial');
    expect(classifyTaskComplexity('Расскажи мне шутку))')).toBe('trivial');
    expect(classifyTaskComplexity('Давай поговорим о тебе')).toBe('trivial');
    expect(['trivial', 'simple']).toContain(
      classifyTaskComplexity('Мужа не будет с нами)) Я сказала, что он будет на работе. Но спасибо!'),
    );
  });

  it('mid-length creative ask without ? is simple, not default moderate', () => {
    const msg = 'Завтра хочу снять тихий влог: прогулка и цветочный магазин';
    expect(classifyTaskComplexity(msg)).toBe('simple');
  });
});

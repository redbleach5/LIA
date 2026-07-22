import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for src/lib/chat/model-selection.ts
 *
 * Tests auto model selection:
 *   - getSecondaryModelName / setSecondaryModelName — DB persistence
 *   - chooseModelForQuery — decision logic based on complexity + tier + provider
 *
 * Mocks:
 *   - @/lib/ollama.getOllamaSettings — returns provider + model config
 *   - @/lib/ollama.checkOllamaHealth — returns available models
 *   - @/lib/db — in-memory Setting table
 */

vi.mock('@/lib/logger', () => ({
  logger: {
    context: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

// In-memory Setting store
const mockSettings = new Map<string, string>();

const mockDb = {
  setting: {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
      const value = mockSettings.get(where.key);
      return value !== undefined ? { key: where.key, value } : null;
    }),
    upsert: vi.fn(async ({ where, create, update }: {
      where: { key: string }; create: { key: string; value: string }; update: { value: string };
    }) => {
      mockSettings.set(where.key, update.value);
      return { key: where.key, value: update.value };
    }),
    delete: vi.fn(async ({ where }: { where: { key: string } }) => {
      mockSettings.delete(where.key);
      return {};
    }),
  },
};
vi.mock('@/lib/db', () => ({ db: mockDb }));

// Mock ollama with controllable settings
const mockOllamaSettings = {
  provider: 'ollama' as const,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',
  embedModel: 'nomic-embed-text',
};

const mockHealth = {
  ok: true,
  models: ['qwen2.5:7b', 'qwen2.5:1.5b', 'nomic-embed-text'],
  error: undefined as string | undefined,
};

vi.mock('@/lib/ollama', () => ({
  getOllamaSettings: vi.fn(async () => ({ ...mockOllamaSettings })),
  checkOllamaHealth: vi.fn(async () => ({ ...mockHealth })),
}));

describe('chat/model-selection: getSecondaryModelName + setSecondaryModelName', () => {
  beforeEach(() => {
    mockSettings.clear();
    vi.clearAllMocks();
  });

  it('returns null when no secondary model is set', async () => {
    const { getSecondaryModelName } = await import('@/lib/chat/model-selection');
    const result = await getSecondaryModelName();
    expect(result).toBeNull();
  });

  it('persists and retrieves secondary model name', async () => {
    const { setSecondaryModelName, getSecondaryModelName } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');
    const result = await getSecondaryModelName();
    expect(result).toBe('qwen2.5:1.5b');
  });

  it('clears secondary model when passed null', async () => {
    const { setSecondaryModelName, getSecondaryModelName } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');
    await setSecondaryModelName(null);
    const result = await getSecondaryModelName();
    expect(result).toBeNull();
  });

  it('trims whitespace from secondary model name', async () => {
    const { setSecondaryModelName, getSecondaryModelName } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('  qwen2.5:1.5b  ');
    const result = await getSecondaryModelName();
    expect(result).toBe('qwen2.5:1.5b');
  });

  it('treats empty string as null (no secondary)', async () => {
    const { setSecondaryModelName, getSecondaryModelName } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('   ');
    const result = await getSecondaryModelName();
    expect(result).toBeNull();
  });
});

describe('chat/model-selection: chooseModelForQuery', () => {
  beforeEach(() => {
    mockSettings.clear();
    vi.clearAllMocks();
    mockOllamaSettings.provider = 'ollama';
    mockOllamaSettings.model = 'qwen2.5:7b';
    mockHealth.ok = true;
    mockHealth.models = ['qwen2.5:7b', 'qwen2.5:1.5b'];
  });

  it('uses secondary for trivial complexity when configured and available', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('trivial', 'standard');

    expect(choice.usedSecondary).toBe(true);
    expect(choice.modelName).toBe('qwen2.5:1.5b');
    expect(choice.reason).toBe('trivial-use-secondary');
  });

  it('falls back to primary for non-trivial complexity', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('simple', 'standard');

    expect(choice.usedSecondary).toBe(false);
    expect(choice.modelName).toBe('qwen2.5:7b');
    expect(choice.reason).toBe('complexity-not-trivial');
  });

  it('falls back to primary for moderate complexity', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('moderate', 'standard');
    expect(choice.usedSecondary).toBe(false);
    expect(choice.reason).toBe('complexity-not-trivial');
  });

  it('falls back to primary for research complexity', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('research', 'plus');
    expect(choice.usedSecondary).toBe(false);
    expect(choice.reason).toBe('complexity-not-trivial');
  });

  it('returns no-secondary-configured when secondary is not set', async () => {
    const { chooseModelForQuery } = await import('@/lib/chat/model-selection');
    const choice = await chooseModelForQuery('trivial', 'standard');

    expect(choice.usedSecondary).toBe(false);
    expect(choice.modelName).toBe('qwen2.5:7b');
    expect(choice.reason).toBe('no-secondary-configured');
    expect(choice.secondaryModelName).toBeNull();
  });

  it('skips secondary for micro tier (already small enough)', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:0.5b');

    const choice = await chooseModelForQuery('trivial', 'micro');

    expect(choice.usedSecondary).toBe(false);
    expect(choice.reason).toBe('tier-too-small');
  });

  it('falls back when secondary model is not pulled in Ollama', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('nonexistent:1b');

    // Mock health shows only qwen2.5:7b available
    mockHealth.models = ['qwen2.5:7b'];

    const choice = await chooseModelForQuery('trivial', 'standard');

    expect(choice.usedSecondary).toBe(false);
    expect(choice.modelName).toBe('qwen2.5:7b');
    expect(choice.reason).toBe('secondary-not-pulled');
  });

  it('falls back when Ollama is down', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    mockHealth.ok = false;
    mockHealth.models = [];

    const choice = await chooseModelForQuery('trivial', 'standard');

    expect(choice.usedSecondary).toBe(false);
    expect(choice.reason).toBe('secondary-not-pulled');
  });

  it('uses secondary for plus tier', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('trivial', 'plus');
    expect(choice.usedSecondary).toBe(true);
    expect(choice.reason).toBe('trivial-use-secondary');
  });

  it('uses secondary for max tier', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('trivial', 'max');
    expect(choice.usedSecondary).toBe(true);
  });

  it('exposes secondaryModelName in choice even when not used', async () => {
    const { setSecondaryModelName, chooseModelForQuery } = await import('@/lib/chat/model-selection');
    await setSecondaryModelName('qwen2.5:1.5b');

    const choice = await chooseModelForQuery('complex', 'standard');
    expect(choice.secondaryModelName).toBe('qwen2.5:1.5b');
    expect(choice.usedSecondary).toBe(false);
  });
});

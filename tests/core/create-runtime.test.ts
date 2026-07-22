import { describe, expect, it } from 'vitest';
import {
  parseProjectDesign,
  parseProjectDesignJson,
  serializeProjectDesign,
  previewUrlForDesign,
  PROJECT_MANIFEST_FILENAME,
} from '@/lib/agent/runtime/project-manifest';
import { inferProjectDesign, designNeedsRuntimeVerify } from '@/lib/agent/runtime/infer-design';
import { parseRuntimeScript } from '@/lib/agent/runtime/script-parse';
import { stepsHaveRuntimeVerify } from '@/lib/agent/runtime/verify';
import {
  shouldAcceptAgentCompletion,
  goalRequiresRuntimeVerify,
  fallbackPlan,
} from '@/lib/agent/runner-helpers';

describe('Create Runtime — design + manifest', () => {
  it('infers HTML canvas game design with iframe preview', () => {
    const d = inferProjectDesign('Напиши игру змейка в браузере');
    expect(d.kind).toBe('game');
    expect(d.stack).toEqual(expect.arrayContaining(['html', 'canvas']));
    expect(d.preview.type).toBe('iframe');
    expect(d.preview.port).toBe(5173);
    expect(designNeedsRuntimeVerify(d)).toBe(true);
    expect(PROJECT_MANIFEST_FILENAME).toBe('lia.project.json');
  });

  it('validates and serializes lia.project.json', () => {
    const d = inferProjectDesign('Создай простой сайт-лендинг');
    const parsed = parseProjectDesign(d);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const json = serializeProjectDesign(parsed.design);
    const again = parseProjectDesignJson(json);
    expect(again.ok).toBe(true);
    expect(previewUrlForDesign(parsed.design)).toBe('http://127.0.0.1:5173');
  });

  it('rejects iframe design without port', () => {
    const bad = parseProjectDesign({
      name: 'x',
      kind: 'web',
      stack: ['html'],
      tree: [{ path: 'index.html', role: 'entry' }],
      scripts: { start: 'npx serve' },
      preview: { type: 'iframe' },
      acceptance: 'ok',
      createdBy: 'lia',
    });
    expect(bad.ok).toBe(false);
  });
});

describe('Create Runtime — script parse + verify', () => {
  it('parses allowlisted runtime scripts', () => {
    const p = parseRuntimeScript('npx --yes serve -l 5173');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.command).toBe('npx');
    expect(p.args).toEqual(['--yes', 'serve', '-l', '5173']);
  });

  it('rejects shell metacharacters and unknown binaries', () => {
    expect(parseRuntimeScript('npx serve | cat').ok).toBe(false);
    expect(parseRuntimeScript('curl http://x').ok).toBe(false);
  });

  it('detects successful runtime_start in steps', () => {
    expect(stepsHaveRuntimeVerify([
      { action: 'runtime_start', observation: '{"success":true,"status":"healthy","port":5173}' },
    ])).toBe(true);
    expect(stepsHaveRuntimeVerify([
      { action: 'runtime_start', observation: '{"success":false,"error":"port dead"}' },
    ])).toBe(false);
  });
});

describe('Create Runtime — completion gate', () => {
  it('requires runtime verify for create goals when flag set', () => {
    expect(goalRequiresRuntimeVerify('Напиши игру тетрис html')).toBe(true);

    expect(shouldAcceptAgentCompletion({
      goal: 'Напиши игру тетрис html',
      text: 'ГОТОВО: готово',
      stepsIncludingCurrent: [
        { action: 'write_file', observation: '{"path":"index.html"}' },
      ],
      requireRuntimeVerify: true,
    })).toBe(false);

    expect(shouldAcceptAgentCompletion({
      goal: 'Напиши игру тетрис html',
      text: 'ГОТОВО: готово',
      stepsIncludingCurrent: [
        { action: 'write_file', observation: '{"path":"index.html"}' },
        { action: 'runtime_start', observation: '{"success":true,"status":"healthy"}' },
      ],
      requireRuntimeVerify: true,
    })).toBe(true);
  });

  it('fallback create plan includes propose_design and runtime_start', () => {
    const plan = fallbackPlan({
      id: 't',
      episodeId: 'e',
      goal: 'Создай игру змейка',
      status: 'pending',
      planJson: null,
      currentStep: 0,
      stepsJson: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null,
      maxSteps: 12,
      maxDurationSec: 600,
      toolsWhitelist: null,
      fsScope: '/tmp/agent-workspaces/x',
      checkpointJson: null,
      resultSummary: null,
      artifactsJson: '[]',
    });
    expect(plan.steps.some(s => /propose_design/.test(s))).toBe(true);
    expect(plan.steps.some(s => /runtime_start/.test(s))).toBe(true);
  });
});

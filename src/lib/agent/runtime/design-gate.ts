import 'server-only';

// ============================================================================
// Design Gate — propose + persist lia.project.json before scaffold.
// ============================================================================

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { emitAgentEvent } from '../events';
import { safeWriteFile } from '../fs-scope';
import type { AgentTask } from '../task';
import { inferProjectDesign } from './infer-design';
import {
  PROJECT_MANIFEST_FILENAME,
  parseProjectDesign,
  serializeProjectDesign,
  type ProjectDesignInput,
} from './project-manifest';
import type { ProjectDesign } from './types';
import { logger } from '@/lib/logger';

export type DesignGateResult = {
  design: ProjectDesign;
  autoAccepted: boolean;
  written: boolean;
};

/**
 * Run Design Gate for create goals: infer design, emit SSE, write manifest.
 * Complex plans (high) still auto-accept in v1 — UI shows design; agent may refine via propose_design.
 */
export async function runDesignGate(task: AgentTask): Promise<DesignGateResult | null> {
  if (!task.fsScope) return null;

  const design = inferProjectDesign(task.goal);
  emitAgentEvent({
    type: 'design_proposed',
    taskId: task.id,
    design,
    autoAccepted: true,
    ts: Date.now(),
  });

  let written = false;
  try {
    await safeWriteFile(
      PROJECT_MANIFEST_FILENAME,
      task.fsScope,
      serializeProjectDesign(design),
    );
    written = true;
  } catch (e) {
    // Fallback absolute write if safeWriteFile rejects for edge cases
    try {
      await writeFile(join(task.fsScope, PROJECT_MANIFEST_FILENAME), serializeProjectDesign(design), 'utf8');
      written = true;
    } catch (e2) {
      logger.warn('agent', 'design gate: failed to write lia.project.json', {
        taskId: task.id.slice(0, 8),
      }, e2 instanceof Error ? e2 : e);
    }
  }

  logger.info('agent', 'design gate proposed', {
    taskId: task.id.slice(0, 8),
    kind: design.kind,
    stack: design.stack,
    written,
  });

  return { design, autoAccepted: true, written };
}

export async function persistProjectDesign(
  task: AgentTask,
  raw: ProjectDesignInput,
): Promise<{ ok: true; design: ProjectDesign } | { ok: false; error: string }> {
  if (!task.fsScope) {
    return { ok: false, error: 'Нет рабочей директории (fsScope) для манифеста' };
  }
  const parsed = parseProjectDesign({ ...raw, createdBy: 'lia' });
  if (!parsed.ok) return parsed;

  try {
    await safeWriteFile(
      PROJECT_MANIFEST_FILENAME,
      task.fsScope,
      serializeProjectDesign(parsed.design),
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  emitAgentEvent({
    type: 'design_proposed',
    taskId: task.id,
    design: parsed.design,
    autoAccepted: true,
    ts: Date.now(),
  });

  return { ok: true, design: parsed.design };
}

export { inferProjectDesign };

// GET  /api/agent — list agent tasks (optional ?episodeId=...)
// POST /api/agent — create a new agent task and auto-start the runner

import { NextRequest, NextResponse } from 'next/server';
import { listAgentTasks, createAgentTask, type AgentTaskStatus } from '@/lib/agent/task';
import { runAgentTask, sweepStaleTasks } from '@/lib/agent/runner';
import { persistAgentGoalToChat } from '@/lib/agent/persist-to-chat';
import { getCognitiveParams } from '@/lib/capability-profile';
import { logger } from '@/lib/logger';
import { parseBody, createAgentTaskSchema } from '@/lib/infra/api-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sweep flag — in-memory, prevents multiple sweeps per process lifetime.
// Sweep помечает stale задачи (planning/executing/...) как failed.
// Выполняется один раз при первом обращении к /api/agent после старта сервера.
let sweepDone = false;

export async function GET(req: NextRequest) {
  try {
    // Lazy sweep on first call — помечаем зависшие задачи после рестарта.
    if (!sweepDone) {
      sweepDone = true;
      await sweepStaleTasks().catch(() => null);
    }

    const episodeId = req.nextUrl.searchParams.get('episodeId') ?? undefined;
    const status = req.nextUrl.searchParams.get('status') as AgentTaskStatus | null;
    let tasks = await listAgentTasks(episodeId, 50);
    if (status) {
      tasks = tasks.filter(t => t.status === status);
    }
    return NextResponse.json({ tasks });
  } catch (e) {
    logger.error('agent', 'GET failed', {}, e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, createAgentTaskSchema);
    if (!parsed.success) return parsed.response;
    let { episodeId, goal, autoStart, fsScope, toolsWhitelist, maxSteps, maxDurationSec, template, workspaceMode, confirmSandbox } = parsed.data;
    const userGoal = goal.trim();

    // Create/implement goals → coder template (write_file pressure) unless caller set one.
    if (!template || template === 'general') {
      const { isCodeCreationGoal } = await import('@/lib/agent/kb-step-utils');
      if (isCodeCreationGoal(userGoal)) {
        template = 'coder';
      }
    }

    // Get capability profile to set adaptive agent limits
    const { params: tierParams } = await getCognitiveParams();

    // P6-1 fix: apply template overrides if a non-'general' template is specified.
    // Template provides defaults for toolsWhitelist, maxSteps, maxDurationSec.
    // Caller-provided values (if any) take precedence over template defaults.
    let effectiveMaxSteps = maxSteps ?? null;
    let effectiveMaxDurationSec = maxDurationSec ?? null;
    let templateWhitelist: string[] | null = null;
    let templateSystemPrompt = '';

    if (template && template !== 'general') {
      const { getTemplate } = await import('@/lib/agent/templates');
      const tmpl = getTemplate(template);
      templateWhitelist = tmpl.toolWhitelist;
      templateSystemPrompt = tmpl.systemPrompt;
      if (effectiveMaxSteps === null) {
        effectiveMaxSteps = tmpl.maxSteps;
      }
      if (effectiveMaxDurationSec === null) {
        effectiveMaxDurationSec = tmpl.maxDurationSec;
      }
    }

    // Phase 4: workspace mode gates tools (Read / Explore / Edit).
    const { resolveToolsWhitelistForMode } = await import('@/lib/agent/kb-step-utils');
    const { mode: resolvedMode, toolsWhitelist: modeTools } = resolveToolsWhitelistForMode({
      goal: userGoal,
      workspaceModeInput: workspaceMode,
      callerWhitelist: toolsWhitelist ?? null,
      templateWhitelist,
    });
    const effectiveToolsWhitelist = modeTools;
    logger.info('agent', 'Workspace mode resolved', {
      input: workspaceMode,
      mode: resolvedMode,
      toolCount: effectiveToolsWhitelist.length,
      template: template ?? 'general',
    });

    // Workspace: episode binding > explicit > env > KB name → Lia self → sandbox.
    // Read/Explore never create a write sandbox.
    // Edit without project: dry-run first so 409 does not mkdir orphan sandboxes.
    const { resolveWorkspace } = await import('@/lib/agent/workspace-binding');
    const { needsSandboxConfirm } = await import('@/lib/agent/workspace-modes');
    const preflight = await resolveWorkspace({
      episodeId,
      goal: userGoal,
      explicitFsScope: fsScope,
      workspaceMode: resolvedMode,
      dryRun: resolvedMode === 'edit' && !confirmSandbox,
    });

    if (needsSandboxConfirm(resolvedMode, preflight.kind, confirmSandbox, {
      intentionalSandboxBinding: preflight.binding?.kind === 'sandbox',
      fsScopeAlreadyBound: !!preflight.fsScope,
    })) {
      return NextResponse.json({
        error: 'sandbox_confirm_required',
        message: 'Режим Правка без привязанной папки/KB — запись пойдёт в sandbox (черновик). Подтверди, чтобы продолжить.',
        kind: 'sandbox',
        workspaceMode: resolvedMode,
      }, { status: 409 });
    }

    const resolved = preflight.kind === 'sandbox' && !preflight.fsScope
      ? await resolveWorkspace({
          episodeId,
          goal: userGoal,
          explicitFsScope: fsScope,
          workspaceMode: resolvedMode,
          dryRun: false,
        })
      : preflight;

    const finalFsScope = resolved.fsScope;
    if (resolved.binding) {
      logger.info('agent', 'fsScope from episode workspace binding', {
        kind: resolved.binding.kind,
        label: resolved.binding.label,
        sourceIds: resolved.sourceIds.length,
        path: finalFsScope?.slice(-80),
        workspaceMode: resolvedMode,
      });
    } else if (resolved.kind === 'project') {
      logger.info('agent', 'fsScope = Lia project root (goal/env self-mount)', {
        root: finalFsScope?.slice(-80),
      });
    } else if (resolved.kind === 'kb') {
      logger.info('agent', 'fsScope = KB source path', {
        path: finalFsScope?.slice(-80),
      });
    } else if (resolved.kind === 'env_default') {
      logger.info('agent', 'fsScope = LIA_AGENT_DEFAULT_WORKSPACE', {
        path: finalFsScope?.slice(-80),
      });
    } else if (resolved.kind === 'sandbox') {
      logger.debug('agent', 'Created write sandbox (Edit confirmed or env)', {
        sandbox: finalFsScope?.slice(-60),
        workspaceMode: resolvedMode,
      });
    } else if (resolved.kind === 'none' && (resolvedMode === 'read' || resolvedMode === 'explore')) {
      logger.debug('agent', 'No fsScope for Read/Explore (no write sandbox)', {
        workspaceMode: resolvedMode,
      });
    }

    // Prepend template system prompt for researcher/coder presets.
    if (templateSystemPrompt && template && template !== 'general') {
      goal = `${templateSystemPrompt}\n\n## ЗАДАЧА\n${userGoal}`;
    } else {
      goal = userGoal;
    }

    const resolvedMaxSteps = typeof effectiveMaxSteps === 'number'
      ? Math.min(tierParams.agentMaxSteps, Math.max(1, effectiveMaxSteps))
      : tierParams.agentMaxSteps;

    let resolvedMaxDurationSec: number;
    if (typeof effectiveMaxDurationSec === 'number') {
      resolvedMaxDurationSec = effectiveMaxDurationSec === 0
        ? 0
        : Math.min(tierParams.agentMaxDurationSec, Math.max(60, effectiveMaxDurationSec));
    } else {
      resolvedMaxDurationSec = tierParams.agentMaxDurationSec;
    }

    const task = await createAgentTask({
      episodeId,
      goal,
      toolsWhitelist: effectiveToolsWhitelist,
      fsScope: finalFsScope,
      maxSteps: resolvedMaxSteps,
      maxDurationSec: resolvedMaxDurationSec,
    });

    // Mirror the short user goal into dialogue (not the curriculum dump).
    const userMessageId = await persistAgentGoalToChat(episodeId, userGoal);

    // Auto-start the runner unless caller opted out
    if (autoStart) {
      runAgentTask(task.id).catch((e) => {
        logger.error('agent', `Runner crashed for task`, { taskId: task.id.slice(0, 8) }, e);
      });
    }

    return NextResponse.json({ task, userMessageId }, { status: 201 });
  } catch (e) {
    logger.error('agent', 'POST failed', {}, e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

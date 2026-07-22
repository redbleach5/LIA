// POST /api/chat — adaptive streaming chat.
//
// Thin handler: валидация (zod) → routing → runChatPipeline или auto-agent → response.
//
// AUTO-AGENT ROUTING:
//   Когда mode='auto' и isAgentTask(text) — автоматически создаём agent task
//   вместо chat pipeline. Возвращаем JSON { type: 'agent_task', taskId, goal }.
//   Клиент (use-chat.ts) детектит этот ответ и переключается на agent view.
//   Это работает как у топовых нейронок — система сама решает когда нужен
//   многошаговый режим, пользователь не переключает вручную.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runChatPipeline } from '@/lib/chat/pipeline';
import { parseBody, chatRequestSchema } from '@/lib/infra/api-validation';
import { isAgentTask } from '@/lib/task-complexity';
import { createAgentTask } from '@/lib/agent/task';
import { runAgentTask } from '@/lib/agent/runner';
import { persistAgentGoalToChat } from '@/lib/agent/persist-to-chat';
import { getCognitiveParams } from '@/lib/capability-profile';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // ── Валидация (zod) ──
  const parsed = await parseBody(req, chatRequestSchema);
  if (!parsed.success) return parsed.response;
  const { text, episodeId, mode, attachmentIds } = parsed.data;
  const hasAttachments = (attachmentIds?.length ?? 0) > 0;

  const episode = await db.episode.findUnique({ where: { id: episodeId } });
  if (!episode) {
    return NextResponse.json({ error: 'episode not found' }, { status: 404 });
  }

  // ── AUTO-AGENT ROUTING ──
  // В auto режиме проверяем: это задача для agent mode?
  // Если да — автоматически создаём agent task, не идём в chat pipeline.
  // Это transparent для пользователя — система сама выбирает правильный режим.
  if (mode === 'auto' && !hasAttachments && isAgentTask(text)) {
    logger.info('chat', 'Auto-routing to agent mode', {
      textPreview: text.slice(0, 80),
      reason: 'isAgentTask heuristic matched',
    });

    try {
      // Get capability profile для adaptive limits
      const { params: tierParams } = await getCognitiveParams();
      const goalText = text.trim();

      const { resolveToolsWhitelistForMode } = await import('@/lib/agent/kb-step-utils');
      const { needsSandboxConfirm } = await import('@/lib/agent/workspace-modes');
      let { mode: resolvedMode, toolsWhitelist } = resolveToolsWhitelistForMode({
        goal: goalText,
        workspaceModeInput: 'auto',
      });

      const { resolveWorkspace } = await import('@/lib/agent/workspace-binding');
      let resolved = await resolveWorkspace({
        episodeId,
        goal: goalText,
        explicitFsScope: null,
        workspaceMode: resolvedMode,
      });

      // Auto-agent cannot show confirm dialog — downgrade Edit→Explore
      // instead of silently writing into an empty sandbox.
      if (needsSandboxConfirm(resolvedMode, resolved.kind, false, {
        intentionalSandboxBinding: resolved.binding?.kind === 'sandbox',
        fsScopeAlreadyBound: !!resolved.fsScope,
      })) {
        logger.info('chat', 'Auto-agent Edit without project — downgrade to Explore', {
          goalPreview: goalText.slice(0, 80),
        });
        resolvedMode = 'explore';
        ({ toolsWhitelist } = resolveToolsWhitelistForMode({
          goal: goalText,
          workspaceModeInput: 'explore',
        }));
        resolved = await resolveWorkspace({
          episodeId,
          goal: goalText,
          explicitFsScope: null,
          workspaceMode: 'explore',
        });
      }

      const task = await createAgentTask({
        episodeId,
        goal: goalText,
        fsScope: resolved.fsScope,
        toolsWhitelist,
        maxSteps: tierParams.agentMaxSteps,
        maxDurationSec: tierParams.agentMaxDurationSec,
      });

      const userMessageId = await persistAgentGoalToChat(episodeId, goalText);

      // Auto-start runner in background
      runAgentTask(task.id).catch((e) => {
        logger.error('chat', `Auto-agent runner crashed`, { taskId: task.id.slice(0, 8) }, e);
      });

      // Return special response — client detects type='agent_task' and switches
      return NextResponse.json({
        type: 'agent_task',
        taskId: task.id,
        goal: goalText,
        userMessageId,
        workspaceMode: resolvedMode,
        message: 'Лия определила, что это задача для агентского режима. Переключаюсь...',
      });
    } catch (e) {
      logger.error('chat', 'Auto-agent routing failed, falling back to chat', {}, e);
      // Fall through to normal chat pipeline
    }
  }

  // ── Normal chat pipeline ──
  // Передаём req.signal — клиентский Stop button прервёт серверный LLM-вызов.
  const result = await runChatPipeline({
    text: text.trim(),
    episodeId,
    mode,
    attachmentIds,
    abortSignal: req.signal,
  });
  if (result instanceof NextResponse) {
    return result;  // pre-flight error
  }
  return result.response;
}

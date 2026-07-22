import 'server-only';

import { saveMessage } from '@/lib/memory/episodes';
import { logger } from '@/lib/logger';

export async function persistAgentGoalToChat(
  episodeId: string,
  goal: string,
): Promise<string | null> {
  const text = goal.trim();
  if (!text) return null;
  try {
    const msg = await saveMessage(episodeId, { role: 'user', content: text });
    return msg.id;
  } catch (e) {
    logger.warn('agent', 'Failed to persist agent goal to chat', { episodeId: episodeId.slice(0, 8) }, e);
    return null;
  }
}

export async function persistAgentResultToChat(
  task: { episodeId: string },
  content: string,
): Promise<string | null> {
  const text = content.trim();
  if (!text) return null;
  try {
    const msg = await saveMessage(task.episodeId, { role: 'companion', content: text });
    return msg.id;
  } catch (e) {
    logger.warn('agent', 'Failed to persist agent result to chat', {
      episodeId: task.episodeId.slice(0, 8),
    }, e);
    return null;
  }
}

export async function emitTaskFailedToChat(
  task: { id: string; episodeId: string },
  error: string,
): Promise<void> {
  const { emitAgentEvent } = await import('./events');
  const chatMessageId = await persistAgentResultToChat(
    task,
    `Не удалось выполнить задачу.\n\n${error}`,
  );
  emitAgentEvent({
    type: 'task_failed',
    taskId: task.id,
    error,
    ...(chatMessageId ? { chatMessageId } : {}),
    ts: Date.now(),
  });
}

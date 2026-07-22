import 'server-only';

// AgentTask — CRUD для агентских задач.

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export type AgentTaskStatus =
  | 'pending'
  | 'planning'
  | 'executing'
  | 'waiting_input'
  | 'synthesizing'
  | 'done'
  | 'failed'
  | 'cancelled';

export const AGENT_TRANSIENT_STATUSES = [
  'planning',
  'executing',
  'waiting_input',
  'synthesizing',
] as const satisfies readonly AgentTaskStatus[];

export type AgentTask = {
  id: string;
  episodeId: string;
  goal: string;
  status: AgentTaskStatus;
  planJson: string | null;
  currentStep: number;
  stepsJson: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  maxSteps: number;
  maxDurationSec: number;
  toolsWhitelist: string | null;
  fsScope: string | null;
  checkpointJson: string | null;
  resultSummary: string | null;
  artifactsJson: string;
};

export type CreateAgentTaskInput = {
  episodeId: string;
  goal: string;
  toolsWhitelist?: string[] | null;
  fsScope?: string | null;
  maxSteps?: number;
  maxDurationSec?: number;
};

export async function createAgentTask(input: CreateAgentTaskInput): Promise<AgentTask> {
  const task = await db.agentTask.create({
    data: {
      id: randomUUID(),
      episodeId: input.episodeId,
      goal: input.goal,
      status: 'pending',
      maxSteps: input.maxSteps ?? 15,
      maxDurationSec: input.maxDurationSec ?? 600,
      toolsWhitelist: input.toolsWhitelist ? JSON.stringify(input.toolsWhitelist) : null,
      fsScope: input.fsScope ?? null,
      stepsJson: '[]',
      artifactsJson: '[]',
    },
  });
  return toAgentTask(task);
}

export async function getAgentTask(id: string): Promise<AgentTask | null> {
  const task = await db.agentTask.findUnique({ where: { id } });
  return task ? toAgentTask(task) : null;
}

export async function listAgentTasks(
  episodeId?: string,
  limit = 50,
): Promise<AgentTask[]> {
  const tasks = await db.agentTask.findMany({
    where: episodeId ? { episodeId } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return tasks.map(toAgentTask);
}

export async function updateAgentTask(id: string, params: Partial<{
  status: AgentTaskStatus;
  planJson: string | null;
  currentStep: number;
  stepsJson: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  checkpointJson: string | null;
  resultSummary: string | null;
  artifactsJson: string;
}>): Promise<AgentTask | null> {
  try {
    const task = await db.agentTask.update({
      where: { id },
      data: params,
    });
    return toAgentTask(task);
  } catch {
    return null;
  }
}

function toAgentTask(row: {
  id: string;
  episodeId: string;
  goal: string;
  status: string;
  planJson: string | null;
  currentStep: number;
  stepsJson: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  maxSteps: number;
  maxDurationSec: number;
  toolsWhitelist: string | null;
  fsScope: string | null;
  checkpointJson: string | null;
  resultSummary: string | null;
  artifactsJson: string;
}): AgentTask {
  return {
    id: row.id,
    episodeId: row.episodeId,
    goal: row.goal,
    status: row.status as AgentTaskStatus,
    planJson: row.planJson,
    currentStep: row.currentStep,
    stepsJson: row.stepsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error: row.error,
    maxSteps: row.maxSteps,
    maxDurationSec: row.maxDurationSec,
    toolsWhitelist: row.toolsWhitelist,
    fsScope: row.fsScope,
    checkpointJson: row.checkpointJson,
    resultSummary: row.resultSummary,
    artifactsJson: row.artifactsJson,
  };
}

export function parseSteps(stepsJson: string): Array<{
  thought: string;
  action: string;
  input: unknown;
  observation: string;
  ts: number;
  durationMs: number;
}> {
  try {
    const parsed = JSON.parse(stepsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export type AgentArtifactEntry = {
  kind: string;
  path: string;
  meta?: Record<string, unknown>;
};

export function parseArtifacts(artifactsJson: string): AgentArtifactEntry[] {
  try {
    const parsed = JSON.parse(artifactsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export async function appendAgentTaskArtifact(
  taskId: string,
  entry: AgentArtifactEntry,
): Promise<void> {
  const row = await db.agentTask.findUnique({
    where: { id: taskId },
    select: { artifactsJson: true },
  });
  if (!row) return;
  const artifacts = parseArtifacts(row.artifactsJson);
  artifacts.push(entry);
  await db.agentTask.update({
    where: { id: taskId },
    data: { artifactsJson: JSON.stringify(artifacts) },
  });
}

export function formatOpenTasksForPrompt(tasks: AgentTask[]): string {
  const active = tasks.filter(t =>
    t.status === 'pending' || t.status === 'planning' || t.status === 'executing' ||
    t.status === 'waiting_input' || t.status === 'synthesizing'
  );
  if (active.length === 0) return '';
  return active.map(t => `- [${t.status}] ${t.goal} (шаг ${t.currentStep}/${t.maxSteps})`).join('\n');
}

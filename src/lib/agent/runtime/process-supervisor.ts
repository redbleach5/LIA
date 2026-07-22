import 'server-only';

// ============================================================================
// Process Supervisor — long-running artifact runtimes (dev servers, scripts).
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { scrubCommandEnv } from '../tools/run-command';
import { emitAgentEvent } from '../events';
import { logger } from '@/lib/logger';
import type {
  ProjectDesign,
  RuntimeLogLine,
  RuntimeSessionSnapshot,
  RuntimeStatus,
} from './types';
import { previewUrlForDesign } from './project-manifest';
import { parseRuntimeScript } from './script-parse';
import type { ParsedScript } from './script-parse';

export type { ParsedScript };
export { parseRuntimeScript };

const MAX_LOG_LINES = 400;
const MAX_RESTARTS = 3;
const HEALTH_TIMEOUT_MS = 25_000;
const HEALTH_POLL_MS = 400;

type Session = {
  taskId: string;
  child: ChildProcess | null;
  status: RuntimeStatus;
  scriptKey?: string;
  command?: string;
  args: string[];
  cwd: string;
  port: number | null;
  previewUrl: string | null;
  restartCount: number;
  lastError: string | null;
  startedAt: number | null;
  logs: RuntimeLogLine[];
  killing: boolean;
};

const globalKey = '__lia_runtime_sessions__';
function getSessions(): Map<string, Session> {
  const g = globalThis as unknown as { [key: string]: Map<string, Session> };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function ensureSession(taskId: string): Session {
  const sessions = getSessions();
  let s = sessions.get(taskId);
  if (!s) {
    s = {
      taskId,
      child: null,
      status: 'idle',
      args: [],
      cwd: '',
      port: null,
      previewUrl: null,
      restartCount: 0,
      lastError: null,
      startedAt: null,
      logs: [],
      killing: false,
    };
    sessions.set(taskId, s);
  }
  return s;
}

function pushLog(session: Session, stream: RuntimeLogLine['stream'], text: string) {
  const line: RuntimeLogLine = { stream, text, ts: Date.now() };
  session.logs.push(line);
  if (session.logs.length > MAX_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
  }
  emitAgentEvent({
    type: 'runtime_log',
    taskId: session.taskId,
    stream,
    text: text.slice(0, 2000),
    ts: line.ts,
  });
}

function emitStatus(session: Session) {
  emitAgentEvent({
    type: 'runtime_status',
    taskId: session.taskId,
    status: session.status,
    port: session.port,
    previewUrl: session.previewUrl,
    pid: session.child?.pid ?? null,
    restartCount: session.restartCount,
    lastError: session.lastError,
    scriptKey: session.scriptKey ?? null,
    ts: Date.now(),
  });
}

function setStatus(session: Session, status: RuntimeStatus, lastError?: string | null) {
  session.status = status;
  if (lastError !== undefined) session.lastError = lastError;
  emitStatus(session);
}

async function probePort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}

async function waitHealthy(session: Session): Promise<boolean> {
  if (!session.port) {
    // No port — treat as healthy if process still alive after short settle
    await new Promise(r => setTimeout(r, 800));
    if (session.child && !session.child.killed && session.status !== 'stopped' && session.status !== 'error') {
      setStatus(session, 'running');
      return true;
    }
    return false;
  }
  const healthy = await probePort(session.port, HEALTH_TIMEOUT_MS);
  if (healthy) {
    setStatus(session, 'healthy');
    pushLog(session, 'system', `Health OK — порт ${session.port} слушает`);
    return true;
  }
  setStatus(session, 'unhealthy', `Порт ${session.port} не отвечает за ${HEALTH_TIMEOUT_MS}ms`);
  pushLog(session, 'system', session.lastError ?? 'unhealthy');
  return false;
}

function attachChild(session: Session, child: ChildProcess) {
  session.child = child;
  child.stdout?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.length) pushLog(session, 'stdout', line);
    }
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const text = buf.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.length) pushLog(session, 'stderr', line);
    }
  });
  child.on('error', (err) => {
    if (session.killing) return;
    pushLog(session, 'system', `spawn error: ${err.message}`);
    setStatus(session, 'error', err.message);
  });
  child.on('exit', (code, signal) => {
    session.child = null;
    if (session.killing) {
      setStatus(session, 'stopped');
      return;
    }
    const msg = `process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    pushLog(session, 'system', msg);
    if (session.status === 'healthy' || session.status === 'running' || session.status === 'starting') {
      setStatus(session, code === 0 ? 'stopped' : 'error', code === 0 ? null : msg);
    }
  });
}

export type StartRuntimeInput = {
  taskId: string;
  cwd: string;
  script: string;
  scriptKey?: string;
  port?: number | null;
  previewUrl?: string | null;
};

export type StartRuntimeResult = {
  success: boolean;
  status: RuntimeStatus;
  error?: string;
  pid?: number | null;
  port?: number | null;
  previewUrl?: string | null;
  restartCount: number;
};

export async function startRuntime(input: StartRuntimeInput): Promise<StartRuntimeResult> {
  const parsed = parseRuntimeScript(input.script);
  if (!parsed.ok) {
    return { success: false, status: 'error', error: parsed.error, restartCount: 0 };
  }

  const session = ensureSession(input.taskId);
  if (session.child && !session.child.killed) {
    await stopRuntime(input.taskId);
  }

  session.cwd = input.cwd;
  session.scriptKey = input.scriptKey;
  session.command = parsed.command;
  session.args = parsed.args;
  session.port = input.port ?? null;
  session.previewUrl = input.previewUrl ?? null;
  session.restartCount += session.startedAt ? 1 : 0;
  if (session.restartCount > MAX_RESTARTS) {
    const err = `Превышен лимит перезапусков (${MAX_RESTARTS})`;
    setStatus(session, 'error', err);
    return { success: false, status: 'error', error: err, restartCount: session.restartCount };
  }

  session.killing = false;
  session.startedAt = Date.now();
  setStatus(session, 'starting', null);
  pushLog(
    session,
    'system',
    `Starting: ${parsed.command} ${parsed.args.join(' ')} (cwd=${input.cwd})`,
  );

  try {
    const child = spawn(parsed.command, parsed.args, {
      cwd: input.cwd,
      env: scrubCommandEnv() as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    attachChild(session, child);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(session, 'error', msg);
    return { success: false, status: 'error', error: msg, restartCount: session.restartCount };
  }

  const healthy = await waitHealthy(session);
  return {
    success: healthy,
    status: session.status,
    error: healthy ? undefined : (session.lastError ?? 'runtime unhealthy'),
    pid: session.child?.pid ?? null,
    port: session.port,
    previewUrl: session.previewUrl,
    restartCount: session.restartCount,
  };
}

export async function startRuntimeFromDesign(
  taskId: string,
  cwd: string,
  design: ProjectDesign,
  scriptKey: 'dev' | 'start' = 'dev',
): Promise<StartRuntimeResult> {
  const script = design.scripts[scriptKey] ?? design.scripts.start ?? design.scripts.dev;
  if (!script) {
    return {
      success: false,
      status: 'error',
      error: `scripts.${scriptKey} missing in lia.project.json`,
      restartCount: 0,
    };
  }
  return startRuntime({
    taskId,
    cwd,
    script,
    scriptKey,
    port: design.preview.port ?? null,
    previewUrl: previewUrlForDesign(design),
  });
}

export async function stopRuntime(taskId: string): Promise<{ success: boolean; status: RuntimeStatus }> {
  const sessions = getSessions();
  const session = sessions.get(taskId);
  if (!session) return { success: true, status: 'idle' };

  session.killing = true;
  const child = session.child;
  if (child && !child.killed) {
    pushLog(session, 'system', 'Stopping runtime…');
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    // Force kill after grace
    await new Promise(r => setTimeout(r, 800));
    if (session.child && !session.child.killed) {
      try {
        session.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
  session.child = null;
  setStatus(session, 'stopped');
  logger.info('agent', 'runtime stopped', { taskId: taskId.slice(0, 8) });
  return { success: true, status: 'stopped' };
}

export function getRuntimeLogs(taskId: string, limit = 80): RuntimeLogLine[] {
  const session = getSessions().get(taskId);
  if (!session) return [];
  return session.logs.slice(-Math.max(1, Math.min(limit, MAX_LOG_LINES)));
}

export function getRuntimeSnapshot(taskId: string): RuntimeSessionSnapshot | null {
  const session = getSessions().get(taskId);
  if (!session) return null;
  return {
    taskId,
    status: session.status,
    scriptKey: session.scriptKey,
    command: session.command,
    args: session.args,
    cwd: session.cwd || undefined,
    port: session.port,
    previewUrl: session.previewUrl,
    pid: session.child?.pid ?? null,
    restartCount: session.restartCount,
    lastError: session.lastError,
    startedAt: session.startedAt,
  };
}

export { MAX_RESTARTS };
export { stepsHaveRuntimeVerify } from './verify';

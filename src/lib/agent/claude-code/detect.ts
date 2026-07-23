import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ClaudeBinaryInfo = {
  ok: boolean;
  path: string | null;
  version: string | null;
  error?: string;
};

function pathCandidates(): string[] {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const names = process.platform === 'win32'
    ? ['claude.exe', 'claude.cmd', 'claude']
    : ['claude'];
  const out: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      out.push(join(dir, name));
    }
  }
  return out;
}

export async function resolveClaudeBinary(): Promise<string | null> {
  for (const candidate of pathCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      try {
        await access(candidate, constants.F_OK);
        return candidate;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

export async function detectClaudeBinary(): Promise<ClaudeBinaryInfo> {
  const path = await resolveClaudeBinary();
  if (!path) {
    return {
      ok: false,
      path: null,
      version: null,
      error: 'Claude Code CLI не найден в PATH. Установи: https://docs.anthropic.com/en/docs/claude-code',
    };
  }
  try {
    const { stdout } = await execFileAsync(path, ['--version'], {
      timeout: 8_000,
      windowsHide: true,
      env: scrubMinimalEnv(),
    });
    return { ok: true, path, version: stdout.trim().slice(0, 120) || null };
  } catch (e) {
    return {
      ok: true,
      path,
      version: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Minimal env for version probe (no Anthropic keys). */
function scrubMinimalEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: '',
  };
}

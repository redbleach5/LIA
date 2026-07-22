import 'server-only';

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { db } from '../db';
import { PROJECT_ROOT } from '../paths';
import { logger } from '../logger';
import { removeEnvVar, upsertEnvVar } from './env-file-upsert';

const DB_KEYS = {
  baseUrl: 'ollama_base_url',
  model: 'ollama_model',
  agentModel: 'ollama_agent_model',
  embedModel: 'ollama_embed_model',
} as const;

export type OllamaEnvSnapshot = {
  baseUrl: string;
  model: string;
  agentModel: string;
  embedModel: string;
};

function envPath(): string {
  return join(PROJECT_ROOT, '.env');
}

/** Mirror effective Ollama settings into process.env (CLI scripts in same process). */
export function applyOllamaToProcessEnv(snapshot: OllamaEnvSnapshot): void {
  process.env.OLLAMA_BASE_URL = snapshot.baseUrl;
  process.env.OLLAMA_MODEL = snapshot.model;
  if (snapshot.agentModel.trim()) {
    process.env.OLLAMA_AGENT_MODEL = snapshot.agentModel.trim();
  } else {
    delete process.env.OLLAMA_AGENT_MODEL;
  }
  if (snapshot.embedModel.trim()) {
    process.env.OLLAMA_EMBED_MODEL = snapshot.embedModel.trim();
  } else {
    delete process.env.OLLAMA_EMBED_MODEL;
  }
}

/**
 * Write OLLAMA_* keys in .env to match runtime settings (DB/UI).
 * Returns false if .env is missing.
 */
export function writeOllamaEnvFile(snapshot: OllamaEnvSnapshot): boolean {
  const path = envPath();
  if (!existsSync(path)) return false;

  let content = readFileSync(path, 'utf-8');
  content = upsertEnvVar(content, 'OLLAMA_BASE_URL', snapshot.baseUrl);
  content = upsertEnvVar(content, 'OLLAMA_MODEL', snapshot.model);

  if (snapshot.agentModel.trim()) {
    content = upsertEnvVar(content, 'OLLAMA_AGENT_MODEL', snapshot.agentModel.trim());
  } else {
    content = removeEnvVar(content, 'OLLAMA_AGENT_MODEL');
  }

  if (snapshot.embedModel.trim()) {
    content = upsertEnvVar(content, 'OLLAMA_EMBED_MODEL', snapshot.embedModel.trim());
  } else {
    content = removeEnvVar(content, 'OLLAMA_EMBED_MODEL');
  }

  writeFileSync(path, content, 'utf-8');
  applyOllamaToProcessEnv(snapshot);
  return true;
}

async function seedDbFromSnapshot(snapshot: OllamaEnvSnapshot): Promise<void> {
  await db.setting.upsert({
    where: { key: DB_KEYS.baseUrl },
    create: { key: DB_KEYS.baseUrl, value: snapshot.baseUrl },
    update: { value: snapshot.baseUrl },
  });
  await db.setting.upsert({
    where: { key: DB_KEYS.model },
    create: { key: DB_KEYS.model, value: snapshot.model },
    update: { value: snapshot.model },
  });

  const agent = snapshot.agentModel.trim();
  if (agent) {
    await db.setting.upsert({
      where: { key: DB_KEYS.agentModel },
      create: { key: DB_KEYS.agentModel, value: agent },
      update: { value: agent },
    });
  } else {
    await db.setting.deleteMany({ where: { key: DB_KEYS.agentModel } });
  }

  const embed = snapshot.embedModel.trim();
  if (embed) {
    await db.setting.upsert({
      where: { key: DB_KEYS.embedModel },
      create: { key: DB_KEYS.embedModel, value: embed },
      update: { value: embed },
    });
  } else {
    await db.setting.deleteMany({ where: { key: DB_KEYS.embedModel } });
  }
}

let reconcileDone = false;

/**
 * On first server boot: seed DB from .env if empty; else push DB values into .env.
 */
export async function reconcileOllamaEnvAndDb(snapshot: OllamaEnvSnapshot): Promise<void> {
  if (reconcileDone) return;
  reconcileDone = true;

  try {
    const row = await db.setting.findUnique({ where: { key: DB_KEYS.model } });
    const hasDbModel = !!row?.value?.trim();

    if (!hasDbModel) {
      await seedDbFromSnapshot(snapshot);
      const wrote = writeOllamaEnvFile(snapshot);
      logger.info('llm', 'Ollama settings seeded from .env into DB', {
        model: snapshot.model,
        envFileUpdated: wrote,
      });
      return;
    }

    const wrote = writeOllamaEnvFile(snapshot);
    if (wrote) {
      logger.info('llm', 'Synced Ollama settings from DB to .env', {
        model: snapshot.model,
        agentModel: snapshot.agentModel || '(same as chat)',
        embedModel: snapshot.embedModel || 'auto',
      });
    }
  } catch (e) {
    reconcileDone = false;
    logger.warn('llm', 'Ollama .env/DB reconcile failed (non-fatal)', {}, e);
  }
}

/** After UI save — keep .env in sync without re-running full reconcile. */
export function syncOllamaEnvFileAfterSave(snapshot: OllamaEnvSnapshot): void {
  try {
    if (writeOllamaEnvFile(snapshot)) {
      logger.debug('llm', 'Updated .env OLLAMA_* after settings save', { model: snapshot.model });
    }
  } catch (e) {
    logger.warn('llm', 'Failed to update .env after settings save (non-fatal)', {}, e);
  }
}

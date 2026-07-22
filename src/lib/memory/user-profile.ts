import 'server-only';

import {
  USER_NAME_FACT_KEY,
  deleteGlobalFact,
  getGlobalFact,
  upsertGlobalFact,
} from './facts';

const MAX_DISPLAY_NAME_LEN = 80;

/** Display name from global fact user.name (settings + fact extraction). */
export async function getUserDisplayName(): Promise<string | null> {
  const name = await getGlobalFact(USER_NAME_FACT_KEY);
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

export async function setUserDisplayName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    await deleteGlobalFact(USER_NAME_FACT_KEY);
    return;
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LEN) {
    throw new Error(`display name too long (max ${MAX_DISPLAY_NAME_LEN})`);
  }
  await upsertGlobalFact(USER_NAME_FACT_KEY, trimmed, 1);
}

export { MAX_DISPLAY_NAME_LEN };

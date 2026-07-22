// ============================================================================
// kb-backup.mjs — атомарный backup SQLite DB через Online Backup API.
// ============================================================================
//
// Запуск:
//   bun run kb:backup [path]
//   bun run kb:backup                    # → db/backup-YYYY-MM-DD-HHMMSS.db
//   bun run kb:backup /tmp/my-backup.db  # → /tmp/my-backup.db
//
// Что делает:
//   1. WAL checkpoint (TRUNCATE) — сливает WAL в основной файл
//   2. better-sqlite3 db.backup(targetPath) — atomic snapshot через
//      SQLite Online Backup API. Не блокирует writes, не даёт torn pages.
//   3. Копирует -wal и -shm файлы рядом (на всякий случай)
//
// Почему не `cp db/custom.db`:
//   - cp может попасть в момент mid-write → torn page → "database disk image is malformed"
//   - cp не копирует WAL — теряются последние транзакции после checkpoint'а
//   - better-sqlite3 db.backup() использует SQLite Online Backup API — атомарно

import Database from 'better-sqlite3';
import { resolveDbPath } from '../src/lib/paths.ts';
import { copyFile, existsSync } from 'fs';
import path from 'path';

const targetArg = process.argv[2];

// Determine backup path
let backupPath;
if (targetArg) {
  backupPath = path.resolve(targetArg);
} else {
  const dbPath = resolveDbPath(process.env.DATABASE_URL);
  const dbDir = path.dirname(dbPath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  backupPath = path.join(dbDir, `backup-${ts}.db`);
}

// Resolve source DB path
const sourceDbPath = resolveDbPath(process.env.DATABASE_URL);

if (!existsSync(sourceDbPath)) {
  console.error(`❌ Source DB not found: ${sourceDbPath}`);
  console.error('   Run `bun run db:push` first to initialize the database.');
  process.exit(1);
}

console.log(`📦 Backing up SQLite database`);
console.log(`   Source: ${sourceDbPath}`);
console.log(`   Target: ${backupPath}`);

// Open source DB (better-sqlite3)
const db = new Database(sourceDbPath, { readonly: true });

try {
  // 1. WAL checkpoint (TRUNCATE) — сливаем WAL в основной файл
  //    Backup и так атомарный, но checkpoint уменьшает размер backup'а
  //    (без WAL-записей) и убеждается что все commits на диске.
  console.log('   Checkpointing WAL...');
  db.pragma('wal_checkpoint(TRUNCATE)');

  // 2. Atomic backup through SQLite Online Backup API
  console.log('   Creating atomic snapshot...');
  await db.backup(backupPath);

  console.log(`✓ Backup created: ${backupPath}`);
} catch (e) {
  console.error(`❌ Backup failed: ${e.message}`);
  process.exit(1);
} finally {
  db.close();
}

// 3. Copy -wal and -shm files if they exist (extra safety)
const walPath = `${sourceDbPath}-wal`;
const shmPath = `${sourceDbPath}-shm`;
const backupWalPath = `${backupPath}-wal`;
const backupShmPath = `${backupPath}-shm`;

if (existsSync(walPath)) {
  await copyFile(walPath, backupWalPath);
  console.log(`   Copied WAL: ${backupWalPath}`);
}
if (existsSync(shmPath)) {
  await copyFile(shmPath, backupShmPath);
  console.log(`   Copied SHM: ${backupShmPath}`);
}

console.log('');
console.log('To restore:');
console.log(`  1. Stop the server`);
console.log(`  2. cp ${backupPath} ${sourceDbPath}`);
console.log(`  3. Restart the server`);

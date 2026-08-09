// Migrations, run by the host itself.
//
// A program you launch can't ask you to install wrangler and run a
// migration command first. So the host applies `migrations/*.sql` on
// boot, tracking what it has done in `d1_migrations` — the same table
// wrangler uses, with the same shape, so a database can be handed
// between the two without either getting confused.
//
// Whole files are executed at once rather than split on semicolons:
// migration 0006 defines triggers, whose bodies contain semicolons, and
// every naive splitter mangles them.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function migrate(d1, dir, log = () => {}) {
  const db = d1.raw;
  db.exec(
    `CREATE TABLE IF NOT EXISTS d1_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT UNIQUE,
       applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
     )`,
  );

  const applied = new Set(
    db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name),
  );

  const files = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(dir, name), 'utf8');
    // Each migration is all-or-nothing. A half-applied schema is worse
    // than an unapplied one, because the next boot thinks it's done.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} failed: ${e.message}`);
    }
    log(`applied ${name}`);
    ran++;
  }
  return { ran, total: files.length };
}

// D1, but it's a file on your disk.
//
// The worker asks for `env.DB.prepare(sql).bind(...).all()` and doesn't
// care what's underneath. On Cloudflare that's D1; here it's node:sqlite,
// which is SQLite compiled into node itself — no native module to build,
// nothing to install, and (checked, because the book index depends on it)
// FTS5 is compiled in.
//
// The shim exists so the 2,300 lines of route code never learn where they
// are. That property is the whole reason one codebase can run in two
// places, and it only survives if nothing here leaks upward.

import { DatabaseSync } from 'node:sqlite';

/**
 * SQLite takes numbers, strings, bigints, null and bytes. Everything else
 * is a mistake somewhere upstream — except booleans, which D1 quietly
 * accepts and which the worker does pass, so they're worth translating
 * rather than throwing over.
 */
function bindable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** D1 hands back `{ results, success, meta }`; callers read `.results`. */
function wrap(results) {
  return { results, success: true, meta: { duration: 0, changes: 0 } };
}

class Prepared {
  #db;
  #sql;
  #params;

  constructor(db, sql, params = []) {
    this.#db = db;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...params) {
    return new Prepared(this.#db, this.#sql, params.map(bindable));
  }

  #stmt() {
    return this.#db.prepare(this.#sql);
  }

  async all() {
    return wrap(this.#stmt().all(...this.#params));
  }

  async first(column) {
    const row = this.#stmt().get(...this.#params);
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  }

  async run() {
    const info = this.#stmt().run(...this.#params);
    return {
      success: true,
      meta: {
        duration: 0,
        changes: Number(info.changes ?? 0),
        last_row_id: Number(info.lastInsertRowid ?? 0),
      },
    };
  }

  /** Used by batch(), which needs to drive statements synchronously. */
  _exec() {
    this.#stmt().run(...this.#params);
  }
}

export class D1 {
  #db;

  constructor(file) {
    this.#db = new DatabaseSync(file);
    // WAL keeps readers from blocking on the writer, which matters the
    // moment a table has six screens on it. The event log (rule 3) means
    // writes are constant, so this isn't a micro-optimisation.
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec('PRAGMA busy_timeout = 5000');
  }

  prepare(sql) {
    return new Prepared(this.#db, sql);
  }

  async batch(statements) {
    // D1's batch is atomic; so is this. A half-applied page index would
    // leave the search index disagreeing with the pages table.
    this.#db.exec('BEGIN');
    try {
      for (const statement of statements) statement._exec();
      this.#db.exec('COMMIT');
    } catch (e) {
      this.#db.exec('ROLLBACK');
      throw e;
    }
    return statements.map(() => wrap([]));
  }

  async exec(sql) {
    this.#db.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Escape hatch for the migration runner and the DO's storage. */
  get raw() {
    return this.#db;
  }
}

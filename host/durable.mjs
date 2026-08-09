// Durable Objects, minus the durable part being someone else's problem.
//
// On Cloudflare a DO is a globally-unique addressable instance with its
// own storage, and that machinery exists to solve a distributed problem:
// which of a hundred datacentres owns this campaign's live session.
//
// A host under a table has one process. So the whole answer is a Map of
// instances and a key/value table — and the session is *more* consistent
// than it was, not less, because there was never more than one of it and
// now there provably can't be.
//
// `CampaignDO` needs exactly two things from `ctx`: storage.get and
// storage.put. That's the entire contract being reimplemented here.

/** Key/value for one instance, kept in the same SQLite file as everything else. */
class Storage {
  #db;
  #name;

  constructor(db, name) {
    this.#db = db;
    this.#name = name;
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS do_storage (
         instance TEXT NOT NULL,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         PRIMARY KEY (instance, key)
       )`,
    );
  }

  async get(key) {
    const row = this.#db
      .prepare('SELECT value FROM do_storage WHERE instance = ? AND key = ?')
      .get(this.#name, key);
    return row ? JSON.parse(row.value) : undefined;
  }

  async put(key, value) {
    this.#db
      .prepare(
        `INSERT INTO do_storage (instance, key, value) VALUES (?, ?, ?)
         ON CONFLICT (instance, key) DO UPDATE SET value = excluded.value`,
      )
      .run(this.#name, key, JSON.stringify(value));
  }

  async delete(key) {
    this.#db
      .prepare('DELETE FROM do_storage WHERE instance = ? AND key = ?')
      .run(this.#name, key);
  }
}

/**
 * Stands in for a DurableObjectNamespace.
 *
 * `idFromName` is identity-by-name, which is all the worker uses it for:
 * one campaign, one instance, forever. Instances are created lazily and
 * then kept, because the live session lives in memory between requests —
 * that's the point of a DO, and it's the one behaviour that has to
 * survive the translation.
 */
export class DurableNamespace {
  #db;
  #ClassRef;
  #instances = new Map();

  constructor(db, ClassRef) {
    this.#db = db;
    this.#ClassRef = ClassRef;
  }

  idFromName(name) {
    return { name, toString: () => name };
  }

  get(id) {
    const name = typeof id === 'string' ? id : id.name;
    let instance = this.#instances.get(name);
    if (!instance) {
      instance = new this.#ClassRef({ storage: new Storage(this.#db, name) });
      this.#instances.set(name, instance);
    }
    // A stub, so callers keep writing `.get(id).fetch(url, init)`.
    return {
      fetch: (input, init) =>
        instance.fetch(input instanceof Request ? input : new Request(input, init)),
    };
  }
}

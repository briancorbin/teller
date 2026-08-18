// Where everything lives. `docs/CORE-NEXT.md` §11/§12.
//
// Two kinds of database, split exactly on rule 9's line:
//
//   * `shelf.db` — this MACHINE's assets: systems, packs, books,
//     boards, the room's displays. What a publisher wrote stays put.
//   * `campaigns/<slug>.db` — one campaign, whole: its entities, its
//     event log, its live board state. What you wrote travels — backup
//     is copying one file, and a campaign can live on a stick you
//     carry.
//
// The campaign is the FILE. There is no campaigns table, no `cmp_` id
// scoping every request, no root_id column anywhere — scoping IS the
// file, and boot-time loading is the resolution law finding its home.
// The manifest (name, system ref, pack order, party resources) is the
// root entity row, `parent_id IS NULL`.
//
// One runtime (§16): this is `node:sqlite` directly — no D1 interface,
// no boolean coercion shim, nothing pretending it might run somewhere
// else. Cloudflare is a brochure.
//
// Raw rows never cross this module's boundary (rule 8): everything out
// goes through the forgiving coercers, everything in is written strict.
// And every mutation appends to the event log (rule 3) — created,
// updated and deleted each carry enough of the before/after to walk
// backward from, because `/undo` is a reader of this table, not a
// feature bolted on later.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from './id.ts';
import { toEntity, type Entity } from './entity.ts';

const now = () => new Date().toISOString();

/**
 * A campaign file's name on disk. Lowercase words and dashes only —
 * this is a FILENAME, and a slug that could walk out of `campaigns/`
 * is not a campaign, it's a path traversal.
 */
export function validSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

function assertSlug(slug: string): void {
  if (!validSlug(slug)) {
    throw new Error(
      `not a campaign slug: ${JSON.stringify(slug)} (lowercase letters, digits and dashes)`,
    );
  }
}

function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

// ---------------------------------------------------------------------
// The campaign file.

const CAMPAIGN_SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  type       TEXT,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entities_parent ON entities(parent_id);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  entity_id  TEXT,
  actor      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_entity ON events(entity_id);
CREATE TABLE IF NOT EXISTS board_state (
  board_id   TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  slot       TEXT NOT NULL,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS templates_slot ON templates(slot);
`;

export type EventRow = {
  id: number;
  entityId: string | null;
  actor: string;
  kind: string;
  payload: unknown;
  createdAt: string;
};

/** What goes into a fresh entity — everything but the minted id. */
export type EntityDraft = Omit<Entity, 'id'> & { id?: string };

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function rowToEntity(row: Row): Entity {
  const data = (parseJson(row.data) ?? {}) as Record<string, unknown>;
  const entity = toEntity({
    ...data,
    id: row.id,
    name: row.name,
    type: row.type ?? undefined,
  });
  // The row held a name, so coercion cannot refuse it; the fallback is
  // for the type system, not for a path that runs.
  return entity ?? { id: String(row.id), name: String(row.name), lists: {} };
}

function rowToEvent(row: Row): EventRow {
  return {
    id: Number(row.id),
    entityId: row.entity_id === null ? null : String(row.entity_id),
    actor: String(row.actor),
    kind: String(row.kind),
    payload: parseJson(row.payload),
    createdAt: String(row.created_at),
  };
}

/** The blob half of an entity — promoted columns stripped, never stored twice. */
function blobOf(entity: Entity): string {
  const { id: _id, name: _name, type: _type, ...data } = entity;
  return JSON.stringify(data);
}

export class Campaign {
  #db: DatabaseSync;
  readonly slug: string;

  constructor(db: DatabaseSync, slug: string) {
    this.#db = db;
    this.slug = slug;
  }

  /** The manifest — the root entity, `parent_id IS NULL`. */
  root(): Entity {
    const row = this.#db
      .prepare('SELECT * FROM entities WHERE parent_id IS NULL')
      .get() as Row | undefined;
    if (!row) throw new Error(`campaign ${this.slug} has no manifest row`);
    return rowToEntity(row);
  }

  get(id: string): Entity | undefined {
    const row = this.#db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  /** Promoted children, oldest first — inline ones live in the parent's blob. */
  children(parentId: string): Entity[] {
    const rows = this.#db
      .prepare(
        'SELECT * FROM entities WHERE parent_id = ? ORDER BY created_at, id',
      )
      .all(parentId) as Row[];
    return rows.map(rowToEntity);
  }

  /** Who a promoted entity is contained by, or nothing at the root. */
  parentOf(id: string): string | undefined {
    const row = this.#db
      .prepare('SELECT parent_id FROM entities WHERE id = ?')
      .get(id) as Row | undefined;
    return row?.parent_id ?? undefined;
  }

  /**
   * A new promoted entity. No parent means a child of the manifest —
   * an entity floating outside the tree isn't a thing.
   */
  create(draft: EntityDraft, actor: string, parentId?: string): Entity {
    const parent = parentId ?? this.root().id;
    const entity = toEntity({ ...draft, id: draft.id ?? newId('ent') });
    if (!entity) throw new Error('an entity needs at least a name');
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO entities (id, parent_id, name, type, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entity.id,
        parent,
        entity.name,
        entity.type ?? null,
        blobOf(entity),
        at,
        at,
      );
    this.append(entity.id, actor, 'entity.created', { after: entity });
    return entity;
  }

  /** Write an entity back, whole. The stored value is the authority; this is how a human types over anything. */
  save(entity: Entity, actor: string): Entity {
    const before = this.get(entity.id);
    if (!before) throw new Error(`no entity ${entity.id} to save`);
    this.#db
      .prepare(
        'UPDATE entities SET name = ?, type = ?, data = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        entity.name,
        entity.type ?? null,
        blobOf(entity),
        now(),
        entity.id,
      );
    this.append(entity.id, actor, 'entity.updated', { before, after: entity });
    return entity;
  }

  /**
   * Delete an entity and everything promoted under it — containment
   * means the nested things go with their owner. One event per row, so
   * the log can put every one of them back.
   */
  remove(id: string, actor: string): void {
    for (const child of this.children(id)) this.remove(child.id, actor);
    const before = this.get(id);
    if (!before) return;
    this.#db.prepare('DELETE FROM entities WHERE id = ?').run(id);
    this.append(id, actor, 'entity.deleted', { before });
  }

  /**
   * Reparent a promoted entity — handing the pistol over IS this, and
   * its history rides along because history lives here, keyed by the
   * id that didn't change.
   */
  move(id: string, parentId: string, actor: string): void {
    const before = this.parentOf(id);
    if (before === undefined && this.get(id) === undefined) {
      throw new Error(`no entity ${id} to move`);
    }
    this.#db
      .prepare('UPDATE entities SET parent_id = ?, updated_at = ? WHERE id = ?')
      .run(parentId, now(), id);
    this.append(id, actor, 'entity.moved', { from: before, to: parentId });
  }

  // -- the event log --------------------------------------------------

  /** Rule 3, as an API: who, what, payload. App-level kinds (`turn.resolved`) come through here too. */
  append(
    entityId: string | null,
    actor: string,
    kind: string,
    payload?: unknown,
  ): void {
    this.#db
      .prepare(
        'INSERT INTO events (entity_id, actor, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        entityId,
        actor,
        kind,
        payload === undefined ? null : JSON.stringify(payload),
        now(),
      );
  }

  /** Newest first — the shape `/undo` walks. */
  events(opts: { entityId?: string; limit?: number } = {}): EventRow[] {
    const limit = opts.limit ?? 100;
    const rows = (
      opts.entityId
        ? this.#db
            .prepare(
              'SELECT * FROM events WHERE entity_id = ? ORDER BY id DESC LIMIT ?',
            )
            .all(opts.entityId, limit)
        : this.#db
            .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
            .all(limit)
    ) as Row[];
    return rows.map(rowToEvent);
  }

  // -- the campaign's template half (§13) ------------------------------
  //
  // Its OWN bestiary, statuses, catalog: the campaign's contribution to
  // the merge, authored content that travels with the file. §12 first
  // said this "lives in the manifest", and contact said no: the
  // manifest is an entity row, and entity-shaped content cannot pass
  // through a coercer whose leaves are strictly name/value. So the
  // template half gets ONE table — the SLOT ('bestiary' · 'statuses' ·
  // 'catalog' · …) is a column and the format's word, never a table
  // per type. Rows store whatever was authored, whole; the columns are
  // just what the merge addresses them by.

  /**
   * Author or amend one of this campaign's own template entries. The
   * id is identity (a row restating a pack's id is how the campaign
   * overrides that monster); minted here when the thing is new.
   */
  putTemplate(slot: string, raw: unknown, actor: string): { id: string } {
    if (!raw || typeof raw !== 'object') {
      throw new Error('a template needs at least a name');
    }
    const o = raw as Record<string, unknown>;
    const name = String(o.name ?? '').trim();
    if (!name) throw new Error('a template needs at least a name');
    const id = String(o.id ?? '').trim() || newId('tpl');
    const at = now();
    const before = this.templateRaw(id);
    this.#db
      .prepare(
        `INSERT INTO templates (id, slot, name, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           slot = excluded.slot, name = excluded.name,
           data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(id, slot, name, JSON.stringify({ ...o, id, name }), at, at);
    this.append(id, actor, 'template.updated', { slot, before, after: o });
    return { id };
  }

  /** The authored object, as written — the format reads its own shape out of this. */
  templateRaw(id: string): unknown {
    const row = this.#db
      .prepare('SELECT data FROM templates WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? parseJson(row.data) : undefined;
  }

  /** One slot's authored objects, oldest first — a merge layer, ready to stack. */
  templatesIn(slot: string): unknown[] {
    const rows = this.#db
      .prepare(
        'SELECT data FROM templates WHERE slot = ? ORDER BY created_at, id',
      )
      .all(slot) as Row[];
    return rows.map((r) => parseJson(r.data)).filter((d) => d !== undefined);
  }

  removeTemplate(id: string, actor: string): void {
    const before = this.templateRaw(id);
    if (before === undefined) return;
    this.#db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    this.append(id, actor, 'template.deleted', { before });
  }

  // -- live board state -----------------------------------------------
  //
  // Placements, fog and view for one board — the session-state half of
  // §4. It lives HERE, next to the entities the placements point at,
  // and never inside a `.story`: exporting a campaign mid-fight must
  // not ship token positions and revealed fog.

  boardState(boardId: string): unknown {
    const row = this.#db
      .prepare('SELECT data FROM board_state WHERE board_id = ?')
      .get(boardId) as Row | undefined;
    return row ? parseJson(row.data) : undefined;
  }

  putBoardState(boardId: string, data: unknown, actor: string): void {
    this.#db
      .prepare(
        `INSERT INTO board_state (board_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(board_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(boardId, JSON.stringify(data ?? null), now());
    this.append(boardId, actor, 'board.updated');
  }

  clearBoardState(boardId: string, actor: string): void {
    this.#db.prepare('DELETE FROM board_state WHERE board_id = ?').run(boardId);
    this.append(boardId, actor, 'board.cleared');
  }

  close(): void {
    this.#db.close();
  }
}

/**
 * Mint a campaign. Explicit, and separate from opening on purpose: a
 * typo'd slug must not quietly become an empty campaign, the same
 * posture that keeps bare `teller` from starting a server.
 */
export function createCampaign(
  dataDir: string,
  slug: string,
  name: string,
  actor = 'host',
): Campaign {
  assertSlug(slug);
  const dir = join(dataDir, 'campaigns');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.db`);
  const db = open(path);
  db.exec(CAMPAIGN_SCHEMA);
  const campaign = new Campaign(db, slug);
  const has = db
    .prepare('SELECT id FROM entities WHERE parent_id IS NULL')
    .get();
  if (has) {
    db.close();
    throw new Error(`campaign ${slug} already exists`);
  }
  const at = now();
  const id = newId('ent');
  db.prepare(
    `INSERT INTO entities (id, parent_id, name, type, data, created_at, updated_at)
     VALUES (?, NULL, ?, 'campaign', '{}', ?, ?)`,
  ).run(id, name, at, at);
  campaign.append(id, actor, 'campaign.created', { name });
  return campaign;
}

export function openCampaign(dataDir: string, slug: string): Campaign {
  assertSlug(slug);
  const path = join(dataDir, 'campaigns', `${slug}.db`);
  // Opening a database CREATES the file, and a typo'd slug must not
  // quietly become an empty campaign — so existence is checked first.
  if (!existsSync(path)) {
    throw new Error(`no campaign ${slug} in ${dataDir} (teller host lists them)`);
  }
  const db = open(path);
  db.exec(CAMPAIGN_SCHEMA);
  return new Campaign(db, slug);
}

/** What's on this machine — the list bare `teller host` offers. */
export function listCampaigns(dataDir: string): string[] {
  try {
    return readdirSync(join(dataDir, 'campaigns'))
      .filter((f) => f.endsWith('.db'))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------
// The shelf.

const SHELF_SCHEMA = `
CREATE TABLE IF NOT EXISTS systems (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  builtin    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS packs (
  id         TEXT PRIMARY KEY,
  system     TEXT,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  pages      INTEGER,
  indexed    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS book_pages (
  book_id    TEXT NOT NULL,
  page       INTEGER NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (book_id, page)
);
CREATE TABLE IF NOT EXISTS boards (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  width_inches  REAL,
  grid          TEXT,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS displays (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  color           TEXT,
  role            TEXT NOT NULL DEFAULT 'blank',
  params          TEXT,
  code            TEXT,
  code_expires_at TEXT,
  last_seen_at    TEXT,
  ppi             REAL,
  ppi_y           REAL,
  vw              INTEGER,
  vh              INTEGER
);
`;

/** A board asset — the reusable half of §4. Same category as a book: the campaign references it by id. */
export type Board = {
  id: string;
  /** The image, by content key on disk. */
  key: string;
  name: string;
  widthInches?: number;
  grid?: unknown;
};

function rowToBoard(row: Row): Board {
  const out: Board = {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
  };
  if (typeof row.width_inches === 'number') out.widthInches = row.width_inches;
  const grid = parseJson(row.grid);
  if (grid !== undefined) out.grid = grid;
  return out;
}

export class Shelf {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  // Systems and packs carry their whole template as the blob; the
  // columns are just what boot-time resolution filters by. CRUD grows
  // by contact — this is deliberately the least that lets a campaign's
  // refs resolve.

  putSystem(row: {
    id: string;
    name: string;
    version?: number;
    builtin?: boolean;
    data: unknown;
  }): void {
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO systems (id, name, version, builtin, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, version = excluded.version,
           builtin = excluded.builtin, data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.name,
        row.version ?? 1,
        row.builtin ? 1 : 0,
        JSON.stringify(row.data ?? {}),
        at,
        at,
      );
  }

  system(id: string): { id: string; name: string; version: number; data: unknown } | undefined {
    const row = this.#db
      .prepare('SELECT * FROM systems WHERE id = ?')
      .get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      version: Number(row.version),
      data: parseJson(row.data) ?? {},
    };
  }

  putPack(row: {
    id: string;
    system?: string;
    name: string;
    version?: number;
    data: unknown;
  }): void {
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO packs (id, system, name, version, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           system = excluded.system, name = excluded.name,
           version = excluded.version, data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.system ?? null,
        row.name,
        row.version ?? 1,
        JSON.stringify(row.data ?? {}),
        at,
        at,
      );
  }

  pack(id: string): { id: string; system?: string; name: string; version: number; data: unknown } | undefined {
    const row = this.#db
      .prepare('SELECT * FROM packs WHERE id = ?')
      .get(id) as Row | undefined;
    if (!row) return undefined;
    const out: { id: string; system?: string; name: string; version: number; data: unknown } = {
      id: String(row.id),
      name: String(row.name),
      version: Number(row.version),
      data: parseJson(row.data) ?? {},
    };
    if (row.system) out.system = String(row.system);
    return out;
  }

  packsFor(system: string): string[] {
    const rows = this.#db
      .prepare('SELECT id FROM packs WHERE system = ? ORDER BY created_at, id')
      .all(system) as Row[];
    return rows.map((r) => String(r.id));
  }

  putBoard(board: Omit<Board, 'id'> & { id?: string }): Board {
    const id = board.id ?? newId('brd');
    this.#db
      .prepare(
        `INSERT INTO boards (id, key, name, width_inches, grid, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           key = excluded.key, name = excluded.name,
           width_inches = excluded.width_inches, grid = excluded.grid`,
      )
      .run(
        id,
        board.key,
        board.name,
        board.widthInches ?? null,
        board.grid === undefined ? null : JSON.stringify(board.grid),
        now(),
      );
    return { ...board, id };
  }

  board(id: string): Board | undefined {
    const row = this.#db
      .prepare('SELECT * FROM boards WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? rowToBoard(row) : undefined;
  }

  boards(): Board[] {
    const rows = this.#db
      .prepare('SELECT * FROM boards ORDER BY created_at, id')
      .all() as Row[];
    return rows.map(rowToBoard);
  }

  removeBoard(id: string): void {
    this.#db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  }

  close(): void {
    this.#db.close();
  }
}

export function openShelf(dataDir: string): Shelf {
  mkdirSync(dataDir, { recursive: true });
  const db = open(join(dataDir, 'shelf.db'));
  db.exec(SHELF_SCHEMA);
  return new Shelf(db);
}

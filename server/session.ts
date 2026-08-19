// The session — what `CampaignDO` was, as a plain class (§16).
//
// One campaign, loaded once (§11), plus the set of screens listening.
// The Durable Object existed to give the table a single authority with
// live subscribers; on the host that's just... an object. State that
// more than one screen argues about lives here; everything else lives
// as close to the person as possible (rule 9).
//
// Every mutation goes through this class so that one `changed()` call
// is impossible to forget: the store logs the event (rule 3), the
// session tells the room. Subscribers get a nudge, not a snapshot —
// the minimal loop refetches on change, and pushing richer deltas is a
// later optimisation with this exact seam already in place.

import { loadCampaign, type Loaded } from '../core/boot.ts';
import type { LoadedPlugin, PluginProblem } from '../core/plugins.ts';
import { findEntry, sameName, withoutEntry, type Entity } from '../core/entity.ts';
import { kindFor, setEntry, toKindDef, type KindDef } from '../core/kind.ts';
import { resolve, stamp } from '../core/stamp.ts';
import {
  campaignSummaries,
  createCampaign,
  openCampaign,
  slugFor,
  type Campaign,
  type CampaignSummary,
  type EntityDraft,
  type Shelf,
} from '../core/store.ts';
import type { Ref } from '../core/entity.ts';
import { applyTurnOp, toTurnState, type TurnOp, type TurnState } from './turn.ts';

/** Which slots resolution stamps through — the stampable ones this loop knows. */
export const STAMP_SLOTS = ['bestiary', 'catalog'];

/** One touched entry — everything a seat may say about a list. */
export type EntryEdit = {
  list: string;
  name: string;
  value?: number | string;
  max?: number | null;
  remove?: boolean;
};

/**
 * The room's listeners, hoisted OUT of the session on purpose.
 *
 * A screen subscribes to the table, not to one campaign — the whole
 * point of the campaign switch is that every screen follows without
 * reconnecting (rule 9: displays live on the shelf and survive it). So
 * the subscriber set belongs to the machine and the Session borrows
 * it; swapping the campaign underneath leaves every stream in place.
 */
export class Room {
  /** Each listener, keyed by its send fn; the value is the screen's handle (or undefined for the DM's own console). */
  #subscribers = new Map<(msg: string) => void, string | undefined>();

  subscribe(send: (msg: string) => void, handle?: string): () => void {
    this.#subscribers.set(send, handle);
    return () => this.#subscribers.delete(send);
  }

  get size(): number {
    return this.#subscribers.size;
  }

  changed(what: string): void {
    for (const send of this.#subscribers.keys()) send(what);
  }

  /**
   * One screen, not the room — how an assignment or an identify reaches
   * a passive surface (rule 6: console-driven over SSE is the
   * sanctioned way anything reaches one).
   */
  notify(handle: string, what: string): void {
    for (const [send, h] of this.#subscribers) {
      if (h === handle) send(what);
    }
  }

  clear(): void {
    this.#subscribers.clear();
  }
}

export class Session {
  readonly shelf: Shelf;
  readonly campaign: Campaign;
  /** The resolved content stack — system, packs, campaign's own — from boot. */
  loaded: Loaded;
  /** Enabled plugins, wired at boot by the caller (loadPlugins is async; the constructor is not). */
  plugins: LoadedPlugin[] = [];
  pluginProblems: PluginProblem[] = [];
  /** The machine's listeners, borrowed — see `Room`. */
  readonly room: Room;

  /** Where this host's data lives — plugin discovery needs the path. */
  dataDir?: string;

  constructor(shelf: Shelf, campaign: Campaign, dataDir?: string, room?: Room) {
    this.shelf = shelf;
    this.campaign = campaign;
    this.dataDir = dataDir;
    this.room = room ?? new Room();
    this.loaded = loadCampaign(shelf, campaign, dataDir);
  }

  /** Re-run the resolution law — after a pack upgrade, on the sweep's signal. */
  reload(): void {
    this.loaded = loadCampaign(this.shelf, this.campaign, this.dataDir);
    this.changed('reload');
  }

  subscribe(send: (msg: string) => void, handle?: string): () => void {
    return this.room.subscribe(send, handle);
  }

  get watching(): number {
    return this.room.size;
  }

  changed(what: string): void {
    this.room.changed(what);
  }

  notify(handle: string, what: string): void {
    this.room.notify(handle, what);
  }

  // -- mutations, each one store-write + room-nudge ---------------------

  create(draft: EntityDraft, actor: string, parentId?: string): Entity {
    const entity = this.campaign.create(draft, actor, parentId);
    this.changed('entities');
    return entity;
  }

  /** Stamp an instance from the merged stack — thin unless the caller says thick (§14). */
  stampFrom(
    slot: string,
    templateId: string,
    actor: string,
    opts: { name?: string; thick?: boolean; parentId?: string } = {},
  ): Entity | undefined {
    const template = this.loaded.templateOf(slot)(templateId);
    if (!template) return undefined;
    const entity = this.campaign.create(
      stamp(template, { name: opts.name, thick: opts.thick }),
      actor,
      opts.parentId,
    );
    this.changed('entities');
    return entity;
  }

  save(entity: Entity, actor: string): Entity {
    const saved = this.campaign.save(entity, actor);
    this.changed('entities');
    return saved;
  }

  remove(id: string, actor: string): void {
    this.campaign.remove(id, actor);
    this.changed('entities');
  }

  move(id: string, parentId: string, actor: string): void {
    this.campaign.move(id, parentId, actor);
    this.changed('entities');
  }

  /** The entity as a player reads it — template underneath, stored on top. */
  reading(entity: Entity): Entity {
    return resolve(entity, this.loaded.templateOf(...STAMP_SLOTS));
  }

  /**
   * Resolve-with-sparse-write — the seat's one door (§7's grammar with
   * §14's economy). The player edits the READING; the store keeps only
   * what was touched. Touching an entry that lives only in the template
   * copies exactly that entry down first, so its max and its spelling
   * survive without the whole template thickening in. The write itself
   * goes through `setEntry`, so a declared kind's zero-rule applies the
   * same here as everywhere.
   */
  writeEntry(entityId: string, edit: EntryEdit, actor: string): Entity | undefined {
    const entity = this.campaign.get(entityId);
    if (!entity) return undefined;
    const lists = { ...entity.lists };
    let stored = [...(lists[edit.list] ?? [])];

    if (edit.remove) {
      stored = withoutEntry(stored, edit.name);
    } else {
      if (!findEntry(stored, edit.name)) {
        const read = this.reading(entity);
        const prior = findEntry(read.lists[edit.list] ?? [], edit.name);
        if (prior) stored = [...stored, { ...prior }];
      }
      const kinds = this.loaded
        .declarations('kinds')
        .map(toKindDef)
        .filter((k): k is KindDef => k !== undefined);
      stored = setEntry(stored, edit.name, edit.value, kindFor(kinds, edit.list));
      if (edit.max !== undefined) {
        stored = stored.map((e) => {
          if (!sameName(e, edit.name)) return e;
          const { max: _dropped, ...rest } = e;
          return edit.max === null ? rest : { ...rest, max: edit.max };
        });
      }
    }

    if (stored.length) lists[edit.list] = stored;
    else delete lists[edit.list];
    const saved = this.campaign.save({ ...entity, lists }, actor);
    this.changed('entities');
    return saved;
  }

  // -- the turn order (rule 5) ------------------------------------------

  turnState(): TurnState {
    return toTurnState(this.campaign.turnState());
  }

  turnOp(op: TurnOp, actor: string): TurnState {
    const next = applyTurnOp(this.turnState(), op);
    this.campaign.putTurnState(next, actor, op.op);
    this.changed('turn');
    return next;
  }

  /**
   * Deploy a prepared fight (§13: the encounter is PREP — a campaign
   * template; deploying stamps instances, and the recipe stays
   * pristine so it can run again for another posse). Each foe stamps
   * THIN and joins the turn order by link; what the fight does to them
   * is theirs, not the recipe's.
   */
  deployEncounter(
    encounterId: string,
    actor: string,
  ): { deployed: Entity[]; turn: TurnState } | undefined {
    const raw = this.campaign.templateRaw(encounterId);
    if (!raw || typeof raw !== 'object') return undefined;
    const enc = raw as {
      foes?: { templateId?: string; name?: string; count?: number }[];
    };
    const deployed: Entity[] = [];
    for (const foe of enc.foes ?? []) {
      if (!foe.templateId) continue;
      // A foe whose template is missing is skipped and shows up as the
      // count coming up short — reported by absence, never faked.
      const template = this.loaded.templateOf('bestiary')(foe.templateId);
      if (!template) continue;
      const count = Math.max(1, Math.min(50, Math.floor(foe.count ?? 1)));
      const base = foe.name?.trim() || template.name;
      for (let n = 1; n <= count; n++) {
        const entity = this.stampFrom('bestiary', foe.templateId, actor, {
          name: count > 1 ? `${base} ${n}` : base,
        });
        if (entity) deployed.push(entity);
      }
    }
    let turn = this.turnState();
    for (const entity of deployed) {
      turn = applyTurnOp(turn, { op: 'add', entityId: entity.id });
    }
    this.campaign.putTurnState(turn, actor, 'deploy');
    this.changed('turn');
    return { deployed, turn };
  }

  putBoardState(boardId: string, data: unknown, actor: string): void {
    this.campaign.putBoardState(boardId, data, actor);
    this.changed('board');
  }

  close(): void {
    this.room.clear();
    this.campaign.close();
    this.shelf.close();
  }
}

// ---------------------------------------------------------------------
// The host — one machine, one ACTIVE campaign, and the door between.
//
// One active campaign per host, and every screen follows it (rule 9).
// That's why this is a holder rather than a map: the table has one
// story going at a time, and a display assigned to a seat is assigned
// on the SHELF, so it survives the switch and simply refetches.
//
// The switch order matters and is the whole trick: nudge the room
// FIRST, so every screen is already on its way back for fresh data,
// then swap the session under them. The listeners live on the Room,
// not on the Session, so nothing has to reconnect.

/** The shelf key the active campaign's slug is remembered under. */
export const ACTIVE_CAMPAIGN = 'campaign';

export class Host {
  readonly shelf: Shelf;
  /** Where this host's data lives. Absent means a session built by hand (tests) — the campaign doors say 501. */
  readonly dataDir?: string;
  readonly room: Room;
  session?: Session;
  /** Loaded plugins ride the machine, not the campaign — a switch keeps them. */
  plugins: LoadedPlugin[] = [];
  pluginProblems: PluginProblem[] = [];

  constructor(shelf: Shelf, dataDir?: string, room?: Room) {
    this.shelf = shelf;
    this.dataDir = dataDir;
    this.room = room ?? new Room();
  }

  /** A host around a session someone already built — how the existing tests keep working. */
  static around(session: Session): Host {
    const host = new Host(session.shelf, session.dataDir, session.room);
    host.session = session;
    return host;
  }

  /** What this machine holds, the active one marked. */
  list(): (CampaignSummary & { active: boolean })[] {
    if (!this.dataDir) return [];
    const active = this.session?.campaign.slug;
    return campaignSummaries(this.dataDir).map((c) => ({
      ...c,
      active: c.slug === active,
    }));
  }

  setPlugins(plugins: LoadedPlugin[], problems: PluginProblem[]): void {
    this.plugins = plugins;
    this.pluginProblems = problems;
    if (this.session) {
      this.session.plugins = plugins;
      this.session.pluginProblems = problems;
    }
  }

  /** Open an existing campaign and make it the table's. */
  activate(slug: string): Session {
    if (!this.dataDir) throw new Error('this host has no data dir');
    if (this.session?.campaign.slug === slug) return this.session;
    return this.#adopt(openCampaign(this.dataDir, slug));
  }

  /**
   * Mint one and play it — the DM just made it, so activating is what
   * they meant. The system ref is written into the manifest at birth
   * because a campaign with no system is a campaign that resolves
   * nothing; it stays editable afterwards like everything else.
   */
  start(name: string, system?: Ref): Session {
    if (!this.dataDir) throw new Error('this host has no data dir');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('a campaign needs a name');
    const campaign = createCampaign(this.dataDir, slugFor(this.dataDir, trimmed), trimmed);
    if (system) {
      const root = campaign.root();
      campaign.save({ ...root, refs: { ...root.refs, system } }, 'host');
    }
    return this.#adopt(campaign);
  }

  #adopt(campaign: Campaign): Session {
    // The room hears about it BEFORE the swap: a screen that refetches
    // early gets the old answer and refetches again on the second
    // nudge, where one that hears nothing sits on a stale table.
    this.room.changed('campaign');
    const previous = this.session;
    const session = new Session(this.shelf, campaign, this.dataDir, this.room);
    session.plugins = this.plugins;
    session.pluginProblems = this.pluginProblems;
    this.session = session;
    if (previous) previous.campaign.close();
    this.shelf.setSetting(ACTIVE_CAMPAIGN, campaign.slug);
    this.room.changed('campaign');
    return session;
  }
}

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
import { findEntry, sameName, withoutEntry, type Entity } from '../core/entity.ts';
import { kindFor, setEntry, toKindDef, type KindDef } from '../core/kind.ts';
import { resolve, stamp } from '../core/stamp.ts';
import type { Campaign, EntityDraft, Shelf } from '../core/store.ts';

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

export class Session {
  readonly shelf: Shelf;
  readonly campaign: Campaign;
  /** The resolved content stack — system, packs, campaign's own — from boot. */
  loaded: Loaded;
  /** Each listener, keyed by its send fn; the value is the screen's handle (or undefined for the DM's own console). */
  #subscribers = new Map<(msg: string) => void, string | undefined>();

  constructor(shelf: Shelf, campaign: Campaign) {
    this.shelf = shelf;
    this.campaign = campaign;
    this.loaded = loadCampaign(shelf, campaign);
  }

  /** Re-run the resolution law — after a pack upgrade, on the sweep's signal. */
  reload(): void {
    this.loaded = loadCampaign(this.shelf, this.campaign);
    this.changed('reload');
  }

  subscribe(send: (msg: string) => void, handle?: string): () => void {
    this.#subscribers.set(send, handle);
    return () => this.#subscribers.delete(send);
  }

  get watching(): number {
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

  putBoardState(boardId: string, data: unknown, actor: string): void {
    this.campaign.putBoardState(boardId, data, actor);
    this.changed('board');
  }

  close(): void {
    this.#subscribers.clear();
    this.campaign.close();
    this.shelf.close();
  }
}

// Boot-time loading — the resolution law finding its home (§11).
//
// teller starts, reads the manifest, resolves system and packs against
// the shelf, reports what's missing, degrades. ONCE, at boot — not
// per-request. What comes back is the campaign's whole content stack,
// pre-stacked in precedence order:
//
//   teller's defaults → system → packs (declared order) → the
//   campaign's own template half → the TABLE's own folder
//
// Later wins, all the way up: the install's furniture is the floor, and
// what a human wrote on THIS machine's shelf is the ceiling.
//
// A ref that resolves joins the stack; a ref that doesn't is REPORTED,
// never silently dropped — "you don't have this" beats forgetting it
// existed, and beats an encounter that deploys half-empty at the table.
// A campaign with a missing system still loads: the table plays on
// with whatever layers remain, which is the degradation contract doing
// its job rather than an error page doing its opposite.
//
// This module knows nothing about what the slots MEAN. 'bestiary',
// 'statuses', 'kinds' are the format's words; boot stacks whatever a
// layer holds under a slot and hands the caller the merged reading,
// keyed the way the content couples (§10): declarations by name,
// stampable collections by id.

import { refIn, refsIn, sameName, type Entity, type Ref } from './entity.ts';
import { mergeBy } from './merge.ts';
import { type PanelDef } from './panels.ts';
import { defaultPanels, sweepPanels } from './panels-shelf.ts';
import { sweepPacks, type PackProblem } from './packs-shelf.ts';
import { sweepSystems } from './systems-shelf.ts';
import { toTemplate, type Template, type TemplateOf } from './stamp.ts';
import type { Campaign, Shelf } from './store.ts';

export type Missing = { slot: 'system' | 'pack'; ref: Ref };

/** One content layer's blob, with where it came from for the console to say. */
type Layer = { source: string; data: Record<string, unknown> };

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function slotOf(layer: Layer, slot: string): unknown[] {
  const held = layer.data[slot];
  return Array.isArray(held) ? held : [];
}

export class Loaded {
  readonly manifest: Entity;
  /**
   * The active system. `code` is its own presentations (§M — the
   * function half, from `systems/<name>/presentations/`), present only
   * once a human trusted the `sys_` id; `codePending` says a folder
   * carries compiled code nobody has enabled yet. A system that arrived
   * as a `shelf.db` row or inside a pack folder carries neither.
   */
  readonly system?: {
    id: string;
    name: string;
    version: number;
    code?: { presentations: Record<string, string> };
    codePending?: boolean;
  };
  /**
   * Resolved packs, in the precedence order the manifest declared.
   * `code` is the system's own presentations (§L phase 2), present only
   * for a pack a human has trusted; `codePending` says a folder carries
   * compiled code nobody has enabled yet.
   */
  readonly packs: {
    id: string;
    name: string;
    version: number;
    code?: { presentations: Record<string, string> };
    codePending?: boolean;
  }[];
  /** Every ref that didn't resolve. The console's business to say out loud. */
  readonly missing: Missing[];
  /** A `panels/*\/panel.json` that failed to parse. Reported, never a crash. */
  readonly panelProblems: { dir: string; problem: string }[];
  /** A `packs/*\/…json` that failed to parse. Same posture — the pack loads what parses. */
  readonly packProblems: PackProblem[];
  #layers: Layer[];
  /** The table's own `panels/` folder — the topmost layer, above the campaign. */
  #table: Layer;
  #campaign: Campaign;

  constructor(
    manifest: Entity,
    layers: Layer[],
    missing: Missing[],
    campaign: Campaign,
    system?: Loaded['system'],
    packs: Loaded['packs'] = [],
    panels: PanelDef[] = [],
    panelProblems: { dir: string; problem: string }[] = [],
    packProblems: PackProblem[] = [],
    tablePanels: PanelDef[] = [],
  ) {
    this.manifest = manifest;
    this.system = system;
    this.packs = packs;
    this.missing = missing;
    this.panelProblems = panelProblems;
    this.packProblems = packProblems;
    // teller's own furniture is the FLOOR: the panels that ship with
    // the install (`defaults/panels/`), overridable by any layer above
    // restating the name (§E). The one slot teller ships declarations
    // for.
    this.#layers = [
      { source: 'teller', data: { panels } },
      ...layers,
    ];
    // …and the TABLE's own `panels/` folder is the CEILING, above the
    // campaign (§M-6's first wrinkle, fixed 2026-08-19): a table that
    // restates a default's, a system's or a pack's panel wins, which is
    // rule 1 pointing the way it points everywhere else in teller.
    this.#table = { source: 'table', data: { panels: tablePanels } };
    this.#campaign = campaign;
  }

  /**
   * What the `system` specifier resolves to for this campaign (§L
   * phase 2, re-ordered by §M): the ACTIVE SYSTEM's presentations
   * first, then each trusted pack's, in declared precedence order —
   * LATER WINS on a filename collision.
   *
   * That order is the merge's, and it is exactly what makes "a pack
   * skins the system's dial" work: the system ships the functional face
   * (a spend dial), the pack restates the filename with the book's face
   * (a revolver's cylinder), and the pack's is what a record summons.
   * A pack shadowing another pack works the same way, as before.
   */
  presentations(): Record<string, string> {
    const out: Record<string, string> = { ...(this.system?.code?.presentations ?? {}) };
    for (const pack of this.packs) Object.assign(out, pack.code?.presentations ?? {});
    return out;
  }

  /**
   * A slot's VOCABULARY-coupled reading — declarations, statuses:
   * later restates earlier by name, the campaign's own word last and
   * winning.
   */
  declarations(slot: string): unknown[] {
    return mergeBy(
      (item: unknown) => String(asRecord(item).name ?? '').trim().toLowerCase(),
      ...this.#stack(slot),
    ).filter((item) => String(asRecord(item).name ?? '').trim());
  }

  /**
   * A slot's IDENTITY-coupled reading — bestiary, catalogue: anything
   * stampable, merged by minted id, the campaign overriding a pack's
   * entry by restating its id.
   */
  templates(slot: string): Template[] {
    const stamped = this.#stack(slot)
      .flat()
      .map(toTemplate)
      .filter((t): t is Template => t !== undefined);
    return mergeBy((t: Template) => t.id, stamped);
  }

  /** The lookup `resolve()` wants, over one slot — or several, tried in order. */
  templateOf(...slots: string[]): TemplateOf {
    return (id) => {
      for (const slot of slots) {
        const hit = this.templates(slot).find((t) => t.id === id);
        if (hit) return hit;
      }
      return undefined;
    };
  }

  /**
   * A slot holding one RECORD per layer (the system's visual
   * vocabulary: `accents`, `icons`, `vocabulary`) — shallow-merged,
   * later layer winning per key. The declaration stack for objects
   * that aren't lists.
   */
  record(slot: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const layer of this.#layers) {
      const held = layer.data[slot];
      if (held && typeof held === 'object' && !Array.isArray(held)) {
        Object.assign(out, held as Record<string, unknown>);
      }
    }
    return out;
  }

  /**
   * Which layer a merged entry came from — the LAST layer to state the
   * name, because that's the one whose version won. Provenance for a
   * console that wants to say "campaign, overriding the Guidebook".
   */
  sourceOf(slot: string, name: string): string | undefined {
    let from: string | undefined;
    for (const { source, items } of this.#sourced(slot)) {
      if (
        items.some((item) => {
          const itemName = String(asRecord(item).name ?? '');
          return itemName !== '' && sameName(itemName, name);
        })
      ) {
        from = source;
      }
    }
    return from;
  }

  /**
   * What ONE layer carries, slot by slot, counted — the quiet
   * "65 bestiary · 301 catalog · 6 statuses" line a console wants under
   * a container's name. Whatever the layer holds, in the layer's own
   * words: this module still knows nothing about what a slot MEANS
   * (§10), so it counts and the console does the naming.
   *
   * `panels` is deliberately absent — a container renders those as its
   * expandable children, and counting them here would say the same
   * thing twice in two places that could disagree.
   */
  cargo(source: string): Record<string, number> {
    const layer = this.#layers.find((l) => l.source === source);
    const out: Record<string, number> = {};
    if (!layer) return out;
    for (const [slot, held] of Object.entries(layer.data)) {
      if (slot === 'panels') continue;
      const count = Array.isArray(held)
        ? held.length
        : held && typeof held === 'object'
          ? Object.keys(held).length
          : 0;
      if (count > 0) out[slot] = count;
    }
    return out;
  }

  /**
   * The same stack, LAYER BY LAYER rather than merged — what a console
   * that groups by WHERE IT CAME FROM needs, and the only reading that
   * can answer it. `declarations()` hands back the winners with their
   * provenance flattened away, and `sourceOf()` answers one name at a
   * time; neither can say "here is everything the Guidebook ships".
   *
   * Sources are the same words `sourceOf` returns: `teller`,
   * `system:<id>`, `pack:<id>`, `campaign`, `table`. A layer that
   * restates a name appears in both its own group and the earlier one —
   * that IS the stack, and hiding the shadowed copy would hide the
   * override.
   */
  sourced(slot: string): { source: string; items: unknown[] }[] {
    return this.#sourced(slot);
  }

  /**
   * The full stack for one slot, bottom to top:
   *
   *   teller (the install's defaults) → system → packs → campaign → table
   *
   * The table's own folder is LAST because the table's ruling beats
   * everyone's, including its own campaign's stored declarations.
   */
  #sourced(slot: string): { source: string; items: unknown[] }[] {
    return [
      ...this.#layers.map((layer) => ({
        source: layer.source,
        items: slotOf(layer, slot),
      })),
      { source: 'campaign', items: this.#campaign.templatesIn(slot) },
      { source: this.#table.source, items: slotOf(this.#table, slot) },
    ];
  }

  #stack(slot: string): unknown[][] {
    return this.#sourced(slot).map((s) => s.items);
  }
}

/**
 * Resolve one campaign against one shelf. The manifest's `packs` ref
 * list is precedence order; NO list means every pack for the system
 * applies, in arrival order — a host with one pack must never make
 * anyone tick a box.
 *
 * `dataDir`, when given, is where the sweeps look —
 * `<dataDir>/panels/*\/panel.json` (§E, the TABLE's own layer) and
 * `<dataDir>/packs/*\/` (§L phase 1). teller's five defaults come from
 * the INSTALL either way, so a host with no data dir at all — and every
 * test that passes none — still has its furniture.
 *
 * **A folder beats a row.** A system or pack a sweep found is used
 * INSTEAD of the `shelf.db` row of the same id — the file on disk is
 * the authoring copy (rule 4a), so it wins, exactly the way a swept
 * `panel.json` beats the in-memory seed. The rows stay put and stay
 * readable, which is what makes the migration safe one pack at a time:
 * anything not yet folder-ized still loads from the database.
 *
 * For a SYSTEM there are now three places it can come from, and the
 * order is §M's: `systems/<name>/` (its own folder — the function half,
 * with code) beats a `system.json` embedded in a pack folder (phase 1's
 * merged shape) beats a `shelf.db` row. An old pack that still carries
 * its system loads exactly as it did.
 */
export function loadCampaign(shelf: Shelf, campaign: Campaign, dataDir?: string): Loaded {
  const manifest = campaign.root();
  const missing: Missing[] = [];
  const layers: Layer[] = [];

  const sweptPacks = dataDir ? sweepPacks(dataDir, shelf) : undefined;
  const sweptSystems = dataDir ? sweepSystems(dataDir, shelf) : undefined;
  const systemFolders = new Map((sweptSystems?.systems ?? []).map((s) => [s.id, s]));
  const folderSystems = new Map((sweptPacks?.systems ?? []).map((s) => [s.id, s]));
  const folderPacks = new Map((sweptPacks?.packs ?? []).map((p) => [p.id, p]));

  const systemRef = refIn(manifest.refs, 'system');
  let system: Loaded['system'];
  if (systemRef) {
    // Precedence, per id (§M): the system's OWN folder, then a
    // `system.json` embedded in a pack folder (phase 1's shape — old
    // exports keep working), then the `shelf.db` row.
    const own = systemFolders.get(systemRef.id);
    const row = own ?? folderSystems.get(systemRef.id) ?? shelf.system(systemRef.id);
    if (row) {
      system = { id: row.id, name: row.name, version: row.version };
      // Only a system's own folder carries code — an embedded
      // `system.json` has no `presentations/` of its own and a row has
      // no source to compile.
      if (own?.code) system.code = own.code;
      if (own?.codePending) system.codePending = true;
      layers.push({ source: `system:${row.id}`, data: asRecord(row.data) });
    } else {
      missing.push({ slot: 'system', ref: systemRef });
    }
  }

  const declared = refsIn(manifest.refs, 'packs');
  // No declared list means every pack for the system applies, in
  // arrival order — from the shelf AND from the folders, which is where
  // a pack that only ever existed as a folder joins in.
  const undeclared = () => {
    if (!system) return [];
    const ids = shelf.packsFor(system.id);
    for (const pack of folderPacks.values()) {
      if (pack.system === system.id && !ids.includes(pack.id)) ids.push(pack.id);
    }
    return ids.map((id) => ({ id, name: id }));
  };
  const packRefs: Ref[] = declared.length ? declared : undeclared();
  const packs: Loaded['packs'] = [];
  for (const ref of packRefs) {
    const folder = folderPacks.get(ref.id);
    const row = folder ?? shelf.pack(ref.id);
    if (row) {
      const entry: Loaded['packs'][number] = { id: row.id, name: row.name, version: row.version };
      // Only a FOLDER carries code — a `shelf.db` row has no source to compile.
      if (folder?.code) entry.code = folder.code;
      if (folder?.codePending) entry.codePending = true;
      packs.push(entry);
      layers.push({ source: `pack:${row.id}`, data: asRecord(row.data) });
    } else {
      missing.push({ slot: 'pack', ref });
    }
  }

  // teller's own five, from the INSTALL — always, data dir or not.
  // The table's `panels/` folder is a separate layer that sits on top,
  // and is empty until a human writes something there.
  const swept = dataDir ? sweepPanels(dataDir, shelf) : undefined;

  return new Loaded(
    manifest,
    layers,
    missing,
    campaign,
    system,
    packs,
    defaultPanels(),
    swept?.problems ?? [],
    [...(sweptSystems?.problems ?? []), ...(sweptPacks?.problems ?? [])],
    swept?.panels ?? [],
  );
}

// Boot-time loading — the resolution law finding its home (§11).
//
// teller starts, reads the manifest, resolves system and packs against
// the shelf, reports what's missing, degrades. ONCE, at boot — not
// per-request. What comes back is the campaign's whole content stack,
// pre-stacked in precedence order:
//
//   system → packs (declared order) → the campaign's own template half
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
import { STANDARD_PANELS, type PanelDef } from './panels.ts';
import { sweepPanels } from './panels-shelf.ts';
import { sweepPacks, type PackProblem } from './packs-shelf.ts';
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
  readonly system?: { id: string; name: string; version: number };
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
  #campaign: Campaign;

  constructor(
    manifest: Entity,
    layers: Layer[],
    missing: Missing[],
    campaign: Campaign,
    system?: { id: string; name: string; version: number },
    packs: Loaded['packs'] = [],
    panels: PanelDef[] = STANDARD_PANELS,
    panelProblems: { dir: string; problem: string }[] = [],
    packProblems: PackProblem[] = [],
  ) {
    this.manifest = manifest;
    this.system = system;
    this.packs = packs;
    this.missing = missing;
    this.panelProblems = panelProblems;
    this.packProblems = packProblems;
    // teller's own furniture sits BELOW everything: the standard panel
    // collection, overridable by any layer above restating the name
    // (§E). The one slot teller ships declarations for — swept from the
    // shelf's `panels/` folder when a data dir was given, the in-memory
    // seed source otherwise (tests, or a sweep that found nothing yet).
    this.#layers = [
      { source: 'teller', data: { panels } },
      ...layers,
    ];
    this.#campaign = campaign;
  }

  /**
   * What the `system` specifier resolves to for this campaign (§L
   * phase 2): every trusted pack's presentations, name → url, walked in
   * PRECEDENCE order so a later pack shadows an earlier one's component
   * by restating its filename — the later-wins law, applied to code.
   */
  presentations(): Record<string, string> {
    const out: Record<string, string> = {};
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

  /** The full stack for one slot: shelf layers in precedence order, the campaign's own last. */
  #sourced(slot: string): { source: string; items: unknown[] }[] {
    return [
      ...this.#layers.map((layer) => ({
        source: layer.source,
        items: slotOf(layer, slot),
      })),
      { source: 'campaign', items: this.#campaign.templatesIn(slot) },
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
 * `dataDir`, when given, is where the two sweeps look —
 * `<dataDir>/panels/*\/panel.json` (§E) and `<dataDir>/packs/*\/`
 * (§L phase 1). No dir, or a panel sweep that finds nothing there yet
 * (a fresh shelf, a test's scratch dir), falls back to
 * `STANDARD_PANELS` in memory — the same seed source `seedPanels` writes
 * from, so a host that hasn't booted once yet still has its furniture.
 *
 * **A folder beats a row.** A system or pack the pack sweep found is
 * used INSTEAD of the `shelf.db` row of the same id — the file on disk
 * is the authoring copy (rule 4a), so it wins, exactly the way a
 * swept `panel.json` beats the in-memory seed. The rows stay put and
 * stay readable, which is what makes the migration safe one pack at a
 * time: anything not yet folder-ized still loads from the database.
 */
export function loadCampaign(shelf: Shelf, campaign: Campaign, dataDir?: string): Loaded {
  const manifest = campaign.root();
  const missing: Missing[] = [];
  const layers: Layer[] = [];

  const sweptPacks = dataDir ? sweepPacks(dataDir, shelf) : undefined;
  const folderSystems = new Map((sweptPacks?.systems ?? []).map((s) => [s.id, s]));
  const folderPacks = new Map((sweptPacks?.packs ?? []).map((p) => [p.id, p]));

  const systemRef = refIn(manifest.refs, 'system');
  let system: { id: string; name: string; version: number } | undefined;
  if (systemRef) {
    const row = folderSystems.get(systemRef.id) ?? shelf.system(systemRef.id);
    if (row) {
      system = { id: row.id, name: row.name, version: row.version };
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

  const swept = dataDir ? sweepPanels(dataDir, shelf) : undefined;
  const panels = swept?.panels.length ? swept.panels : STANDARD_PANELS;
  const panelProblems = swept?.problems ?? [];

  return new Loaded(
    manifest,
    layers,
    missing,
    campaign,
    system,
    packs,
    panels,
    panelProblems,
    sweptPacks?.problems ?? [],
  );
}

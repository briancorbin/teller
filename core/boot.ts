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
  /** Resolved packs, in the precedence order the manifest declared. */
  readonly packs: { id: string; name: string; version: number }[];
  /** Every ref that didn't resolve. The console's business to say out loud. */
  readonly missing: Missing[];
  /** A `panels/*\/panel.json` that failed to parse. Reported, never a crash. */
  readonly panelProblems: { dir: string; problem: string }[];
  #layers: Layer[];
  #campaign: Campaign;

  constructor(
    manifest: Entity,
    layers: Layer[],
    missing: Missing[],
    campaign: Campaign,
    system?: { id: string; name: string; version: number },
    packs: { id: string; name: string; version: number }[] = [],
    panels: PanelDef[] = STANDARD_PANELS,
    panelProblems: { dir: string; problem: string }[] = [],
  ) {
    this.manifest = manifest;
    this.system = system;
    this.packs = packs;
    this.missing = missing;
    this.panelProblems = panelProblems;
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
 * `dataDir`, when given, is where the panel sweep looks
 * (`<dataDir>/panels/*\/panel.json` — §E). No dir, or a sweep that finds
 * nothing there yet (a fresh shelf, a test's scratch dir), falls back to
 * `STANDARD_PANELS` in memory — the same seed source `seedPanels` writes
 * from, so a host that hasn't booted once yet still has its furniture.
 */
export function loadCampaign(shelf: Shelf, campaign: Campaign, dataDir?: string): Loaded {
  const manifest = campaign.root();
  const missing: Missing[] = [];
  const layers: Layer[] = [];

  const systemRef = refIn(manifest.refs, 'system');
  let system: { id: string; name: string; version: number } | undefined;
  if (systemRef) {
    const row = shelf.system(systemRef.id);
    if (row) {
      system = { id: row.id, name: row.name, version: row.version };
      layers.push({ source: `system:${row.id}`, data: asRecord(row.data) });
    } else {
      missing.push({ slot: 'system', ref: systemRef });
    }
  }

  const declared = refsIn(manifest.refs, 'packs');
  const packRefs: Ref[] = declared.length
    ? declared
    : system
      ? shelf.packsFor(system.id).map((id) => ({ id, name: id }))
      : [];
  const packs: { id: string; name: string; version: number }[] = [];
  for (const ref of packRefs) {
    const row = shelf.pack(ref.id);
    if (row) {
      packs.push({ id: row.id, name: row.name, version: row.version });
      layers.push({ source: `pack:${row.id}`, data: asRecord(row.data) });
    } else {
      missing.push({ slot: 'pack', ref });
    }
  }

  const swept = dataDir ? sweepPanels(dataDir, shelf) : undefined;
  const panels = swept?.panels.length ? swept.panels : STANDARD_PANELS;
  const panelProblems = swept?.problems ?? [];

  return new Loaded(manifest, layers, missing, campaign, system, packs, panels, panelProblems);
}

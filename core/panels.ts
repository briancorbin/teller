// The standard panel collection — teller's furniture (§E, settled
// 2026-08-18).
//
// A `.panel` is a named declaration that arranges components on a
// surface. It rides the same stack as every other declaration —
// vocabulary-coupled, merged by NAME, later wins — under a `panels`
// slot on any layer. THIS file is the layer below everything: the
// arrangements teller ships so a fresh host has a console at all —
// the HOST's own tools only, since a play screen without a system has
// nothing to arrange (2026-08-19; see `STANDARD_PANELS` below). A
// system, pack or campaign adds its own or overrides one by restating
// its word; a human's layer always wins (rule 1 for UI). Furniture, not
// content — a panel gates nothing and grants nothing; the ROLE decides
// what a screen may do, the panel only decides how it looks.
//
// Two authored arrangements, never one responsive layout: `mounted`
// (fixed height, never scrolls, columns) and `held` (a hand's glass,
// scrolls down, one column). Blocks are nouns — layout + components
// only, never control flow.
//
// "E extended again" (2026-08-18): nothing here is gatekept. `STANDARD_PANELS`
// below is the SEED SOURCE, not the collection itself — `panels-shelf.ts`
// seeds each one to `<dataDir>/panels/<name>/panel.json` (seed-if-absent,
// the `seedSystems` posture, rule 1 for files: a folder that already
// exists is never overwritten, so an edit survives every boot) and sweeps
// whatever's on the shelf back as the teller base layer boot.ts stacks
// under everything else. A duplicated folder — copy `sheet/` to
// `my-sheet/`, edit `name` inside — is just another file in the
// collection; the NAME is still the merge key, the minted `pan_` id only
// names the file. The fs-touching half lives in that sibling module and
// not here: THIS file is type-imported straight from `client/` (the
// panel renderer wants `PanelDef`/`PanelBlock`), so it must stay import-
// safe for a browser build — no `node:fs`, no `node:path`.
//
// Art-in-panel (`art/` beside `panel.json`, refs rewritten to a
// namespaced key at install, same as a pack) is specced in §E but not
// built here — TODO(§E, "a panel carries its art") when that lands.

export type PanelBlock = { block: string } & Record<string, unknown>;

export type PanelDef = {
  /** The word. Later layers override by restating it. */
  name: string;
  label?: string;
  blurb?: string;
  /** What it arranges: one entity, or nothing (a tool panel). */
  subject?: 'entity' | 'none';
  mounted?: PanelBlock[];
  held?: PanelBlock[];
  /**
   * `pan_…`, minted once at seed/authoring and baked into the file.
   * Identity for the FILE (namespaces its art, names it on disk) — the
   * merge key stays `name`, exactly as `pak_` doesn't touch a pack's.
   */
  id?: string;
  /**
   * The ladder's rungs 3-5 (§E UN-DEFERRED, 2026-08-19). Attached at
   * LOAD, by the sweep, and only once the panel is TRUSTED — never
   * carried in `panel.json` itself. URLs point at
   * `/panel-code/<pan_id>/…`, serving `<folder>/.build/` output only.
   */
  code?: { style?: string; blocks?: Record<string, string>; takeover?: string };
  /**
   * Set instead of `code` when a folder carries compiled code but no
   * human has enabled it yet — the client's cue to say "this panel
   * carries code awaiting enablement" rather than pretend it's inert.
   */
  codePending?: boolean;
};

/** Forgiving read for a panel arriving in pack JSON — keep what parses. */
export function toPanel(raw: unknown): PanelDef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return undefined;
  const blocks = (v: unknown): PanelBlock[] | undefined =>
    Array.isArray(v)
      ? (v.filter(
          (b) => b && typeof b === 'object' && typeof (b as PanelBlock).block === 'string',
        ) as PanelBlock[])
      : undefined;
  const out: PanelDef = { name };
  if (typeof r.label === 'string' && r.label.trim()) out.label = r.label;
  if (typeof r.blurb === 'string' && r.blurb.trim()) out.blurb = r.blurb;
  if (r.subject === 'entity' || r.subject === 'none') out.subject = r.subject;
  const mounted = blocks(r.mounted);
  const held = blocks(r.held);
  if (mounted) out.mounted = mounted;
  if (held) out.held = held;
  if (typeof r.id === 'string' && r.id.trim()) out.id = r.id;
  return out;
}

const tool = (
  name: string,
  label: string,
  blurb: string,
): PanelDef => ({
  name,
  label,
  blurb,
  subject: 'none',
  mounted: [{ block: 'tool', tool: name }],
  held: [{ block: 'tool', tool: name }],
});

/** Every list a sheet places by hand, so `rest` can catch the strays.
 * Exported for the seat chrome's synthesized 'More' screen
 * (`client/components/seat/SeatChrome.tsx`, fix 1/6) — the same strays
 * that used to spill onto held-glass Sheet now spill there instead. */
export const PLACED = ['skills', 'resources', 'conditions', 'meta'];

/**
 * teller seeds the HOST's own tools and nothing else (Brian,
 * 2026-08-19): boards, log, plugins, screens, shelf — the five panels
 * that are about this machine and the room around it, which mean the
 * same thing whether a system is loaded or not.
 *
 * Everything that arranges the GAME moved to the system layer —
 * `sheet`, `bare`, `roster`, `bestiary`, `encounters`, `runner`,
 * `rules` now ship as `panels/<name>/panel.json` folders inside a
 * system's own directory (§M, "a system ships PANELS"). Only the
 * DECLARATIONS moved: the tool blocks they name are still registered in
 * teller's client, so a system declares `roster` and teller draws it.
 * A bare host — no system yet — therefore has a console of host tools
 * and no play screens, which is the honest thing to show: there is no
 * game to arrange.
 */
export const STANDARD_PANELS: PanelDef[] = [
  tool('screens', 'Screens', 'The room: adopt by code, assign roles, identify.'),
  tool('shelf', 'Shelf', "This machine's systems, packs and what the campaign runs on."),
  tool('plugins', 'Plugins', 'Discovered on disk; enabled only by you, here.'),
  tool('boards', 'Boards', 'The maps and their live placements.'),
  tool('log', 'Log', 'Everything that happened, newest first (rule 3, readable).'),
];

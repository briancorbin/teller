// The standard panel collection — teller's furniture (§E, settled
// 2026-08-18).
//
// A `.panel` is a named declaration that arranges components on a
// surface. It rides the same stack as every other declaration —
// vocabulary-coupled, merged by NAME, later wins — under a `panels`
// slot on any layer. THIS file is the layer below everything: the
// arrangements teller ships so a fresh host has a console and a seat
// at all. A system, pack or campaign overrides one by restating its
// word; a human's layer always wins (rule 1 for UI). Furniture, not
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
 * The six seat layouts (`src/lib/seat-layouts.ts`), reborn as panel
 * declarations — the SEAT tabs derive from the entity-subject panels in
 * this file, in this order, and the seat chrome (client-owned) is what
 * cycles between them. Identity (name, trade, player, spend chips) moved
 * OUT of every one of these and into the chrome's own top bar, because a
 * screen switching layouts shouldn't repaint who it belongs to.
 */
export const STANDARD_PANELS: PanelDef[] = [
  {
    name: 'gauges',
    label: 'Gauges',
    blurb: 'Bars for anything with a ceiling; the rest tucked underneath.',
    subject: 'entity',
    mounted: [
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
    held: [
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
  },
  {
    name: 'dials',
    label: 'Dials',
    blurb: 'Round faces you fill and empty. Big targets, no reading.',
    subject: 'entity',
    mounted: [
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
    held: [
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
  },
  {
    name: 'ledger',
    label: 'Ledger',
    blurb: 'One tight line each. Everything visible, nothing shouting.',
    subject: 'entity',
    mounted: [
      { block: 'list', list: 'resources', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
    held: [
      { block: 'list', list: 'resources', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
  },
  {
    name: 'focus',
    label: 'Focus',
    blurb: 'The two you spend in a fight, huge. Everything else one tap away.',
    subject: 'entity',
    mounted: [
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
    held: [
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
  },
  {
    name: 'sheet',
    label: 'Sheet',
    blurb: 'Arranged like the paper you already know.',
    subject: 'entity',
    // Mounted glass draws exactly what the printed page's Sheet screen
    // does — Skills, Health+Grit, Statuses, three columns, nothing more
    // (the old app kept everything else on a 'More' screen this rebuild
    // hasn't grown yet; the Ledger/Gauges/Classic tabs already surface
    // every counter, so nothing here is actually lost — see `bare` for
    // the literal floor). Held glass has room to scroll, so it keeps
    // showing the rest underneath.
    mounted: [
      {
        block: 'columns',
        columns: [
          [{ block: 'list', list: 'skills', as: 'rows' }],
          [{ block: 'list', list: 'resources', filter: 'capped', as: 'sheet' }],
          [{ block: 'statuses' }],
        ],
      },
    ],
    // Held glass used to keep scrolling to the rest of the character
    // below the fold — every uncapped resource, every stray field, notes
    // and children. That's gone (Brian, fix 6): the old app's printed
    // Sheet screen was exactly Skills/Health+Grit/Statuses too, and
    // everything else moved to a screen of its own (the seat chrome's
    // declared-screens tabs, `client/components/seat/SeatChrome.tsx`) —
    // the holding pen the old app called "More". Duplicating that
    // spillover here would show it twice.
    held: [
      { block: 'list', list: 'skills', as: 'rows' },
      { block: 'list', list: 'resources', filter: 'capped', as: 'sheet' },
      { block: 'statuses' },
    ],
  },
  {
    name: 'classic',
    label: 'Classic',
    blurb: 'What teller shipped first — the one to beat.',
    subject: 'entity',
    mounted: [
      { block: 'list', list: 'resources', as: 'bars' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
    held: [
      { block: 'list', list: 'resources', as: 'bars' },
      { block: 'list', list: 'skills', as: 'strip' },
      { block: 'statuses' },
    ],
  },
  {
    name: 'bare',
    label: 'Bare',
    blurb: "The floor's grammar — every stored value, one control each.",
    subject: 'entity',
    mounted: [{ block: 'floor' }],
    held: [{ block: 'floor' }],
  },
  tool('roster', 'Roster', 'Everyone at the table; open a sheet, stamp a foe.'),
  tool('runner', 'Runner', 'The turn order — round, rolling, next, assist.'),
  tool('encounters', 'Encounters', 'Prep: author a fight against the merged bestiary.'),
  tool('bestiary', 'Bestiary', 'Everything you could put in front of the party.'),
  tool('screens', 'Screens', 'The room: adopt by code, assign roles, identify.'),
  tool('shelf', 'Shelf', "This machine's systems, packs and what the campaign runs on."),
  tool('plugins', 'Plugins', 'Discovered on disk; enabled only by you, here.'),
  tool('boards', 'Boards', 'The maps and their live placements.'),
  tool('log', 'Log', 'Everything that happened, newest first (rule 3, readable).'),
  tool('rules', 'Rules', 'The book, searchable — a status, an action, a page.'),
];

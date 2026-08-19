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

/** Every list a sheet places by hand, so `rest` can catch the strays. */
const PLACED = ['skills', 'resources', 'conditions', 'meta'];

export const STANDARD_PANELS: PanelDef[] = [
  {
    name: 'sheet',
    label: 'Sheet',
    blurb: 'Arranged like the paper you already know.',
    subject: 'entity',
    mounted: [
      { block: 'brand' },
      { block: 'header' },
      {
        block: 'columns',
        columns: [
          [
            { block: 'list', list: 'skills', as: 'rows' },
            { block: 'statuses' },
          ],
          [
            { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
            { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
          ],
          [
            { block: 'rest', except: PLACED },
            { block: 'children' },
            { block: 'notes' },
          ],
        ],
      },
    ],
    held: [
      { block: 'brand' },
      { block: 'header' },
      { block: 'list', list: 'resources', filter: 'capped', as: 'big' },
      { block: 'list', list: 'skills', as: 'rows' },
      { block: 'statuses' },
      { block: 'list', list: 'resources', filter: 'uncapped', as: 'ledger' },
      { block: 'rest', except: PLACED },
      { block: 'children' },
      { block: 'notes' },
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
  tool('screens', 'Screens', 'The room: adopt by code, assign roles, identify.'),
  tool('shelf', 'Shelf', "This machine's systems, packs and what the campaign runs on."),
  tool('plugins', 'Plugins', 'Discovered on disk; enabled only by you, here.'),
  tool('boards', 'Boards', 'The maps and their live placements.'),
  tool('log', 'Log', 'Everything that happened, newest first (rule 3, readable).'),
];

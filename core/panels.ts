// The standard panel collection — teller's furniture (§E, settled
// 2026-08-18).
//
// A `.panel` is a named declaration that arranges components on a
// surface. It rides the same stack as every other declaration —
// vocabulary-coupled, merged by NAME, later wins — under a `panels`
// slot on any layer. THIS file is the TYPES only. The arrangements
// teller ships — the HOST's own tools, since a play screen without a
// system has nothing to arrange — are files in the install's
// `defaults/panels/`, and they are the layer below everything. A
// system, pack, campaign or the TABLE itself adds its own or overrides
// one by restating its word; the table's is topmost and wins (rule 1
// for UI). Furniture, not content — a panel gates nothing and grants
// nothing; the ROLE decides what a screen may do, the panel only
// decides how it looks.
//
// Two authored arrangements, never one responsive layout: `mounted`
// (fixed height, never scrolls, columns) and `held` (a hand's glass,
// scrolls down, one column). Blocks are nouns — layout + components
// only, never control flow.
//
// "E extended again" (2026-08-18): nothing here is gatekept. teller's
// defaults ship as `.panel` folders in the INSTALL (`defaults/panels/`)
// and the data dir's `panels/` belongs to the table alone — teller never
// writes into it (2026-08-19, §M-6's first wrinkle). A duplicated folder
// — copy `sheet/` to `my-sheet/`, edit `name` inside — is just another
// file in the collection; the NAME is still the merge key, the minted
// `pan_` id only names the file. The fs-touching half lives in the
// sibling `panels-shelf.ts` and not here: THIS file is type-imported
// straight from `client/` (the panel renderer wants
// `PanelDef`/`PanelBlock`), so it must stay import-safe for a browser
// build — no `node:fs`, no `node:path`.
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
   * Where this panel sits in a bar of tabs. Ordinary declaration data,
   * so it merges like everything else — a later layer restating the
   * name with a different `order` moves the tab, and the table's
   * restatement moves anything (rule 1, pointed at the furniture).
   * Undeclared means `PANEL_ORDER_DEFAULT`; see `byPanelOrder`.
   */
  order?: number;
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
  if (typeof r.order === 'number' && Number.isFinite(r.order)) out.order = r.order;
  return out;
}

/**
 * Where an undeclared panel sits: the MIDDLE, not the end. A system's
 * play screens declare nothing today, and they are the reason anyone
 * opens the console — so the rule has to read right when the number is
 * absent. Low sorts first, high sorts last, and silence lands between
 * them: teller's own host tools carry 90-98 and sit after the play
 * screens, a system that wants one of its screens first says 10.
 */
export const PANEL_ORDER_DEFAULT = 50;

/**
 * The ONE order a bar of panels is drawn in — the console's tabs, the
 * Screens picker's pane list, anything that offers panels to choose
 * from. Declared number first, then the visible word, so a shelf full
 * of undeclared panels still reads alphabetically instead of by
 * whichever folder the sweep happened to open first.
 */
export function byPanelOrder(a: PanelDef, b: PanelDef): number {
  const order = (p: PanelDef) => p.order ?? PANEL_ORDER_DEFAULT;
  return (
    order(a) - order(b) ||
    (a.label ?? a.name).toLowerCase().localeCompare((b.label ?? b.name).toLowerCase())
  );
}

/** Every list a sheet places by hand, so `rest` can catch the strays.
 * Exported for the seat chrome's synthesized 'More' screen
 * (`client/components/seat/SeatChrome.tsx`, fix 1/6) — the same strays
 * that used to spill onto held-glass Sheet now spill there instead. */
export const PLACED = ['skills', 'resources', 'conditions', 'meta'];

// The five panels teller SHIPS — boards, log, plugins, screens, shelf,
// the ones about this machine and the room around it — used to live
// here as an in-code array. They are files now:
// `defaults/panels/<name>/panel.json` in the install, loaded by
// `defaultPanels()` in `panels-shelf.ts`. Nothing about a panel is a
// special case any more; teller's own are read by the same sweep that
// reads a system's, a pack's and the table's.

// The contract. Shared by worker and web (imported cross-boundary by path).
//
// teller's data model is deliberately dumb: a small set of generic
// primitives (fields, counters, tags, notes) that humans fill in.
// No rules engine — see CLAUDE.md ("track, don't compute").

export type Counter = {
  id: string;
  name: string;
  current: number;
  /** null = unbounded (set per character, e.g. HP max entered by hand) */
  max: number | null;
  /**
   * Presentation hint only — 'clock' renders as a segmented progress
   * clock (Blades-style; needs a max). Same data, same events, same
   * undo; nothing downstream may branch on it except renderers.
   */
  display?: 'clock';
  /**
   * Kept out of /public snapshots (board, badge) until the DM reveals
   * it. The seat still sees its own — hidden is about the table-facing
   * surfaces, not the player's own card.
   */
  hidden?: boolean;
};

/** Render vocabulary for a state — how the table shows it, nothing more. */
export type StateEffect = 'wound' | 'burn' | 'chill' | 'daze' | 'mark' | 'fade';

/**
 * A condition a combatant can be IN, as the encounter panel offers it.
 *
 * A state IS a tag (rule 2) — this only adds presentation and, at most,
 * a proposal. `suggest` makes teller ASK when a counter crosses the
 * line ("Bloodied?"); it never applies anything itself. That's rule 1:
 * a rules engine may propose into a slot, never own it. The name is
 * vocabulary, not rules text, so templates may carry it.
 */
export type EncounterState = {
  /** The tag applied when the DM accepts it. */
  name: string;
  effect?: StateEffect;
  suggest?: {
    /** Counter name to watch, matched case-insensitively. */
    counter: string;
    /** Offer the state at or below this fraction of max (0..1). */
    atOrBelow: number;
  };
};

export type Field = {
  key: string;
  label: string;
  value: string;
};

export type CharacterData = {
  fields: Field[];
  counters: Counter[];
  tags: string[];
  notes: string;
  /**
   * The blueprint this was stamped from — PROVENANCE, not a live link.
   * Editing the blueprint later never reaches back into creatures
   * already on the table; this only answers "is saving this an update
   * to my own blueprint, or a new creature?".
   *
   * Absent for PCs and for anything invented directly on the table.
   */
  blueprintId?: string;
};

/**
 * A reusable NPC: the same generic primitives a character has, minus
 * identity. Stamping one out creates real characters that are editable
 * and disposable like any other — the blueprint is a starting kit, not
 * a live link (same relationship templates have to campaigns).
 *
 * Blueprints are per-instance content, like packs: they may hold what
 * the DM's own books say, and they never ship in the repo (rule 4).
 */
export type NpcBlueprint = {
  id: string;
  name: string;
  fields: Field[];
  counters: Counter[];
  tags: string[];
  /** The page this foe is printed on, when it came from a book. */
  page?: number;
  /** Which book that page is in. Stamped from the pack when it's absent. */
  book?: string;
};

export type Character = {
  id: string;
  campaignId: string;
  name: string;
  kind: 'pc' | 'npc';
  data: CharacterData;
  createdAt: string;
  updatedAt: string;
};

/** An uploaded image the DM can push to the player-facing surfaces. */
export type Handout = {
  id: string;
  /** R2 object key (served via /api/maps/*). */
  key: string;
  name: string;
};

/**
 * How the table frames a scene. cu/cv = map-space (0..1) point at the
 * viewport center; zoom multiplies true scale (1 = exact inches).
 * See docs/BATTLEMAP.md for the coordinate-space rules.
 */
export type SceneView = {
  mode: 'fit' | 'true';
  zoom: number;
  cu: number;
  cv: number;
  /**
   * Framing is deliberate, not incidental: while locked, nothing in
   * the editor can re-aim the table (physical minis are standing on
   * this framing). Unlocking is one tap.
   */
  locked?: boolean;
};

/**
 * Presentation styles for zone tokens — fire, oil, smoke on the
 * GROUND. Pure render vocabulary: teller draws the burning patch;
 * whether standing in it hurts is the humans' business.
 */
export type TokenEffect = 'fire' | 'oil' | 'smoke' | 'ice' | 'poison' | 'water';

/**
 * A token: a ground marker on a scene — deliberately dumb (no vision,
 * no auras-as-data). Position in map space (u/v ∈ 0..1), size in
 * physical inches. characterId links it to a character, unlocking
 * reactive render effects on the table (turn glow, wound tint).
 * `effect` turns the disc into an environmental zone (renders under
 * everything, no label/glow).
 */
export type Token = {
  id: string;
  label: string;
  u: number;
  v: number;
  sizeInches: number;
  color: string;
  characterId?: string | null;
  effect?: TokenEffect;
  /** Zone tokens only: footprint shape (default circle). */
  shape?: 'circle' | 'square' | 'triangle';
  /** Zone tokens only: rotation in degrees (45° steps from the editor). */
  rot?: number;
  /**
   * Behind the screen: stripped from /public entirely, so the table
   * never receives it. Revealing is one tap — an ambush that was
   * always there, a trap that becomes real when someone finds it.
   */
  hidden?: boolean;
};

/**
 * Ground effects painted onto map-space 1-inch tiles (cells indexed
 * [col, row] from the map origin; requires widthInches). One entry
 * per effect. Painted in the scene editor, rendered under everything.
 */
/**
 * One patch of painted ground. Identity is the id, NOT the effect —
 * two separate fires are two layers, hidden, revealed and deleted
 * independently. (Legacy rows predate `id`; the editor assigns one on
 * first touch.)
 */
export type TileZone = {
  id?: string;
  effect: TokenEffect;
  cells: [number, number][];
  /** Behind the screen until revealed — never sent to /public. */
  hidden?: boolean;
};

/**
 * A scene: a battle map or splash image for the table TV.
 * widthInches = the map's intended physical width (publisher-stated);
 * with the display's calibrated ppi it makes true-scale rendering
 * possible. Fog arrives in the next battlemap phase.
 */
/**
 * Fog over the map, in the same 1-inch cells as painted ground.
 * Stored as what's REVEALED (the common case is a mostly-dark map),
 * so a fresh cover costs one flag instead of nine hundred cells.
 * No vision simulation, ever — the Warden's finger is the vision
 * system (docs/BATTLEMAP.md).
 */
/**
 * A named area — a room, a canyon mouth, the far bank — painted once
 * during prep and revealed with one tap when the posse walks in.
 */
export type FogRegion = {
  id: string;
  name: string;
  cells: [number, number][];
  revealed: boolean;
};

export type Fog = {
  on: boolean;
  /** Freeform painted reveals, outside any region. */
  revealed: [number, number][];
  /** DM-only structure: flattened away before this reaches the table. */
  regions?: FogRegion[];
};

export type Scene = {
  id: string;
  key: string;
  name: string;
  widthInches?: number;
  view?: SceneView;
  tokens?: Token[];
  zones?: TileZone[];
  fog?: Fog;
  /**
   * The grid belongs to the MAP, not the screen: drawn in map space on
   * the map's own inch lines, so it lines up with painted ground, fog
   * cells, and the workshop preview by construction. Default on.
   * Colour and opacity are per-map too — a dark cave wants pale lines,
   * bright sand wants dark ones.
   */
  grid?: { on: boolean; color?: string; opacity?: number };
};

/**
 * One creature in a prepared fight.
 *
 * Its own record, never a stack of three — because each one wants its
 * own square, its own name, and its own answer to "is it hidden". A
 * placement REFERENCES a blueprint and stores only the difference, so
 * fixing a typo in the pack reaches every fight that didn't override
 * that field.
 */
export type Placement = {
  id: string;
  /** Resolved through the campaign's bestiary — pack foes included. */
  blueprintId: string;
  /** "the leader", when this one isn't just another Bloodsucker. */
  name?: string;
  /** Field values and counter maxes that differ, keyed by field key / counter name. */
  overrides?: {
    fields?: Record<string, string>;
    counters?: Record<string, { current?: number; max?: number | null }>;
  };
  /** Conditions it starts with — asleep, dug in, already wounded. */
  tags?: string[];
  /**
   * Where it starts, in map space (see docs/BATTLEMAP.md). Only
   * meaningful when the encounter names a scene; a mapless fight simply
   * leaves them out. Never cells: `widthInches` can be corrected later
   * and this must stay glued to the picture.
   */
  u?: number;
  v?: number;
  sizeInches?: number;
  /** Behind the screen until revealed — an ambush that was always there. */
  hidden?: boolean;
};

/**
 * A prepared fight: who's in it, and where they start if there's a map.
 *
 * **Mapless is the default.** The table is the ground and the humans are
 * the rules engine, so most fights happen on a mat or in description; a
 * scene is enrichment, exactly as a book is to a pack. `sceneId` absent
 * means "just bring me the foes".
 *
 * Deploying stamps out characters; the encounter itself is a recipe and
 * stays pristine, so it can be run again for another group.
 */
export type Encounter = {
  id: string;
  name: string;
  /** The prepared board this runs on, when it has one. */
  sceneId?: string | null;
  foes: Placement[];
  notes?: string;
};

export type CampaignData = {
  /** UI strings per system — e.g. { gm: 'Warden' }. */
  vocabulary: Record<string, string>;
  /** Party-level resources (supplies, group Prestige, doom clocks…). */
  counters: Counter[];
  /**
   * States the encounter panel offers, seeded from the template and
   * editable afterwards like everything else.
   */
  states?: EncounterState[];
  /** The bestiary: NPCs to stamp out. Per-instance content, never shipped. */
  npcs?: NpcBlueprint[];
  /** Prepared fights — see `Encounter`. Most of what a module is made of. */
  encounters?: Encounter[];
  /**
   * Which printing of a foe this table uses, when more than one pack
   * carries it: npc id → pack id.
   *
   * A core bestiary and the adventure that reprints it are the common
   * case, and they're usually identical — but when they aren't, the
   * choice is the Warden's, not pack-sort-order's (rule 1). Absent
   * means "whichever pack sorts first", which is the default, not a
   * decision. An entry naming a pack that's since gone falls back to
   * that default rather than breaking the foe.
   */
  foePicks?: Record<string, string>;
  /**
   * Books this table expects, by content hash.
   *
   * The host owns the shelf; this says which of it matters HERE, so a
   * console shows the two books this adventure uses instead of every
   * rulebook you own. Seeded from a bundle's `books.json` on import and
   * editable afterwards like everything else.
   */
  books?: string[];
  /**
   * The packs this campaign runs on, by id, **in precedence order**.
   *
   * The same shape as `books` and for the same reason: the host owns the
   * shelf, the campaign says which of it applies here. This is what a
   * bundle's `requires.packs` becomes on import, and what it's built
   * from on export — so a `.story` can reference rules content instead
   * of carrying it.
   *
   * The order is load-bearing. When two packs print the same foe and no
   * `foePick` says otherwise, LATER WINS — you name the base, then what
   * goes on top. Empty or absent means "everything for this system",
   * which is what a one-pack host should never have to think about.
   */
  packs?: string[];
  /**
   * The campaign this one was imported from, if any. Provenance for
   * bundles: re-importing a module recognises its own kin and can offer
   * to layer rather than making a twin. Never confers anything.
   */
  originId?: string;
  /**
   * Warden's reference text — house rules, pasted rules excerpts,
   * table notes. Lives ONLY in the campaign's own database (personal
   * use); never ships in templates and never leaves via /public.
   */
  reference?: string;
  /**
   * Legacy single-map pointer (pre-scene-library). Still honored as a
   * fallback when no scene is active; new uploads go to `maps`.
   */
  map?: { key: string };
  /** Scene library: named battle maps / splash art for the table TV. */
  maps?: Scene[];
  /** Which scene the table is showing. Falls back to legacy `map`. */
  activeMapId?: string | null;
  /** Derived, /public responses only: the resolved active scene. */
  scene?: Scene | null;
  /**
   * LEGACY. Calibration lived here when there was assumed to be one
   * table screen per campaign; it belongs to the glass, so it now lives
   * on the display row (`Display.ppi`/`ppiY`). Kept only as a fallback
   * for a screen that hasn't been calibrated since the move, and as the
   * home of the vestigial `on`/`ox`/`oy` from the screen-fixed grid.
   */
  grid?: { on?: boolean; ppi: number; ppiY?: number; ox?: number; oy?: number };
  /** LEGACY, same reason — see `Display.viewport`. */
  tableDisplay?: { w: number; h: number };
  /**
   * Handout library — DM-only. The list never leaves via /public
   * (staged spoilers must not leak); only the ACTIVE handout does.
   */
  handouts?: Handout[];
  /** Which handout is currently pushed to board + art surfaces. */
  activeHandoutId?: string | null;
  /**
   * Derived, /public responses only: the resolved active handout.
   * Never stored.
   */
  handout?: Handout | null;
};

export type Campaign = {
  id: string;
  name: string;
  system: string;
  data: CampaignData;
  createdAt: string;
};

// --- System templates -------------------------------------------------------
// A template is a STARTING KIT: structure + vocabulary only, never rules
// text. It seeds a campaign/character; after creation everything is
// freely editable and the template is out of the picture.

export type TemplateCounter = {
  name: string;
  current?: number;
  max?: number | null;
};

export type SystemTemplate = {
  /** Stable identifier, e.g. 'dnd5e', 'wiw'. */
  system: string;
  version: number;
  name: string;
  vocabulary: Record<string, string>;
  character: {
    fields: { key: string; label: string; value?: string }[];
    counters: TemplateCounter[];
    tags: string[];
  };
  /** Starting kit for kind 'npc' (foes/NPCs). Falls back to `character`. */
  npc?: {
    fields: { key: string; label: string; value?: string }[];
    counters: TemplateCounter[];
    tags: string[];
  };
  campaign: {
    counters: TemplateCounter[];
  };
  /** Starting kit of encounter states — vocabulary + thresholds only. */
  states?: EncounterState[];
  /**
   * How this system rolls, as DATA (rule 4, amended 2026-08-10).
   *
   * teller ships one small evaluator; a system arrives as a row rather
   * than a code change. Faces are listed literally so a die is just its
   * sides — no distributions to encode, and a system with a d20 or 2d6
   * describes itself the same way.
   */
  dice?: {
    /** Die letter → its faces, e.g. B: [hit, hit, ace, blank, blank, spur]. */
    faces: Record<string, string[]>;
    /** Face → what it's worth when the pool is totalled. */
    values: Record<string, number>;
    /** Faces rerolled until they become something else. */
    reroll?: string[];
    /** What a total is CALLED here — "Hits", "successes", "total". */
    unit?: string;
    /**
     * How many die slots a skill has on this system's sheet.
     *
     * A printed sheet draws the WHOLE track and you write a letter into
     * each slot you own, so an empty slot and a slot that doesn't exist
     * look different. Rendering only the dice a character HAS loses
     * that: "3 of a possible 6" and "3, and that's all there is" become
     * the same picture.
     *
     * Structure, not prose, so it's fair game for a template (rule 4).
     * Absent means "no fixed track" and a pool renders as just its own
     * dice — which is right for a system that doesn't work this way.
     */
    track?: number;
    /** Slots past the track's mark, if the sheet prints any. */
    trackBonus?: number;
  };
  /**
   * Which field decides turn order, when the table wants teller to roll.
   * Absent means this system doesn't roll for it and the list stays
   * manual — which is still a perfectly good way to run a fight.
   */
  initiative?: { field: string; highWins?: boolean };
  /**
   * Which fields belong to which block of this system's sheet.
   *
   * Arrangement, and it can't be inferred. WiW's SKILLS panel holds
   * exactly Charm, Finesse, Intuition and Nerve — Defense is a die pool
   * too but sits beside Health, Trade is the name at the top of the
   * page, and Speed is a word. No heuristic separates those; the sheet
   * simply says so, and so does this.
   *
   * Structure rather than prose, so a template is the right home for it
   * (rule 4). A block nobody declares just isn't rendered, and fields in
   * no block still show up in the card's general stat strip — nothing
   * disappears for want of a declaration.
   */
  groups?: Record<string, string[]>;
  /**
   * Field VALUE → accent colour, for systems whose sheets are themed.
   *
   * WiW prints a different colour per trade — the Doctor's sheet is
   * orange, the Marshal's blue, the Hunter's green — and a player's card
   * looking like their own sheet is most of why the sheet layout is
   * worth having. Which field decides it is `groups.title`.
   *
   * A colour is not prose, so this is a template rather than a pack
   * (rule 4) — though under TEL-63 it's arguably skin, and it can move
   * to a pack later without anything here changing shape. An unlisted
   * value just uses the default accent.
   */
  accents?: Record<string, string>;
  /**
   * Counter NAME → field keys that belong in that counter's own panel.
   *
   * Some stats aren't loose numbers, they're part of a resource's block:
   * WiW prints Defense inside the HEALTH panel, because Defense is what
   * you check before Health moves. A D&D sheet does the same with AC and
   * hit points. Nothing about the data says so — the sheet does, and so
   * does this.
   *
   * A pinned field is still an ordinary field: it's editable wherever
   * fields are edited, and a system that pins nothing loses nothing —
   * every field keeps its place in the general stat strip.
   */
  pins?: Record<string, string[]>;
};

// --- Rules packs ------------------------------------------------------------
// A pack is reference CONTENT (rulebook excerpts, homebrew) keyed to a
// system. Packs are uploaded data, stored per-instance in D1, and are
// deliberately not part of templates: templates ship in the repo
// (structure only), packs never do.

export type PackEntry = {
  name: string;
  /** Short qualifier shown next to the name — e.g. "Charm" or "1 Grit". */
  meta?: string;
  text: string;
  /**
   * Where this lives in the book, so the console can open the page —
   * for the art, the sidebar, and the table the digest left out.
   *
   * Optional forever. The entry's text is the thing that works with no
   * book at all; the page is the enrichment (see `RulesPack.books`).
   */
  page?: number;
  /** Which book, when the pack is about more than one. Defaults to the pack's. */
  book?: string;
};

export type PackSection = {
  title: string;
  entries: PackEntry[];
};

/**
 * A pack: the unit of content.
 *
 * Distilled rulings AND the monsters they describe. That's a working
 * table on its own — most Wardens own paper, and a pack needs no PDF to
 * be useful. A book, when you have one, attaches by hash and adds the
 * page and the art. Enrichment, never a prerequisite.
 */
export type RulesPack = {
  /**
   * Minted once, at authoring, and carried in the file forever.
   *
   * A book can hash its own bytes because a book is immutable. A pack is
   * EDITED, so a content hash would mint a new identity every time a
   * page number was corrected and break every reference to it. So this
   * is random, assigned once, and stable across every later edit — the
   * decision blueprints already made: identity is the id, never the name.
   *
   * Optional in the type only so a hand-written pack can omit it; the
   * host mints one on ingest and writes it back into the file.
   */
  id?: string;
  system: string;
  name: string;
  /**
   * Bumped by whoever edits the pack. This is what makes `requires`
   * meaningful — "the Guidebook, v3" is a real statement — and it's how
   * the boot sweep decides whether a file on disk supersedes the row.
   */
  version: number;
  sections: PackSection[];
  /**
   * The bestiary this pack brings. Having the pack means having the
   * foes, the way having the book on a shelf does — instead of every
   * new campaign starting empty.
   */
  npcs?: NpcBlueprint[];
  /**
   * Book ids (content hashes) this pack is about. A LIST, because the
   * hash is of exact bytes and a corrected re-upload or a copy from
   * another store is a different hash for the same book.
   *
   * It identifies, it does not authorise: a pack whose book is absent
   * still works completely. Only "jump to the page" is missing.
   */
  books?: string[];
};

/**
 * A rulebook PDF in this instance. Content, like packs — personal-use
 * data in a private DB, never repo content and never distributed.
 * `indexed` is false until the browser finishes extracting its text;
 * search skips it until then. A scan has no text layer and will index
 * to nothing (OCR is a separate problem).
 */
export type Book = {
  id: string;
  name: string;
  pages: number;
  indexed: boolean;
  createdAt: string;
};

/**
 * One search result: which book, which page, and what it says there.
 *
 * `snippet` carries the matched words fenced in \x02…\x03 so the console
 * can highlight them — see `splitSnippet` in `src/lib/books.ts`. Render it
 * raw and the fences are invisible, which is the point of using control
 * characters: forgetting to split degrades, it doesn't break.
 */
export type BookHit = {
  bookId: string;
  bookName: string;
  page: number;
  snippet: string;
};

export type PackRecord = {
  id: string;
  system: string;
  name: string;
  pack: RulesPack;
  updatedAt: string;
};

// --- Displays ---------------------------------------------------------------
// Every screen is the same kind of thing — phone, tablet, table TV,
// rail panel. It joins by showing a code; the DM says what it is. The
// role is the whole permission model: the server looks up what a
// display was assigned and allows exactly that (CLAUDE.md rule 7).

export type DisplayRole =
  /** Claimed but not yet given a job — shows its name, nothing else. */
  | 'blank'
  /** The ground: active scene, full-bleed. */
  | 'table'
  /** Player-facing bookkeeping — initiative, counters, notices. */
  | 'board'
  /** Fullscreen frame for the active handout. */
  | 'art'
  /** Outward-facing card for one character. */
  | 'badge'
  /** One player's own controls — may edit that character and no other. */
  | 'seat'
  /** A slice of the DM console, with all the power that implies. */
  | 'console';

export type DisplayParams = {
  /** seat + badge: whose card this is. */
  characterId?: string | null;
  /**
   * console: which slice to render. null = the whole console.
   *
   * Opaque here on purpose. The list of panes lives in `src/lib/panes.ts`
   * and only there (rule 6) — this used to name five of them while that
   * file listed seven, which is exactly the drift the rule exists to
   * prevent. The server stores the preference; the client owns the
   * vocabulary and validates it.
   */
  pane?: string | null;
  /**
   * seat: which arrangement of the card this screen wants.
   *
   * Same deal — `src/lib/seat-layouts.ts` is the list. Kept on the
   * DISPLAY rather than in that device's own storage, and not because
   * the server needs it: a beta test where the DM can't see what each
   * player chose measures nothing. It's also why a player switching
   * layouts on their phone doesn't change what anyone else sees.
   *
   * Unset means the default, and an unrecognised value renders the
   * default too — a preference should never be able to blank a screen.
   */
  layout?: string | null;
};

export type Display = {
  id: string;
  /** null until the DM claims it with the pairing code. */
  campaignId: string | null;
  name: string;
  color: string;
  role: DisplayRole;
  params: DisplayParams;
  /**
   * Px per true inch for THIS screen, per axis — a fact about the glass,
   * so it survives role changes and follows the screen between
   * campaigns. null until calibrated. See docs/BATTLEMAP.md.
   */
  ppi: number | null;
  ppiY: number | null;
  /**
   * The screen's self-reported viewport in CSS px. Telemetry, not
   * control: with ppi it says how many true inches of picture this
   * screen has, which is what the workshop's frame preview needs.
   */
  viewport: { w: number; h: number } | null;
  /** Present only while waiting to be claimed. */
  code: string | null;
  lastSeenAt: string;
  createdAt: string;
};

/** Roles that may only ever RECEIVE the player-safe snapshot. */
export const PASSIVE_ROLES: DisplayRole[] = ['blank', 'table', 'board', 'art', 'badge'];

/**
 * A display's public handle — sha-256 of its id.
 *
 * The SSE stream can't carry headers, so the DO learns which screen is
 * on the other end from the URL. Putting the raw id there would put a
 * capability in every access log; this is derived the same way on both
 * sides, is enough to aim an event at one screen, and grants nothing
 * to whoever reads it. (Runtime helper in the contract file on purpose:
 * the worker and the web client must derive it identically.)
 */
export async function displayHandle(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- Live session (Durable Object) -----------------------------------------

export type InitiativeEntry = {
  id: string;
  /** Linked character, or null for an ad-hoc row ("3 coyotes"). */
  characterId: string | null;
  label: string;
  /**
   * What they rolled, when anyone rolled. teller fills this in for foes
   * it deployed; players type their own on their seat. Null means
   * "hasn't rolled yet", which is what the console counts to know who
   * it's still waiting on — distinct from a genuine 0.
   */
  score?: number | null;
};

export type SessionState = {
  /**
   * The order, and it is always the DM's to rearrange (rule 5). teller
   * may propose one by rolling what the system declares; dragging beats
   * anything it worked out.
   */
  initiative: InitiativeEntry[];
  /**
   * Taking rolls right now: seats show a number pad, the console shows
   * who it's still waiting on, and the list re-sorts as scores land.
   */
  rolling?: boolean;
  /** Index into initiative, or null when combat isn't running. */
  turn: number | null;
  round: number;
  /** DM-authored banner shown on the player-facing displays. */
  notice: string | null;
};

export type SessionOp =
  | { op: 'set'; initiative: InitiativeEntry[] }
  /** Open or close the taking-rolls phase. Opening clears every score. */
  | { op: 'rolling'; on: boolean }
  /** One combatant's result — from a seat, or typed by the DM. */
  | { op: 'score'; entryId: string; score: number | null }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'end' }
  | { op: 'notice'; text: string | null };

/**
 * A character as the player-facing displays see it: seat token and
 * notes stripped; NPCs additionally lose fields/counters (the table
 * may know a wolf is Bloodied — never its numbers).
 */
export type PublicCharacter = {
  id: string;
  campaignId: string;
  name: string;
  kind: 'pc' | 'npc';
  data: {
    fields: Field[];
    counters: Counter[];
    tags: string[];
    /**
     * Qualitative state derived server-side from the first max-bearing
     * counter — the table may know a wolf is Bloodied, NEVER its
     * numbers. Drives reactive token effects.
     */
    vitality?: 'healthy' | 'bloodied' | 'critical';
  };
};

/**
 * A calibration pattern the console puts on the table screen while the
 * DM works with a physical reference. Transient — never stored, never
 * part of a snapshot; it arrives over SSE and leaves the same way,
 * which is the only sanctioned route onto a passive surface.
 *
 * The steps, in order, and why each exists:
 *  - corners: markers hard against the viewport edges. If the DM can't
 *    see all four, the TV is cropping (overscan) and NOTHING downstream
 *    can be trusted — the frame preview would overstate coverage.
 *  - across / down: a tick strip of `inches` true inches at the
 *    candidate scale. The DM lays a jig on the glass and nudges until
 *    drawn marks sit on physical ones. Matching beats measuring, and a
 *    long baseline divides the error.
 *  - verify: single inch squares to check against a card.
 */
export type Calibration = {
  step: 'corners' | 'across' | 'down' | 'verify';
  /** Candidate px per true inch being tried, per axis. */
  ppi: number;
  ppiY: number;
  /** True inches the physical reference spans (counted, not measured). */
  inches: number;
};

export type StreamEvent =
  | { type: 'hello'; state: SessionState }
  | { type: 'session'; state: SessionState }
  | { type: 'character'; characterId: string }
  /**
   * Targeted: this display's assignment changed (or it was forgotten).
   * It re-reads itself and becomes whatever it now is.
   */
  | { type: 'assign' }
  /** Targeted: flash your name so the DM can tell which panel you are. */
  | { type: 'identify' }
  /** Table screens: show this calibration pattern, or null to stop. */
  | { type: 'calibration'; calibration: Calibration | null }
  | { type: 'ping' };

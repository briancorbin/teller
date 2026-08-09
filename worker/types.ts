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

export type CampaignData = {
  /** UI strings per system — e.g. { gm: 'Warden' }. */
  vocabulary: Record<string, string>;
  /** Party-level resources (supplies, group Prestige, doom clocks…). */
  counters: Counter[];
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
   * Display calibration for the TABLE screen: pixels per true inch,
   * horizontally (`ppi`) and vertically (`ppiY`).
   *
   * Measured off the glass, not taken from the panel's spec: what we
   * render into is the browser VIEWPORT, and TV overscan, a windowed
   * browser or OS scaling all make the visible picture smaller than
   * the panel — invisibly, and in a way a diagonal can't detect. The
   * DM measures the picture teller actually draws, so the calibration
   * absorbs all of that.
   *
   * Two axes because that measurement can also catch a stretched
   * picture. On a correctly-configured display they match; when they
   * don't, a true inch really is different across than down, and the
   * table renders it that way so a 1" square is 1" in both directions.
   * `ppiY` falls back to `ppi` (serializer normalises legacy rows).
   * (`on`/`ox`/`oy` are legacy from the screen-fixed grid.)
   */
  grid?: { on?: boolean; ppi: number; ppiY?: number; ox?: number; oy?: number };
  /**
   * The table client's self-reported viewport (CSS px) — telemetry,
   * not control; enables auto ppi (√(w²+h²) / diagonal inches).
   */
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
};

export type PackSection = {
  title: string;
  entries: PackEntry[];
};

export type RulesPack = {
  system: string;
  name: string;
  version: number;
  sections: PackSection[];
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
  /** console: which slice to render. null = the whole console. */
  pane?: 'session' | 'map' | 'characters' | 'library' | 'displays' | null;
};

export type Display = {
  id: string;
  /** null until the DM claims it with the pairing code. */
  campaignId: string | null;
  name: string;
  color: string;
  role: DisplayRole;
  params: DisplayParams;
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
};

export type SessionState = {
  /** Manually ordered — teller never models any system's initiative rules. */
  initiative: InitiativeEntry[];
  /** Index into initiative, or null when combat isn't running. */
  turn: number | null;
  round: number;
  /** DM-authored banner shown on the player-facing displays. */
  notice: string | null;
};

export type SessionOp =
  | { op: 'set'; initiative: InitiativeEntry[] }
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
  | { type: 'ping' };

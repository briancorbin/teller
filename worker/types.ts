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
  /** Seat claim, not an account: knowing this token = being this character. */
  seatToken: string;
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
};

/**
 * A scene: a battle map or splash image for the table TV.
 * widthInches = the map's intended physical width (publisher-stated);
 * with the display's calibrated ppi it makes true-scale rendering
 * possible. fog/tokens arrive in later battlemap phases.
 */
export type Scene = {
  id: string;
  key: string;
  name: string;
  widthInches?: number;
  view?: SceneView;
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
   * Table grid overlay, controlled from the console (the table is
   * passive glass). ppi = pixels per true inch on the table display —
   * calibrated by holding a mini base in a square and nudging ±.
   * ox/oy pan the grid so lines sit on the map's walls and streets.
   */
  grid?: { on: boolean; ppi: number; ox?: number; oy?: number };
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
  };
};

export type StreamEvent =
  | { type: 'hello'; state: SessionState }
  | { type: 'session'; state: SessionState }
  | { type: 'character'; characterId: string }
  | { type: 'ping' };

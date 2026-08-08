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

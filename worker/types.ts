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
   * clock (Blades-style; needs a max); 'money' renders the value as
   * currency, stored in integer MINOR units (3700 = $37.00), because
   * floats drift and money is the one place nobody forgives it. Same
   * data, same events, same undo; nothing downstream may branch on it
   * except renderers.
   */
  display?: 'clock' | 'money';
  /** display 'money': the currency mark the number wears — '$'. */
  symbol?: string;
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
  /**
   * Filing information: it matters when you're CHOOSING the thing, not
   * while you're playing with it.
   *
   * A catalogue is two audiences wearing one shape. Picking a rifle off
   * the page, Quality and Cost are most of the decision; mid-fight,
   * "Used · $20.00" is noise sat above the dice you actually need. The
   * split can't be derived — nothing about the string `"$20.00"` says
   * it's shopping data — so the pack declares it, and every surface
   * decides for itself: the picker shows everything, a play surface
   * skips these.
   *
   * NOT a hidden flag. Nothing is withheld; it's a statement about
   * which question the field answers.
   */
  filing?: boolean;
};

/**
 * A thing a character HAS, rather than a number a character IS.
 *
 * The first thing on the sheet that `fields`/`counters`/`tags` couldn't
 * express, and the temptation was to add a `weapons` table with columns
 * for Grit cost and range pools. That would have been the first
 * game-specific type in the schema (rule 2), and it would have been
 * wrong twice over: a weapon here is a spell focus somewhere else, and
 * "Grit cost" is only a column until a system prices things some other
 * way.
 *
 * So an item is **the same four primitives, nested**. A WiW revolver is
 * fields (Manufacturer, Model, and one die pool per range) plus counters
 * (its rounds). Everything already built works on it unchanged: a pool
 * renders as the skills track because `parsePool` reads it the same way,
 * ammunition is a gauge like any other, and nothing new had to learn
 * what a weapon is.
 *
 * It lives in the JSON blob (rule 8), so absent simply means none and no
 * migration is needed.
 */
/**
 * One thing this object was there for, as the player etched it. WiW
 * calls it a notch; that word is the template's (`growth.noun`), not
 * this file's.
 *
 * Named `Deed` rather than `Mark` on purpose: `SystemTemplate.marks` is
 * already the Talent tick, whose own comment records that it was twice
 * misread as Aim. Two unrelated "marks" in one contract is how a thing
 * gets misread a third time.
 *
 * A SNAPSHOT, and that is the whole point — everywhere else in teller
 * the discipline runs the other way. `Item.from` points at the
 * catalogue so a correction to the book reaches every character at
 * once; a bundle references packs and books rather than carrying them
 * (rule 9). Here that would be a bug, because what a mark names is
 * deliberately ephemeral: a deployed foe is an ordinary character row
 * that gets DELETED when the table clears, and a reference-based notch
 * would go blank the moment the fight was tidied up. Different
 * lifetime, opposite rule. Copy everything at tap time.
 *
 * It has to live here rather than in the event log for the same family
 * of reason: `worker/bundle.ts` carries characters and never events, so
 * a history stored only in the log would not survive an export — and a
 * weapon whose entire value is its history is exactly the wrong thing
 * to lose in a `.story`. What you wrote travels (rule 9). The log still
 * gets its row per notch, as the audit trail that makes this undoable.
 *
 * Generic on purpose: "things that happened to this thing, in order"
 * is not a game concept. A hat can have marks, so can a horse, so can
 * the posse's truck. Nothing in code may read `what` and act on it.
 */
export type Deed = {
  id: string;
  /** What it was, in whatever words were on screen at the time. */
  what: string;
  /**
   * The blueprint it came off, when it came off one — kept so a later
   * screen could count KINDS ("nine coyotes") without re-parsing names.
   * Absent for anything typed by hand, which stays first-class.
   */
  from?: string;
  /** Where: the active scene's name when it happened. */
  where?: string;
  /** The round, when combat was running. Absent otherwise. */
  round?: number;
  /**
   * When, ISO, stamped by the SEAT rather than the server.
   *
   * A mark is a story record, not an audit trail — the audit trail is
   * the event log, which the host stamps and which nobody can edit. So
   * a phone's wrong clock costs a wrong date on one line, and the DM
   * types over it (rule 1). Worth it to keep the write an ordinary
   * character PATCH with no special case anywhere in the route.
   */
  when: string;
  /** The player's own words. The reason anyone will read this later. */
  note?: string;
};

export type Item = {
  id: string;
  name: string;
  /**
   * The catalogue entry this came off, when it came off one.
   *
   * A REFERENCE, so the stats stay in the pack where the publisher's
   * numbers belong and a correction to the book reaches every character
   * at once. Absent for anything invented at the table, which keeps
   * working exactly as before.
   */
  from?: string;
  /** Upgrades fitted to it, and where the player pointed them. */
  upgrades?: FittedUpgrade[];
  /**
   * Values a person typed, which BEAT anything derived (rule 1).
   *
   * This is why the derived pool is a proposal and not an answer: the
   * table's ruling, a homebrew part or a Warden's call all land here and
   * win. An item with no catalogue entry has nothing else, so these are
   * simply its stats.
   */
  fields: Field[];
  counters: Counter[];
  tags?: string[];
  notes?: string;
  /**
   * Free-text grouping — "weapon", "ability", "gear".
   *
   * For sorting and for a person to read. NOTHING may branch on it:
   * the moment code says `kind === 'weapon'` this has become a
   * game-specific type wearing a string. (Comparing it against a kind
   * the TEMPLATE declares — `use.consumesKind` — is the sanctioned
   * pattern, the same way `dials` matches counter names.)
   */
  kind?: string;
  /**
   * What this thing has been through, oldest first. See `Deed`.
   *
   * Absent means nobody has started a tally, which is the default and
   * stays the default: etching is opt-in, and the first notch creates
   * the list. Nothing auto-adds this to weapons — that would mean code
   * branching on `kind === 'weapon'`, which is precisely the rule 2
   * trap. A player CHOOSING to start marking their pistol is also
   * better than every gun silently keeping score.
   *
   * The count is derived from this and never stored beside it, the
   * same discipline as the purse total: two places to hold one number
   * is one place for them to disagree.
   */
  history?: Deed[];
  /**
   * The consumable currently chambered — another item's id.
   *
   * WiW's special ammo is a character-level pool fired from whichever
   * weapon can take it (the pregens list it under ITEMS, not under a
   * gun), so this is a SELECTION, not containment: two weapons loaded
   * with the same box of rounds spend from the same count. Absent means
   * regular ammo, which the system doesn't track.
   */
  loaded?: string;
};

/**
 * What an upgrade DOES to a pool, as data.
 *
 * Two operations cover every pool-changing upgrade WiW has, and they
 * came straight off the book's own table rather than being invented:
 * Damage adds dice, Accuracy exchanges one colour for another. Optic,
 * Melee Attachment and Utility change no pool at all — Optic acts on the
 * roll's RESULT, the other two on what you're holding — so they carry no
 * effect here and simply describe themselves.
 *
 * `range` is a field key, not an enum. The book restricts Damage and
 * Accuracy to Short or Long, but that's this system's rule, not a shape
 * teller should enforce — a pack that puts one on Arm's Reach works.
 */
export type PoolEffect =
  | { op: 'add'; dice: string; range: string }
  | { op: 'convert'; from: string; to: string; count: number; range: string };

/** A thing the books describe, that a character can point at. */
export type CatalogItem = {
  id: string;
  name: string;
  /** Free-text grouping for the picker — "Rifles", "Melee". */
  group?: string;
  kind?: string;
  /**
   * The page this is printed on, when it came from a book — the same
   * enrichment `PackEntry.page` and `NpcBlueprint.page` carry, and it
   * was already in the data before it was ever in this type.
   */
  page?: number;
  /** How many upgrades it can take. */
  slots?: number;
  /** Base stats, before anything is bolted on. */
  fields: Field[];
  /** Counters it brings with it, e.g. tracked special ammunition. */
  counters?: Counter[];
  /**
   * What being CHAMBERED in something does to the host's pools — the
   * same shape an upgrade's effects take, applied while this entry is
   * an item's `loaded`. Almost all of WiW's special ammo acts after
   * the dice (Bang!, Status, Piercing, Knockback) and so carries none
   * of these; Explosive Arrowheads (+1G at Arm's Reach) is the one
   * that does. Meaningless on anything that can't be loaded.
   */
  effects?: PoolEffect[];
  notes?: string;
  /**
   * A BUNDLE: catalog ids this entry unpacks into when acquired — an
   * equipment pack becomes its blanket, rations and compass as
   * separate carried items, not one word. An id may repeat ("2× Pain
   * Pills" lists it twice). The bundle entry itself is the picker
   * card; what lands in inventory is the contents.
   */
  contents?: string[];
  /**
   * The mark this entry wears where it's offered as a choice, named
   * from teller's glyph set (`src/components/sheet/glyphs.tsx`).
   *
   * Same bargain as `SystemTemplate.icons`: the drawings are teller's,
   * the ASSIGNMENT belongs to whoever wrote the content, so no code
   * ever learns what an "Explorer's Pack" is (rule 2). It rides on the
   * entry rather than the template because an item arrives WITH a pack
   * and should bring its own face. An unknown name draws nothing and
   * the card still works.
   */
  icon?: string;
  /**
   * A picture of the thing: a KEY into the shared image store (served
   * at `/api/maps/<key>`, `~/.teller/<key>` on a host), exactly as
   * `trades[].art` works — a publisher's artwork lives beside their
   * books, per-instance, and never in this repo or a bundle (rule 4).
   *
   * Shown where you're CHOOSING the thing (the store's detail view),
   * which is the moment a picture earns its place. Absent, the entry's
   * `icon` stands in; absent both, the block isn't drawn at all.
   */
  art?: string;
};

/** A modification a catalogue item can take. */
export type CatalogUpgrade = {
  id: string;
  name: string;
  /**
   * The slot it occupies. One per type, which is the book's own rule and
   * the reason this is data rather than a name — `slotsUsed` and this
   * together are what a validator needs.
   */
  type: string;
  level?: number;
  /** How many of the item's slots it takes. Defaults to 1. */
  slotsUsed?: number;
  /**
   * More than one of this type may be fitted to the same thing.
   *
   * One-per-type is the book's rule and `type` is what encodes it — but
   * WiW's Utility upgrades say outright that they may fill every
   * remaining slot, so the exception has to be data too. Code that
   * special-cased the word "Utility" would be a game concept hiding in
   * an `if` (rule 2).
   */
  stacks?: boolean;
  /** What it does to the pools. Absent means it changes no numbers. */
  effects?: PoolEffect[];
  /** What it does that ISN'T arithmetic — shown, never computed. */
  text?: string;
};

/**
 * An upgrade a character actually fitted, and the choice they made.
 *
 * Damage and Accuracy both say "Short OR Long", so the choice belongs to
 * the character rather than the catalogue — the same upgrade is a
 * different weapon depending on where it was pointed.
 */
export type FittedUpgrade = {
  /** `CatalogUpgrade.id`. */
  from: string;
  /** Overrides the effect's own `range` when the player chose one. */
  range?: string;
};

export type CharacterData = {
  fields: Field[];
  counters: Counter[];
  tags: string[];
  notes: string;
  /** Things the character carries — see `Item`. Absent means none. */
  items?: Item[];
  /**
   * Mid-creation. A seat pointed at a draft renders the builder
   * instead of the sheet; the console shows "being built". Cleared by
   * the flow's last step — after that this is an ordinary character
   * and nothing remembers it was born guided (TEL-75).
   */
  draft?: boolean;
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

/**
 * What a tile IS — the static half of the two-layer ground model
 * (Brian, 2026-08-15): "a separate layer of tile info that is static —
 * this is lake tile deep water, this is shoreline, this is sand — that
 * doesn't render on the map, and then a separate layer for dynamic tile
 * states like on fire."
 *
 * The render rule that falls out: **draw what the art doesn't show.**
 * The map's picture already depicts the lake, so terrain never renders
 * on play surfaces (the scene editor may visualize it while editing);
 * a fire that starts in round 2 isn't in the picture, so `TileZone`
 * effects do render. Same cells, opposite visibility, and the
 * assistant reads both: terrain is what ground you're on, zones are
 * what's happening to it.
 *
 * `kind` is the author's own word — 'deep water', 'shoreline', 'sand'
 * — not an enum (rule 2: teller has no opinion on what kinds of ground
 * a world contains, and never adjudicates what standing there means).
 */
export type TerrainPatch = {
  id?: string;
  kind: string;
  cells: [number, number][];
};

export type Scene = {
  id: string;
  key: string;
  name: string;
  widthInches?: number;
  view?: SceneView;
  tokens?: Token[];
  zones?: TileZone[];
  /** Static ground semantics — data-only, see `TerrainPatch`. */
  terrain?: TerrainPatch[];
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

/**
 * One line of a vendor's stock: a catalogue reference, and what THIS
 * shop says about it. Both extras are proposals in the rule-1 sense —
 * the DM types the final figure at the counter regardless.
 */
export type VendorLine = {
  /** Catalogue item id — resolved through packs + the campaign's own. */
  ref: string;
  /** This shop's price, over the book's — "$4.50". Absent = the entry's. */
  price?: string;
  /**
   * Stock on hand — "he's only got 3 sticks of dynamite". Absent or
   * null = unlimited, which is the default on purpose: counting boxes
   * of matches is bookkeeping nobody asked for (Brian, 2026-08-14).
   */
  qty?: number | null;
};

/**
 * A shop the posse can walk into — a campaign entity, like an encounter
 * (rule 9: your world travels; the book's tables stay in the pack it
 * references).
 *
 * Stock is DERIVED unless declared: with no `stock` list, the vendor
 * carries everything in reach that has a cost, narrowed by `groups`
 * and `filters`. That's the general store for free; an explicit list
 * is the curiosity shop, line by line.
 */
export type Vendor = {
  id: string;
  name: string;
  /** One line of fiction for the shop's masthead. */
  blurb?: string;
  /** Explicit stock. Absent = derived from the catalogue. */
  stock?: VendorLine[];
  /** Derived stock: catalogue groups carried. Absent = all of them. */
  groups?: string[];
  /**
   * Derived stock: filing-field key → the values carried, e.g.
   * { quality: ['Used', 'Basic'] } — the book's own availability dial
   * (p. 65: "Basic weapons are most commonly found"). The KEY is data
   * the DM picked off the catalogue, never a word this code knows
   * (rule 2).
   */
  filters?: Record<string, string[]>;
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
  /**
   * This table's OWN gear and modifications — kitbashed weapons, a
   * Warden's one-offs, anything the books don't print.
   *
   * A pack describes a BOOK: it stays as its author wrote it, so that
   * installing the next version doesn't clobber your inventions and your
   * inventions never masquerade as the publisher's. Two ways in, and
   * both end here: copy an entry out of a pack, or write one from
   * scratch. Either way it becomes a NEW entry with its own id — never a
   * shadow of the pack's, because a weapon you modified is a different
   * weapon and the book's still exists beside it.
   *
   * It's also what makes homebrew travel (rule 9): a `.story` carries
   * the campaign and only REFERENCES packs, so gear written here goes
   * with the game while the book's tables stay on the host that owns
   * them.
   */
  catalog?: {
    items?: CatalogItem[];
    upgrades?: CatalogUpgrade[];
  };
  /** Prepared fights — see `Encounter`. Most of what a module is made of. */
  encounters?: Encounter[];
  /** The shops of this world — see `Vendor`. Travels with the campaign. */
  vendors?: Vendor[];
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
  /** Seeded onto the counter — see `Counter.display`. */
  display?: 'clock' | 'money';
  symbol?: string;
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
   * How this system measures the TABLE — what an inch means in the
   * world, what the range bands are, what moving costs, which band an
   * attack needs. Mechanics as prose, for anything that reasons about
   * the board (today: the assistant, which was otherwise guessing
   * "an inch is probably a move" from minis convention).
   *
   * System-layer on purpose (the three-layer model, 2026-08-15): scale
   * is how the game WORKS, not what exists in a world or how one table
   * arranged it. Numbers and range names are mechanics, fair game for
   * a template (rule 4); the book's own prose stays in the pack.
   */
  space?: string;
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
    /**
     * Faces that BANK when a roll is reported — WiW's Aces, marking the
     * Ace-in-the-Hole meter as a side effect of any combat roll. teller
     * only ever hears about rolls a player reports (the dice stay
     * physical), so this fires on the reporting surfaces; every other
     * ace is a tap on the tally, as it always was. One per rolled face
     * into the named counter, clamped by the counter's own max, through
     * the ordinary counter path (rule 1: event-logged, undoable, and a
     * mis-tap is a stepper away from fixed).
     */
    banks?: { face: string; counter: string }[];
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
   *
   * Two slots are load-bearing beyond arrangement: `title` names the
   * field that titles the sheet and picks the theme (see `accents`),
   * and `player` names the field holding the person at the table —
   * both drawn in the card's header rather than in any block.
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
  /**
   * Counter NAME → the face teller draws it with.
   *
   * A revolver cylinder is about as system-specific as a control gets —
   * spell slots are not bullets — so this cannot be inferred from the
   * data and must never be keyed off a counter's name in code (rule 2).
   * The system says which of its counters wears which face, the same way
   * `states[].effect` already picks from the effects teller can render.
   *
   * The list is what teller knows how to DRAW, not what any game means:
   *
   *   * `cylinder` — a revolver's chambers, one per point, advancing a
   *     click each time the value drops. Only sensible for a small max;
   *     anything past `RING_LIMIT` falls back to the ordinary gauge.
   *   * `cards` — a hand of playing cards, one dealt face-up per point,
   *     with the last slot face-down until the hand completes. Built
   *     for a collect-then-spend tally; past `CARDS_LIMIT` it falls
   *     back to tick boxes.
   *
   * Undeclared counters keep the default treatment, so a system that
   * says nothing loses nothing.
   */
  dials?: Record<string, 'cylinder' | 'cards'>;
  /**
   * Counter name → glyph, for counters the system dresses compactly.
   *
   * An iconed counter renders as a pocket chip — glyph, name, value —
   * grouped with its fellows into one slim tile at the left edge of
   * whichever screen claims it, instead of a full panel. The glyph set
   * is teller's (drawn in the sheet's own line style — see
   * `src/components/sheet/glyphs.tsx`); WHICH counter wears which
   * glyph is the system's declaration, so no counter name is ever
   * special-cased in code (rule 2). An unknown glyph name draws
   * nothing and the chip still works.
   *
   * The key is any NAME the sheet uses, not only a counter's: a field
   * label may claim a glyph too, which is how the skills wear marks on
   * the creation cards. Only counters become pocket chips — that
   * behaviour reads this map while walking the counters, so naming a
   * field here decorates it without moving it anywhere.
   */
  icons?: Record<string, string>;
  /**
   * How USING an item spends things, when this system prices actions.
   *
   * WiW: firing a weapon costs its Grit and consumes one of whatever
   * special ammo is chambered. All three names are this system's, so
   * all three are declared rather than known (rule 2) — teller ships
   * the arithmetic and never the words "fire", "Grit" or "ammo":
   *
   *   * `costField` — the item field holding the price ('grit'). An
   *     item without the field, or with a non-numeric value in it,
   *     simply gets no button — derived, like every other shape choice.
   *   * `costCounter` — the character counter the price debits ('Grit').
   *   * `consumesKind` — item kind offered as loadable consumables
   *     ('ammo'). One is decremented per use when one is chambered;
   *     absent means using an item only ever costs the counter.
   *
   * The button this drives is bookkeeping, not a resolver (rule 1): it
   * decrements two counters through the same paths a finger on a
   * stepper takes — event-logged, undoable, and correctable by tapping
   * `+` when the table rules the shot didn't happen.
   *
   * A system that declares nothing loses nothing: no button, and items
   * keep working as plain stat blocks.
   */
  use?: {
    costField: string;
    costCounter: string;
    consumesKind?: string;
    /**
     * The word on the trigger — WiW's "Fire". The button used to be
     * price-only ("− 3 Grit") precisely so teller never had to know a
     * verb; declaring it keeps that true (rule 2) while letting the
     * button say what the table says. Absent, the price stands alone.
     */
    verb?: string;
    /**
     * The trigger's word per item KIND, when one word doesn't fit all —
     * WiW fires a weapon but USES an ability. Falls back to `verb`.
     */
    verbs?: Record<string, string>;
    /**
     * Additional currencies a use can price, beyond `costField`.
     *
     * Each entry names an item FIELD holding the amount and the
     * character counter it debits — WiW's Ace-in-the-Hole abilities
     * carry `aces: 6`, and using one sweeps the Ace tally. An item
     * without the field pays nothing extra; an item whose holder can't
     * cover the amount gets a disabled trigger, exactly like the main
     * cost (rule 1: unaffordable is disabled, never clamped — and the
     * table can still spend the counters by hand if it rules
     * otherwise). Declared as field + counter so nothing here is a
     * game word, and the amount stays on the item where a person can
     * type over it.
     */
    costs?: { field: string; counter: string }[];
    /**
     * The system's per-turn priced moves — WiW's Aim: 1 Grit, reroll
     * one die, once per turn. GLOBAL, not per-item (Aim is an Action
     * like Move or Dodge); the seat renders each as an armable control
     * whose cost rides on the next use of anything (deduct-at-fire).
     * The name and reminder text are the system's own words and live
     * here as data (rule 4). The once-per-turn lock releases when the
     * cost counter refills — derived, not scheduled — and the spend
     * itself is ordinary counter arithmetic the table can reverse.
     */
    actions?: { name: string; cost: number; text?: string }[];
  };
  /**
   * How BUYING works in this system, when it has a store at all.
   *
   * Same bargain as `use`: teller ships the arithmetic (cart totals, a
   * wallet debit) and never the words. The system says which counter is
   * money and which item kinds are consumed on the spot — a meal, a
   * night's lodging, a train ticket — rather than landing in inventory.
   * Code that branched on `kind === 'service'` would be a game concept
   * wearing a string (rule 2); this declaration is the sanctioned form.
   *
   * A system that declares nothing has no store mode, and loses nothing
   * else.
   */
  store?: {
    /**
     * The single counter a purchase debits — for a system whose money
     * is one number. A system that declares `currency` instead pays
     * from the purse and leaves this out.
     */
    counter?: string;
    /** The item field holding a price — 'cost'. Same bargain as `use.costField`. */
    costField: string;
    /** Item kinds consumed at the counter, never added to inventory. */
    consumes?: string[];
  };
  /**
   * The ladder a well-used thing can climb, as data.
   *
   * WiW already prints one — Used, Basic, Premium, Elite, described as
   * quality AND rarity — and every catalogue entry carries it in the
   * same `quality` field the store filters on. So this isn't a new axis
   * bolted on; it's the existing ladder climbed instead of purchased.
   * Which leaves both roads open, and they stay distinguishable
   * without any code trying: a bought Elite has no marks, an earned one
   * has thirty. Nothing enforces that. It just falls out.
   *
   * Mechanics as data (rule 4), so a second system gets this by adding
   * a row rather than by anyone touching TypeScript. No counter is
   * named here because there is no counter — the tally is `marks.length`
   * and the thresholds are cumulative, so nothing resets and the
   * history is never broken to make the arithmetic easier.
   *
   * Rising is a PROPOSAL and nothing here fires on its own: crossing a
   * threshold makes the console offer, and the DM rules (rule 1). A
   * step's `at` is a number teller shows a human, never one it acts on.
   */
  growth?: {
    /** The field a rise writes — the same key the store reads for tiers. */
    field: string;
    /** The rungs in order, each naming what it writes and what it costs. */
    steps: { to: string; at: number }[];
    /**
     * What one mark is called in this system's voice — 'notch'. The
     * vocabulary is the template's, never teller's (rule 4).
     */
    noun?: string;
    /**
     * Which item KINDS can be notched at all — `['weapon']`.
     *
     * Declared rather than assumed, because the alternative is code
     * saying `kind === 'weapon'`, which is the rule 2 trap exactly:
     * teller would have learned a game word. Matching against a kind
     * the TEMPLATE names is the sanctioned pattern, the same one
     * `use.consumesKind` and `store.consumes` use.
     *
     * Absent means every kind, which is the general primitive — marks
     * are "things that happened to this thing" and a system where a
     * horse or a coat earns them is a system that says nothing here.
     * WiW says weapons, because offering to notch a jar of Pain Pills
     * put the control on all ninety things in a pack.
     */
    kinds?: string[];
    /**
     * Tiers a vendor's derived stock leaves out, so the top of the
     * ladder isn't simply for sale by default.
     *
     * An exclusion, never a prohibition: a DM who wants the legendary
     * rifle in a locked case behind the counter puts it in a curated
     * vendor's stock and it appears. Forbidding that would be rule 1
     * backwards, and an absurd price is a better gate than a missing
     * listing — a posse CAN pool everything for it and then go hungry,
     * which is a story teller should let them have.
     */
    unstocked?: string[];
  };
  /**
   * Physical money: which counters are the coins and notes, and what
   * each is worth in minor units — Dollars 100, Quarters 25, Dimes 10.
   *
   * Rule 2 doing what it always does: a denomination is an ORDINARY
   * counter (a count of physical objects in a pouch), and this
   * declaration is how they compose into a total. The pocket shows the
   * purse as one chip that opens into the coin counts; the store pays
   * out of it like a shopkeeper — largest first, change back — and
   * every count stays a stored value a person can type over (rule 1).
   *
   * Declared alongside `store` but independent of it: wages arrive in
   * coin whether or not anyone opens a shop.
   */
  currency?: {
    /** Counter name → its value in minor units, any order. */
    denominations: { counter: string; value: number }[];
    /** The mark totals wear — '$'. */
    symbol?: string;
  };
  /**
   * How the sheet splits what a character CARRIES into screens.
   *
   * WiW's printed page gives Weapons and Abilities separate real
   * estate, and 515px of rail can't hold both anyway — so the split is
   * declared, by item kind, the same way `use.consumesKind` already
   * names one kind without teller learning the word:
   *
   *   screens: [
   *     { name: 'Weapons',   kinds: ['weapon', 'ammo'] },
   *     { name: 'Abilities', kinds: ['ability'], counters: ['Aces'] },
   *   ]
   *
   * `counters` names character counters shown as panels on that screen
   * — WiW's Ace-in-the-Hole tally lives beside the abilities it
   * unlocks. A named counter the character doesn't have simply doesn't
   * render (declares nothing, loses nothing).
   *
   * Items whose kind no screen claims land on the FIRST screen rather
   * than vanishing — nothing a person carries may disappear over a
   * missing declaration. Undeclared entirely = one items screen,
   * exactly as before.
   *
   * `arms` marks the screen where the system's priced actions live:
   * its item panels get the chamber select and the per-turn reticles
   * (Aim). It used to be derived — "the screen holding the consumable
   * kind" — which broke the day the ammo pools moved to their own
   * screen: what a weapon LOADS is a character-level pool wherever its
   * items are displayed, so the join had to be declared.
   *
   * `rest` marks the catch-all: an item whose kind no screen claims
   * lands here instead of on the first screen. Declared so a new kind
   * (gear, traps) joins the junk drawer rather than the gun rack. At
   * most one screen should carry it; without one, the first screen
   * keeps the job, exactly as before.
   */
  screens?: {
    name: string;
    /**
     * The mark this screen wears on the bar — a glyph name, assigned the
     * same way `icons` assigns one to a counter. Off mounted glass the
     * bar has no room for five words, so it shows marks and names only
     * the screen you're on.
     */
    icon?: string;
    kinds: string[];
    counters?: string[];
    arms?: boolean;
    rest?: boolean;
  }[];
  /**
   * Tag-driven category marks — WiW's Talents.
   *
   * A tag of `${prefix}${category}` fills the ✶ box on whatever matches
   * the category: a skill row whose LABEL matches ("Talent: Nerve"), or
   * an item panel whose catalogue GROUP matches ("Talent: Rifles" on
   * every carried rifle). The printed sheet's spur-and-box beside each
   * skill track and each weapon's Model line is exactly this marker —
   * settled 2026-08-11, after it was twice misread as Aim.
   *
   * Display only, deliberately: what the mark DOES (WiW: reroll Spurs
   * on that category's rolls) happens in the player's hand with real
   * dice. teller shows that it's true; the tag is the stored fact, and
   * tags are editable everywhere (rule 1). `text` is the reminder shown
   * on the marker.
   */
  marks?: {
    prefix: string;
    text?: string;
    /** The roster panel's own heading — "Talents". */
    label?: string;
    /**
     * Every category the system sells, so the roster can show what's
     * NOT owned too. A mark tag outside this list still renders —
     * homebrew categories don't disappear for want of a declaration.
     */
    categories?: string[];
  };
  /**
   * The system's progression purchases — WiW's Prestige spend menu.
   *
   * Each entry is a PROPOSING macro (rule 1): one tap debits `counter`
   * and applies `effect` as ordinary field/counter/tag/item writes in a
   * single PATCH — one event, one /undo, every result landing in a slot
   * a person can type over. The fire button proved the shape; these are
   * its bigger siblings. Nothing here ENFORCES the menu: an
   * unaffordable purchase is disabled, never clamped, and the steppers
   * remain the override. A limit the book states ("up to 5 times")
   * lives in `text` as a reminder — counting past purchases would be
   * bookkeeping nobody can see or correct.
   *
   * `tiers` are display-only milestones derived from `total` — never
   * stored, so they can never go stale (the `bundleKind` lesson).
   */
  /**
   * Ordered standing scales — WiW's Reputation ladder, one field per
   * faction. A ladder names its steps and (optionally) the pack section
   * whose entry names are the ROSTER: the parties a standing can be
   * held with are world content, so they live in a pack, never here
   * (rule 4) — a section title is the join, the same way `note` and
   * `lookup` already find pack prose by name.
   *
   * A standing is an ordinary FIELD: key `${prefix}${slug(name)}`,
   * label the party's name, value a step's label — no new type, and
   * editable anywhere fields are edited (rule 1). Nothing is stored
   * until a standing moves off `defaultStep` ("everyone starts
   * Neutral"), and a stored field whose name the roster doesn't know
   * still renders — the strays promise again. A step's `mod` is shown,
   * never applied: the dice it modifies are in the player's hand.
   *
   * An array because the shape recurs — the book runs horse bonds on
   * the same five steps, which will be a second entry with its own
   * prefix, not a special case.
   */
  ladders?: {
    /** Field-key namespace — 'rep_'. Identifies which fields ride this. */
    prefix: string;
    /** The panel's heading — "Reputation". */
    label: string;
    /** Pack section whose entry names seed the roster. */
    section?: string;
    /** Reminder shown on the panel — what a standing does, in brief. */
    text?: string;
    /** The rungs, in order. `mod` is display only. */
    steps: { label: string; mod?: string }[];
    /** The step everyone starts on. Unstored = this. */
    defaultStep?: string;
  }[];
  spends?: {
    /** The counter every purchase debits — 'Prestige · Unclaimed'. */
    counter: string;
    /** The lifetime counter that measures progression, for tiers. */
    total?: string;
    /**
     * Spending CLAIMS the points: a purchase credits `total` by the
     * same amount it debits `counter`, so an award only ever touches
     * the one box and the lifetime figure keeps itself (earned is
     * always total + unclaimed). Left off for a system whose total is
     * bumped at award time — crediting it again on spend would count
     * every point twice. Brian's table runs WiW claimed (2026-08-11).
     */
    claims?: boolean;
    /** The panel's heading — "Prestige". */
    label?: string;
    /** Milestone titles, by `total` threshold, ascending. */
    tiers?: { name: string; at: number }[];
    menu: {
      name: string;
      cost: number;
      /** Mechanic reminder, incl. any book limit — shown, not enforced. */
      text?: string;
      /** What one purchase writes. Absent = debit only. */
      effect?: SpendEffect;
    }[];
  };
};

/**
 * What a progression purchase DOES, as data — the same discipline as
 * `PoolEffect`: four operations cover WiW's whole menu, and each names
 * its target by declaration rather than by a word in code (rule 2).
 *
 *   * `pool` — amend a die-pool FIELD the player chooses from a declared
 *     group (`groups.skills`), with the same add/convert vocabulary
 *     upgrades already use. Practice Skill converts, Master Skill adds.
 *   * `max` — raise a counter's ceiling (Improve Health).
 *   * `mark` — grant a `marks` category the player chooses (Develop
 *     Talent); writes the same tag the roster panel toggles.
 *   * `item` — add a catalogue entry of the named kind the player
 *     chooses (Unlock Ability); the same reference-copy a picker makes.
 */
export type SpendEffect =
  | { kind: 'pool'; group: string; op: 'add'; dice: string }
  | { kind: 'pool'; group: string; op: 'convert'; from: string; to: string; count: number }
  | { kind: 'max'; counter: string; amount: number }
  | { kind: 'mark' }
  | { kind: 'item'; itemKind: string };

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
/**
 * A pack's own claim about what it carries and where it may go.
 *
 * Deliberately three words and two strings rather than a licence
 * model: teller is not a rights registry and the moment this grows a
 * schema someone will expect it to be enforced. See `RulesPack.rights`.
 */
export type PackRights = {
  /** The author's claim. Absent is read as `personal`. */
  status: 'homebrew' | 'personal' | 'licensed';
  /**
   * Whose IP, in plain words — "Boylei Hobby Time". Attribution, and
   * the thing a console shows when it says where a foe came from.
   * Meaningless on `homebrew` unless the author wants a byline.
   */
  holder?: string;
  /**
   * On what basis it may travel, for `licensed` — a sentence, a licence
   * name, a URL. Prose on purpose: the range of real answers here is
   * wider than any enum would survive.
   */
  terms?: string;
};

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
   * Who this pack's contents belong to, and who may hand the file on.
   *
   * A pack MAY contain IP — that's rule 4 as rewritten 2026-08-14, and
   * it's the whole point of the format: the only place publisher text
   * may never live is this repo. What that leaves is a real question
   * the file has to answer for itself, because it outlives the
   * conversation in which someone knew: **is this mine to share?**
   *
   * Three answers, and no fourth:
   * - `homebrew` — the author's own work. Theirs to hand out freely.
   * - `personal` — holds someone else's IP, kept for the author's own
   *   table. Never distributed. (Every pack built from a book you own
   *   starts here, and most stay here forever.)
   * - `licensed` — holds someone else's IP AND is sanctioned to travel,
   *   by the rightsholder or someone they authorised. `holder` says
   *   whose, `terms` says on what basis.
   *
   * Absent means UNKNOWN, and unknown is treated as `personal` —
   * the safe reading for the thousands of packs that predate this
   * field, and for anything a stranger hands you.
   *
   * **This is an assertion, never a verification.** teller cannot check
   * whether a claim is true and must never render one as though it had.
   * Say "the author says", or say nothing.
   *
   * It also gates NOTHING at the table. A pack with no rights at all
   * still resolves, still deploys foes, still prints its pages — same
   * bargain `books` makes: the reference identifies, it never
   * authorises, and a host with one pack never makes anyone tick a box.
   */
  rights?: PackRights;
  /**
   * Panel heading → the line the printed sheet sets beneath it.
   *
   * The character sheet captions every block — "practice & master with
   * Prestige" under SKILLS, "relieved by rolling with the associated
   * Skill" under STATUSES. They are genuinely useful (each one answers
   * the question the panel raises) and they are just as genuinely the
   * publisher's prose, so they cannot ship in this repo (rule 4). This
   * is the skin layer TEL-63 describes, and it is why `SheetPanel` has
   * always taken a `note` it had no way to fill.
   *
   * Keyed by the heading the panel already displays, so nothing has to
   * agree on a separate vocabulary of panel ids: a caption is offered to
   * whatever block calls itself that. Later packs win, matching how
   * every other pack collision resolves. No entry, no caption, and the
   * panel is exactly as it was.
   */
  notes?: Record<string, string>;
  /**
   * The things this system's books describe, and what modifying them
   * does — a catalogue a character points AT instead of copying.
   *
   * Publisher content (names, stats, prices), so it lives here and only
   * here: packs are per-instance and gitignored, and the repo never
   * carries a weapon table (rule 4). What the repo ships is the
   * evaluator in `worker/items.ts`, because mechanics are fair game in
   * code and a new system should arrive as pack DATA rather than a code
   * change — the same bargain `dice` already made.
   */
  catalog?: {
    /** Things a character can carry. */
    items?: CatalogItem[];
    /** Modifications those things can take. */
    upgrades?: CatalogUpgrade[];
  };
  /**
   * The bestiary this pack brings. Having the pack means having the
   * foes, the way having the book on a shelf does — instead of every
   * new campaign starting empty.
   */
  npcs?: NpcBlueprint[];
  /**
   * The system's playable trades/classes, as starting kits (TEL-75).
   *
   * Structure that references the catalogue rather than carrying it: a
   * trade names its starting skill pools and points at its ability
   * entries by id. Creation composes a character FROM one of these —
   * template kit + trade kit + picks — and the result is an ordinary,
   * fully editable character (rule 1). The trade's prose stays in the
   * book; `tagline` is the book's two-word category header, and the
   * skills map is keyed by whatever field labels this system's sheet
   * already uses (rule 2: no field name is known here).
   */
  trades?: {
    id: string;
    name: string;
    /** The book's category header for the trade ("Healing & Support"). */
    tagline?: string;
    /** The trade's one-line introduction — pack prose for the card. */
    text?: string;
    /** The fuller portrait, for the card expanded — pack prose. */
    overview?: string;
    /**
     * The trade's illustration: a KEY into the shared image store
     * (served at `/api/maps/<key>`, `~/.teller/<key>` on a host — art
     * lives beside books, per-instance, never in a repo or a bundle).
     * Absent, the card simply has no picture.
     */
    art?: string;
    page?: number;
    /** Field label → starting dice pool ("Charm" → "3B"). */
    skills?: Record<string, string>;
    /** Catalog item ids (kind 'ability') this trade may pick from. */
    abilities?: string[];
    /** The trade's Ace-in-the-Hole pair, unlocked in order. */
    aceInTheHole?: string[];
  }[];
  /**
   * How this system starts a character, as data the creation flow reads.
   *
   * `start` counts how many picks a new character makes from the
   * trade's lists; `tiers` is the starting-loadout table (WiW p. 33) —
   * each row proposes counters and gear budget for a posse starting at
   * that Prestige. All of it seeds ordinary editable state; none of it
   * is enforced after creation.
   */
  creation?: {
    page?: number;
    /**
     * The screen that greets someone before the first question — a
     * welcome to the game rather than an instruction (Brian, after
     * running the builder with his dad, 2026-08-14).
     */
    welcome?: {
      title?: string;
      body: string;
      /**
       * The game's own wordmark over the greeting — a key into the
       * host's image store, exactly as `trades[].art` works. The
       * publisher's artwork lives beside their book, per-instance, and
       * never in this repo (rule 4).
       */
      art?: string;
    };
    /**
     * What each step SAYS before it asks anything, keyed by step.
     *
     * A first-timer arrives at "Spread yer skills" already looking at a
     * grid of tracks with dice in them, and nothing has said that the
     * dice are pre-dealt, that they're his to move, or that there's a
     * budget. The preface says it, once, and the header's ? brings it
     * back for whichever step you're on.
     *
     * PROSE only, and nothing that repeats a number teller can derive
     * — the builder already computes the budget, the pack count and
     * the wallet roll for its captions, and it renders those alongside
     * this. A paragraph that restated them would be a second copy to
     * keep in step with the first.
     *
     * It's data because it's this system's voice (rule 4). Absent for a
     * step means that step opens straight into itself and wears no ?.
     */
    prefaces?: Record<string, string>;
    /**
     * How many of each list a new character STARTS with — the first N
     * in declared order, preset, never picked (WiW's sheet stamps a
     * Prestige cost on every slot but the first; choosing is what
     * spending Prestige is for, and the spend menu prices it).
     */
    start?: { abilities?: number; aceInTheHole?: number };
    /**
     * The skill-assignment budget, when this system deals dice out:
     * `total` dice of face `die` across the sheet's skill fields,
     * `min`–`max` per skill. The trade's own spread is the suggested
     * quick build; this is what makes it editable at creation.
     */
    skills?: { total: number; min: number; max: number; die: string };
    /**
     * Where the tier numbers LAND — creation-schema key → this system's
     * own field/counter names. Teller never knows a counter is called
     * "Wallet ($)" (rule 2); the pack says so. `prestige` may name
     * several counters that all receive the tier's value.
     */
    map?: {
      trade?: string;
      prestige?: string | string[];
      wallet?: string | string[];
      scrap?: string | string[];
    };
    /**
     * The starting-money roll, when this system rolls it: dice in the
     * template's own pool notation, and what each face is worth. The
     * player rolls PHYSICAL dice and taps the result — teller does the
     * arithmetic, exactly like the initiative roll.
     */
    wallet?: { roll: string; values: Record<string, number>; page?: number };
    /** Catalog ids every new character starts armed with (lowest tier). */
    weapons?: string[];
    /** Catalog ids of the starting bundles; a tier says how many to pick. */
    equipmentPacks?: string[];
    /**
     * Small mementos to pick from — flavor the sheet carries as a note.
     *
     * A bare string is the memento itself. The object form lets the pack
     * hand it a mark from teller's glyph set, the same bargain
     * `CatalogItem.icon` strikes: we draw, the content assigns. Both
     * forms are accepted forever — a pack that never wants pictures
     * shouldn't have to wrap every line in an object to say so.
     */
    keepsakes?: (string | { text: string; icon?: string })[];
    /**
     * Art for the system's marks, by the system's own name for them —
     * a die ("B"), a face ("hit"), or "die" for an empty slot.
     *
     * The other half of the icons bargain. `SystemTemplate.icons` says
     * WHICH of teller's glyphs a name wears, and that stays the default;
     * this says the pack has the real thing and teller should use it
     * instead. Same reason `trades[].art` exists: a book's own marks
     * beat a drawn approximation of them, and like every other piece of
     * a publisher's artwork they live on the host and are referenced by
     * key — never in this repo (rule 4).
     *
     * Rendered as a MASK filled with the current colour, so art keeps
     * the tinting the drawn glyphs have: lit in the trade's accent when
     * spent, dark when not.
     */
    marks?: Record<string, string>;
    /**
     * The naming well: draw a random first + last for the "gimme a
     * name" button. Personalities/features ride along for NPC sparks.
     */
    names?: {
      page?: number;
      first?: string[];
      last?: string[];
      personalities?: string[];
      features?: string[];
    };
    /** Reflection prompts surfaced beside the prose panels, once. */
    questions?: string[];
    tiers?: {
      name: string;
      prestige: number;
      /** Gear quality by slot — the words are the system's, not teller's. */
      ranged?: string;
      melee?: string;
      scrap?: number;
      wallet?: number;
      /** How many equipment packs this tier picks. */
      packs?: number;
      items?: number;
    }[];
  };
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
  /**
   * seat: render as some OTHER glass — an iPad pretending to be the
   * rail bar, while the hardware decision is still open.
   *
   * Console-set, like everything else about a screen. Opaque here;
   * `SEAT_SIZES` in `src/components/SizeFrame.tsx` owns the vocabulary
   * and an unknown value renders the actual window (never blanks).
   * If the screen has a calibrated `ppi`, the forced glass renders at
   * its true physical size on that screen; otherwise it scales to fit.
   */
  glass?: string | null;
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

/** One line of a cart: which catalogue entry, and how many. */
export type CartLine = { ref: string; qty: number };

/**
 * What Teller proposes for one foe's turn (TEL-86). Words on the
 * console, nothing else — the assistant returns this and writes
 * nothing; playing any of it is the Warden's act, not teller's.
 *
 * `premises` is the honesty mechanism: virtual tokens are only as
 * fresh as the last drag (minis are physical — the thesis), so every
 * assumption the suggestion leans on is surfaced for the Warden to
 * check at a glance rather than discovered mid-turn.
 */
export type TurnSuggestion = {
  premises: string[];
  action: string;
  rationale: string;
  /**
   * The roll the suggested action calls for, when it calls for one —
   * the exact pool printed on the foe ("2G", "3B3G") and what it's
   * for. The card renders it as real tappable dice (the template's
   * `dice` faces), the table rolls the PHYSICAL ones, and the taps
   * record what the plastic said. teller never rolls here.
   */
  roll?: { dice: string; for: string };
  /** Which model spoke — provenance on the card, not a warranty. */
  model: string;
};

/**
 * The second half of a suggested turn (TEL-86, Brian's two-step): the
 * Warden ran the action with REAL dice, typed what the table rolled,
 * and Teller dresses the already-decided facts as words to read aloud.
 * The dice stay physical and the model narrates, never rolls — the
 * thesis, applied to prose.
 */
export type TurnNarration = {
  narration: string;
  model: string;
};

/**
 * The shop that's OPEN, and every cart in it. Live state that more than
 * one screen argues about (a seat fills the cart, the console rules on
 * it), so it lives here with initiative rather than in the campaign
 * blob — and like initiative it's ephemeral: closing the shop clears
 * it, and nothing here is a purchase. The purchase is the DM's confirm,
 * which lands as one ordinary character PATCH — event-logged, undoable,
 * every number a person can type over (rule 1).
 */
export type StoreSession = {
  vendorId: string;
  /** characterId → what they've gathered. */
  carts: Record<string, CartLine[]>;
  /** characterId → the cart is on the counter, awaiting the DM. */
  offered: Record<string, boolean>;
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
  /** The open shop, or null. See `StoreSession`. */
  store?: StoreSession | null;
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
  | { op: 'notice'; text: string | null }
  /** Open a vendor for the table, or close the shop (null). DM's call. */
  | { op: 'shop'; vendorId: string | null }
  /** One seat's cart, replaced whole — same shape `set` uses for the order. */
  | { op: 'cart'; characterId: string; lines: CartLine[] }
  /** Put the cart on the counter (or take it back). */
  | { op: 'offer'; characterId: string; on: boolean };

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
     *
     * `down` is "at zero", not "dead": what zero MEANS is the table's
     * ruling, not teller's (see `vitalityOf`). It floats a foe to the
     * top of the notch panel; it never decides anything.
     */
    vitality?: 'healthy' | 'bloodied' | 'critical' | 'down';
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
  /**
   * The one screen this pattern is addressed to — a seat being
   * calibrated so an assigned pretend-glass can render at true size.
   * Absent means the table, as it always did. The event still rides
   * the campaign broadcast; screens simply ignore mail that isn't
   * theirs, the same way identify works.
   */
  displayId?: string;
};

/**
 * The overhead camera's transient overlay for the table screen — the
 * corner fiducials it solves against, and a confirmation ring under
 * every position it believes a physical mini occupies (BATTLEMAP.md's
 * "someday", TEL-77's now). Same contract as `Calibration`: never
 * stored, never in a snapshot, arrives over SSE and leaves the same
 * way — and the table clears it by itself when the stream goes quiet,
 * so a dead camera daemon can't leave stale rings on the glass.
 *
 * `rings` are in the table's own viewport px: the camera solved
 * against markers this screen drew, so its coordinates ARE this
 * screen's. Mapping observations into MAP space (u,v — where token
 * proposals live) is the next stage, not this one.
 */
export type CameraOverlay = {
  /** Draw the corner fiducials so the camera can keep solving. */
  markers: boolean;
  /** Believed object positions, viewport px of this screen. */
  rings: [number, number][];
};

export type StreamEvent = (
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
  /** Table screens: the camera's overlay, or null to clear it. */
  | { type: 'camera'; camera: CameraOverlay | null }
  /**
   * A display's record changed — calibration written (by the wizard OR
   * the camera's inch card), a rename, a recolor. Untargeted: consoles
   * refresh what they know about the room's screens, so the workshop's
   * frame preview tracks a calibration the console didn't perform.
   */
  | { type: 'display'; displayId: string }
  | { type: 'ping' }
) & {
  /**
   * Who a targeted event was aimed at — present only on a SHARED
   * socket (`display=*`), where one connection carries every screen's
   * mail and each tab keeps what names its own handle (rule 6: one
   * browser, many tabs, one of the six connections). A dedicated
   * socket receives only its own mail and needs no addressing. The
   * tag is a handle: it identifies a screen, it grants nothing.
   */
  to?: string;
};

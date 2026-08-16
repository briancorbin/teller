// Teller, the assistant — the first slice (TEL-85/86).
//
// This file is deliberately boring, and that's the finding: an
// "assistant" is not a trained thing, it's context assembly in front
// of a rented, stateless model. Every request re-reads the campaign
// fresh; the board and the rows ARE the memory. Nothing about a table
// ever lives in the model.
//
// The provider is a CONFIG VALUE, not a dependency (the never-captive
// half of rule 7's bargain): endpoint + key + model, speaking either
// the Anthropic Messages shape or the OpenAI chat shape, which between
// them cover Anthropic, OpenAI, ollama on localhost, and eventually
// teller.ink's own proxy — the paid tier is a PRESET of this config,
// never a different code path.
//
// And rule 1 before anything else: this module returns words. It holds
// no reference to the database, takes state as arguments, and cannot
// write — a suggestion lands on the console as a card the Warden reads,
// edits, or waves away. teller never runs a turn.

import type {
  Campaign,
  Character,
  Spend,
  Scene,
  SessionState,
  ResolvedTurn,
  SystemTemplate,
  TokenMove,
  TurnNarration,
  TurnSuggestion,
} from './types';
// Pure parsing over the pack's own printed text — no runtime deps, so
// it reads the same in a Worker as it does in the browser.
import { namedBlocks, parseAttacks } from '../src/lib/statblock';
// A condition reaches the model as the words it would be spoken as —
// "Trapped 4", not an object. The measured number is the whole point
// of passing it at all.
import { formatTag } from './tags';

export type AssistantEnv = {
  /** Endpoint. Absent = Anthropic's. An ollama or teller.ink URL works the same. */
  ASSISTANT_URL?: string;
  /** API key. Optional because a localhost model doesn't need one. */
  ASSISTANT_KEY?: string;
  /** Model id — required; there is no sensible default across providers. */
  ASSISTANT_MODEL?: string;
  /** Wire shape: 'anthropic' (default) or 'openai' (ollama, OpenAI, …). */
  ASSISTANT_STYLE?: string;
};

/** Configured means "a model is reachable": a key for a hosted one, or a URL to a local one. */
export function assistantConfigured(env: AssistantEnv): boolean {
  return Boolean(env.ASSISTANT_MODEL && (env.ASSISTANT_KEY || env.ASSISTANT_URL));
}

/** What the console may know: whether the button exists, and what answers it. */
export function assistantInfo(env: AssistantEnv): { configured: boolean; model?: string } {
  return assistantConfigured(env)
    ? { configured: true, model: env.ASSISTANT_MODEL }
    : { configured: false };
}

// ---------------------------------------------------------------------------
// Context assembly — the actual work.
//
// Everything here is a READ of state other code already maintains, and
// the two boundaries are enforced by what is simply never assembled:
//
//   * hidden MARKERS and unrevealed zones stay out, not because a
//     player might see the suggestion (they can't; console-only) but
//     because the FOE hasn't seen them — a suggestion that routes a
//     bandit around a trap it doesn't know about spoils the trap.
//     Hidden FOE tokens are the opposite case (Brian, 2026-08-15: "the
//     3 bark watchers start hidden in the trees"): monsters that set
//     an ambush together know where each other lie, and above all a
//     creature knows that IT is hidden — its stealth is usually its
//     whole opening move. So the acting foe always sees itself and its
//     fellow foes, hidden ones marked as unseen-by-the-posse.
//   * PC numbers stay out. The foe sees what the table sees: who looks
//     hurt (vitality — the same word /public uses), never a hit-point
//     total. What a monster knows and what a badge shows turn out to be
//     the same boundary.

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What a measurement IS, in the system's own words.
 *
 * Table inches are teller's unit and nobody's world — a Warden reading
 * "glides 2+ inches" is being told about the tabletop, not the lake.
 * The band table is data on the system (rule 4), so this names a gap
 * without knowing a thing about any particular game, and says nothing
 * at all for a system that declares no bands.
 */
function bandOf(
  inches: number,
  bands: SystemTemplate['bands'],
): { name: string; world?: string } | undefined {
  for (const b of bands ?? []) {
    if (inches >= (b.from ?? 0) && (b.to === undefined || inches < b.to)) return b;
  }
  return undefined;
}

/** Qualitative wound state — the /public derivation, reused on purpose. */
function vitalityOf(character: Character): string {
  const vital = character.data.counters.find((c) => c.max !== null && c.max > 0);
  if (!vital) return 'unknown';
  if (vital.current <= 0) return 'down';
  const ratio = vital.current / vital.max!;
  return ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'bloodied' : 'healthy';
}

/**
 * What this combatant is visibly protected by (Brian, 2026-08-15).
 *
 * Defense in this system is ROLLED, not owned: it's a bundle of Dodge,
 * Cover and gear, and a person has no innate Defense at all. So the
 * honest thing to hand the model is not a number — it's what a foe
 * across the clearing could SEE. Plate is visible. A shield is visible.
 * Bracing is visible, and rides in as a condition tag already.
 *
 * The rest stays out, and for the same reason PC hit points do: the
 * /public boundary. How much Grit someone has left to buy Dodge dice
 * with is the player's own resource, not something the creature about
 * to bite them can read. That keeps the line in one place — a foe sees
 * the armor, never the arithmetic.
 *
 * The PAYOFF is the narration: knowing Barrett is in steel is what
 * lets a resolved 2-of-4 read as the shot ringing off his plate,
 * instead of the flat "he defends".
 */
function defensesOf(character: Character): string[] {
  const worn: string[] = [];
  for (const item of character.data.items ?? []) {
    const fields = item.fields ?? [];
    const cover = fields.find((f) => /^cover$/i.test(f.key))?.value;
    const armor = fields.find((f) => /^defen[cs]e$/i.test(f.key))?.value;
    if (cover) worn.push(`${item.name} (${cover})`);
    else if (armor) worn.push(item.name);
  }
  // A creature with a printed Defense pool of its own says so plainly;
  // people usually have none, and an empty field means exactly that.
  const printed = character.data.fields.find((f) => /^defen[cs]e$/i.test(f.key))?.value;
  if (printed && character.kind !== 'pc') worn.push(`printed Defense ${printed}`);
  return worn;
}

/** The profile, wherever the DM happened to write it (TEL-86: fields, zero schema). */
function profileOf(character: Character): string | undefined {
  const field = character.data.fields.find((f) =>
    /profile|behavio|tactic|demeanor/i.test(`${f.key} ${f.label}`),
  );
  return field?.value || undefined;
}

/**
 * A threshold printed into a block's own name — "Lake Sludge (18
 * Health)" — read against the creature's counter.
 *
 * Not a rules engine: it reads the AUTHOR's notation and says whether
 * the number is reached, which is a comparison teller can make and the
 * model should not have to. What the ability then does is the block's
 * own words and the Warden's call.
 */
function thresholdOf(
  name: string,
  counters: Character['data']['counters'],
): string | undefined {
  const m = /\((\d+)\s+([A-Za-z][A-Za-z ]*)\)/.exec(name);
  if (!m) return undefined;
  const at = Number(m[1]);
  const counter = counters.find((c) => c.name.toLowerCase() === m[2].trim().toLowerCase());
  if (!counter) return undefined;
  return counter.current <= at
    ? `THRESHOLD MET — ${counter.name} ${counter.current}, at or under ${at}`
    : `not yet — ${counter.name} ${counter.current}, needs ${at} or less`;
}

/**
 * The foe, in blocks a reader can find things in.
 *
 * This used to join every field with ` · ` into one run. Field values
 * carry their own newlines, so the separator interleaved with them and
 * produced genuine nonsense — an attack line welded onto the next
 * field's label ("Long — Screech (AOE) (4 Grit): Dazed [2B] · Features:
 * Perfect Camouflage"), and a creature's signature move buried at the
 * tail of an 881-character line that opened with a paragraph about
 * dehydration.
 *
 * It cost a real play (2026-08-15): the Pondweed Peril dropped below
 * its Frenzy threshold for the first time, had the Grit for it, and
 * would have caught four of the posse in mud — and instead proposed
 * the same Strangle for the third round running. The text was in the
 * prompt the whole time. Presence is not salience.
 */
function describeFoe(foe: Character): string {
  const lines = [`FOE: ${foe.name}`];
  for (const c of foe.data.counters) {
    lines.push(`${c.name}: ${c.current}${c.max !== null ? `/${c.max}` : ''}`);
  }
  if (foe.data.tags.length)
    lines.push(`conditions: ${foe.data.tags.map(formatTag).join(', ')}`);

  const fields = foe.data.fields.filter((f) => f.value);
  const attacksField = fields.find((f) => /^attacks$/i.test(f.key))?.value;
  // Short single-line values are the stat line and read fine together.
  // Anything with its own newlines never did and never will.
  const short = fields.filter(
    (f) => !/^attacks$/i.test(f.key) && !f.value.includes('\n') && f.value.length <= 80,
  );
  if (short.length) {
    lines.push(`stats: ${short.map((f) => `${f.label}: ${f.value}`).join(' · ')}`);
  }

  if (attacksField) {
    const attacks = parseAttacks(attacksField);
    lines.push(
      'ATTACKS — each is usable ONLY at its own band:',
      ...(attacks.length
        ? attacks.map(
            (a) =>
              `- ${a.band} · ${a.name} · ${a.cost} ${a.costUnit} · ${a.effect}`,
          )
        : [attacksField]),
    );
  }

  // Everything long gets its own heading and one line per named block,
  // so a feature is a thing you can point at rather than a clause.
  for (const f of fields) {
    if (/^attacks$/i.test(f.key)) continue;
    if (short.includes(f)) continue;
    lines.push(`${f.label.toUpperCase()}:`);
    for (const b of namedBlocks(f.value)) {
      const gate = b.name ? thresholdOf(b.name, foe.data.counters) : undefined;
      lines.push(`- ${b.name ? `${b.name}. ` : ''}${b.text}${gate ? `  [${gate}]` : ''}`);
    }
  }

  const items = foe.data.items ?? [];
  if (items.length) lines.push(`carrying: ${items.map((i) => i.name).join(', ')}`);
  if (foe.data.notes) lines.push(`the Warden's notes on it: ${foe.data.notes}`);
  return lines.join('\n');
}

function describeBoard(
  scene: Scene | undefined,
  characters: Character[],
  foeId: string,
  /**
   * The map's true height in inches — width × the image's aspect,
   * which only the caller can know (the image lives in the object
   * store; this module takes state as arguments and reads nothing).
   * A token's v spans the HEIGHT: computing y as v×width overstated
   * every vertical position by the aspect ratio, which put the Bark
   * Watchers off the bottom of their own map.
   */
  heightInches?: number,
  bands?: SystemTemplate['bands'],
): string {
  if (!scene) return 'BOARD: no active scene — positions unknown.';
  const width = scene.widthInches;
  const tall = heightInches ?? width;
  // Coordinates stay, because flanking and clustering can't be read
  // off pairwise bands — but they are TELLER'S grid, said so plainly,
  // and never a thing to repeat at a table.
  const unit = width
    ? "teller's own map grid, for working out who is near whom — never say these numbers aloud"
    : 'map fraction 0..1';
  const byId = new Map(characters.map((c) => [c.id, c]));
  const rows = (scene.tokens ?? [])
    // What the foes haven't seen doesn't exist for them; what they SET
    // UP together, they all know. A hidden foe token is the second
    // kind — and the acting foe always sees itself. See header.
    .filter((t) => {
      if (!t.hidden) return true;
      if (t.characterId === foeId) return true;
      const who = t.characterId ? byId.get(t.characterId) : undefined;
      return who?.kind === 'npc';
    })
  // Ground, with its geometry. A zone's CELLS are what let a token be
  // "standing in water" rather than the board vaguely containing some —
  // the difference between trivia and something a Pondweed Peril can
  // act on. Cells are 1-inch map tiles indexed [col, row]; a token's
  // cell is just its position floored.
  const ground = new Map<string, Set<string>>();
  const paint = (label: string, cells: [number, number][]) => {
    let set = ground.get(label);
    if (!set) ground.set(label, (set = new Set()));
    for (const [col, row] of cells) set.add(`${col},${row}`);
  };
  // Both halves of the ground model land here: TERRAIN (what a tile
  // is — static, data-only, the art is its rendering) and ZONES (what's
  // happening to it — dynamic, drawn on the table). The assistant
  // doesn't care which layer a fact came from; a Pondweed cares that
  // the water is there, not who painted it.
  for (const t of scene.terrain ?? []) paint(t.kind, t.cells);
  for (const z of scene.zones ?? []) {
    if (z.hidden) continue;
    paint(z.effect, z.cells);
  }
  const standing = (u: number, v: number): string => {
    if (!width) return '';
    const col = Math.floor(u * width);
    const row = Math.floor(v * tall!);
    const notes: string[] = [];
    for (const [effect, cells] of ground) {
      if (cells.has(`${col},${row}`)) notes.push(`in ${effect}`);
      else {
        let beside = false;
        for (let dc = -1; dc <= 1 && !beside; dc++)
          for (let dr = -1; dr <= 1 && !beside; dr++)
            if (cells.has(`${col + dc},${row + dr}`)) beside = true;
        if (beside) notes.push(`at the edge of ${effect}`);
      }
    }
    return notes.length ? ` — ${notes.join(', ')}` : '';
  };

  /**
   * What you'd have to get THROUGH to reach someone (Brian,
   * 2026-08-15: "if there's fire between an actor and a target").
   *
   * Standing-in is a fact about a tile; this is a fact about a path,
   * and it's the one that changes a decision — a creature will happily
   * cross open sand and will think twice about six inches of fire.
   * The two cells everyone is standing on are excluded: what's under
   * your own feet is not something you have to cross.
   *
   * Sampled in quarter-inch steps rather than rasterised properly,
   * because this feeds a sentence and not a physics engine, and a
   * quarter of a cell is finer than any ruling it could change.
   */
  const between = (
    a: { u: number; v: number },
    b: { u: number; v: number },
  ): string[] => {
    if (!width) return [];
    const ax = a.u * width;
    const ay = a.v * tall!;
    const bx = b.u * width;
    const by = b.v * tall!;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
    const ends = new Set([
      `${Math.floor(ax)},${Math.floor(ay)}`,
      `${Math.floor(bx)},${Math.floor(by)}`,
    ]);
    const seen = new Set<string>();
    const hit = new Map<string, number>();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const key = `${Math.floor(ax + (bx - ax) * t)},${Math.floor(ay + (by - ay) * t)}`;
      if (ends.has(key) || seen.has(key)) continue;
      seen.add(key);
      for (const [label, cells] of ground) {
        if (cells.has(key)) hit.set(label, (hit.get(label) ?? 0) + 1);
      }
    }
    // Squares of ground, because "2 in. of fire" is a tabletop fact and
    // what the creature sees is a patch of burning ground.
    return [...hit.entries()].map(
      ([label, n]) => `${label} (${n} square${n === 1 ? '' : 's'} of it)`,
    );
  };

  const self2 = rows.find((t) => t.characterId === foeId);
  const rows2 = rows.map((t) => {
      const who = t.characterId ? byId.get(t.characterId) : undefined;
      const x = width ? round2(t.u * width) : round2(t.u);
      const y = width ? round2(t.v * tall!) : round2(t.v);
      const tag = who ? (who.kind === 'pc' ? 'PC' : 'foe') : 'marker';
      const cover = t.hidden
        ? t.characterId === foeId
          ? ' — HIDDEN: the posse cannot see it'
          : ' — hidden, unseen by the posse'
        : '';
      // The DISTANCE, measured rather than inferred.
      //
      // Positions alone made the model derive a gap, map it to a band,
      // then check an attack's band against it — three steps, and it
      // bent the last one: told to avoid a fire it had been handed, it
      // decided a MELEE Strangle could be thrown to Short rather than
      // use the Short attack printed directly beneath it. Geometry is
      // teller's to do. Which band the number falls in stays the
      // system's business (its own `space` prose says), so nothing
      // here learns what "Short" means — no game concepts in code.
      let gap = '';
      if (self2 && t.id !== self2.id && width) {
        const inches = Math.hypot((t.u - self2.u) * width, (t.v - self2.v) * tall!);
        const band = bandOf(inches, bands);
        // The BAND, and nothing else. Handing over the measurement is
        // how "the Peril glides 2+ inches" got said out loud at a
        // table where nothing is measured in inches (Brian): a number
        // in the context is a number in the prose. teller keeps its
        // ruler; the model gets the world.
        gap = band
          ? ` — ${band.name} away${band.world ? ` (${band.world})` : ''}`
          : '';
      }
      return `- ${t.label} (${tag}) at x=${x}, y=${y}${gap}${t.effect ? `, in ${t.effect}` : ''}${standing(t.u, t.v)}${cover}`;
    });
  const zones = [...ground.entries()].map(([effect, cells]) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const key of cells) {
      const [c, r] = key.split(',').map(Number);
      if (c < x0) x0 = c; if (c > x1) x1 = c;
      if (r < y0) y0 = r; if (r > y1) y1 = r;
    }
    return `- ${effect}: ${cells.size} square inches, spanning x=${x0}..${x1 + 1}, y=${y0}..${y1 + 1}`;
  });
  // Only from the acting foe, and only where something is actually in
  // the way — a line per pair would be noise on a busy board.
  const crossings = self2
    ? rows
        .filter((t) => t.id !== self2.id)
        .map((t) => ({ label: t.label, what: between(self2, t) }))
        .filter((c) => c.what.length > 0)
        .map((c) => `- to ${c.label}: ${c.what.join(', ')}`)
    : [];
  return [
    `BOARD (positions in ${unit}; the map is ${width ? `${width} inches wide${heightInches ? ` and ${round2(heightInches)} inches tall` : ''}` : 'uncalibrated'}):`,
    rows2.length ? rows2.join('\n') : '- no tokens placed',
    ...(zones.length ? ['terrain / ground effects:', ...zones] : []),
    ...(crossings.length
      ? ['WHAT LIES BETWEEN YOU AND THEM (straight line, your own tile excluded):', ...crossings]
      : []),
  ].join('\n');
}

/**
 * Combatants in the fight that aren't on the board.
 *
 * `describeBoard` builds the foe's whole picture of the world out of
 * `scene.tokens`, so anyone in the turn order without a token does not
 * exist to it — not as a threat, not as a target, not as a body taking
 * up ground. In play that meant three Bark Watchers spent a round
 * reasoning about a clearing holding two people while five of the
 * posse stood in it, and every suggestion they produced was correctly
 * derived from half a battlefield (2026-08-15).
 *
 * The failure is invisible in the output — nothing about a confident,
 * well-reasoned turn says the board was short. So say the absence out
 * loud: an unknown a human can see beats an unknown that reads as
 * fact, and it stops the model asserting "all are far off" about
 * people it was simply never shown.
 */
function describeUnplaced(
  session: SessionState | null,
  scene: Scene | undefined,
  characters: Character[],
): string {
  const placed = new Set(
    (scene?.tokens ?? []).map((t) => t.characterId).filter(Boolean) as string[],
  );
  const byId = new Map(characters.map((c) => [c.id, c]));
  const missing = (session?.initiative ?? [])
    .filter((e) => e.characterId && !placed.has(e.characterId))
    .map((e) => {
      const who = byId.get(e.characterId!);
      return `${e.label}${who ? ` (${who.kind === 'pc' ? 'PC' : 'foe'})` : ''}`;
    });
  if (!missing.length) return '';
  return [
    'IN THIS FIGHT BUT NOT ON THE MAP — position unknown, not absent:',
    ...missing.map((m) => `- ${m}`),
    'Do not assume these are far off, or that they cannot reach you. If where they stand would change your turn, say so in premises.',
  ].join('\n');
}

/**
 * What happens when a condition lands on somebody who already has it.
 *
 * teller has known this since `SystemTemplate.statuses` existed and
 * was keeping it to itself — so the model guessed, and guessed wrong:
 * asked to renew a grapple it had itself stacked from 1 to 5 the round
 * before, it stated "Strangle renews Trapped rather than stacking it"
 * as a premise (2026-08-15). Exactly the bands lesson again — a fact
 * teller holds and doesn't pass on is a fact the model invents.
 *
 * Said as rules rather than as arithmetic: the number is teller's to
 * work out at resolve time, but whether a second helping is worth
 * anything changes what a creature chooses to do.
 */
function describeStacking(rules: SystemTemplate['statuses']): string {
  if (!rules) return '';
  const how =
    rules.stack === 'sum'
      ? 'A condition applied to someone who already has it ADDS to its severity.'
      : rules.stack === 'replace'
        ? 'A condition applied again REPLACES the severity it had.'
        : 'A condition applied again keeps whichever severity is HIGHER.';
  const cap =
    rules.cap === undefined
      ? ''
      : ` Severity cannot pass ${rules.cap}${
          rules.uncapped?.length
            ? ` — except ${rules.uncapped.join(' and ')}, which has no ceiling`
            : ''
        }.`;
  return `CONDITIONS, WHEN THEY LAND TWICE: ${how}${cap}`;
}

function describeFight(
  session: SessionState | null,
  characters: Character[],
  foeId: string,
): string {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const lines: string[] = [];
  const initiative = session?.initiative ?? [];
  if (initiative.length) {
    lines.push(
      `TURN ORDER (round ${session?.round ?? 1}):`,
      ...initiative.map((e, i) => {
        const who = e.characterId ? byId.get(e.characterId) : undefined;
        const marks = [
          i === session?.turn ? '← acting now' : '',
          e.characterId === foeId ? '(this is the foe being played)' : '',
        ]
          .filter(Boolean)
          .join(' ');
        // The foe sees what the table sees: a state word, never a
        // PC's numbers (the /public boundary, applied to a prompt).
        const state = who ? ` — ${who.kind === 'pc' ? 'PC' : 'foe'}, ${vitalityOf(who)}` : '';
        const tags = who?.data.tags.length
          ? `, ${who.data.tags.map(formatTag).join('/')}`
          : '';
        // Armor and shields are worn in plain sight, so they belong in
        // the same sentence as the wound state — both are what the foe
        // can see, and neither is a number off anyone's sheet.
        const armor = who && defensesOf(who).length ? `, visibly ${defensesOf(who).join(' and ')}` : '';
        return `${i + 1}. ${e.label}${state}${tags}${armor} ${marks}`.trimEnd();
      }),
    );
  } else {
    lines.push('TURN ORDER: none set — combat may not have started.');
  }
  return lines.join('\n');
}

/**
 * What has already happened, attributed.
 *
 * Handed a bare `Trapped 4` on a player and nothing else, the model
 * did the reasonable thing and made up a cause for it, then played the
 * turn off that invention. Conditions are not free-floating facts —
 * something PUT them there, usually recently, sometimes this very
 * creature — and a foe that has someone in its coils should know it's
 * holding them rather than deduce that somebody must be.
 *
 * Oldest first, so the last line is the freshest thing that happened.
 */
function describeHistory(recent: ResolvedTurn[], foeId: string): string {
  if (!recent.length) return 'WHAT HAS ALREADY HAPPENED: nothing recorded yet this fight.';
  /**
   * What it cost, and what each part BOUGHT.
   *
   * Said as a lump, "spent 1 Grit" on a turn that both moved and used
   * a free ability taught the next creature that the ABILITY costs a
   * Grit — which it stated as fact in its premises. Naming what each
   * line paid for is the fix; rows written before `Spend[]` existed
   * are single objects and still read fine.
   */
  const paidOf = (r: ResolvedTurn): string => {
    const raw = r.spend as unknown;
    const lines: Spend[] = Array.isArray(raw) ? raw : raw ? [raw as Spend] : [];
    if (!lines.length) return '';
    // A zero is a POSITIVE fact — this cost nothing — and saying it as
    // "0 Grit" invites it to be read as a missing number.
    const said = lines.map((s) =>
      s.amount === 0
        ? `${s.on} cost no ${s.counter}`
        : `${s.amount} ${s.counter}${s.on ? ` on ${s.on}` : ''}`,
    );
    return ` (spent ${said.join(', ')})`;
  };

  const lines = recent.map((r) => {
    const mine = r.by === foeId ? ' (you did this)' : '';
    // A turn aimed at nobody has no damage to report and reads wrong
    // as "used X on undefined" — it's the ACT that's the fact, plus
    // what it cost. Hiding, repositioning and readying are exactly the
    // turns a later decision most wants to know about.
    // What a turn shook OFF, said wherever it happened. A creature
    // holding someone wants to know the grip is slipping, and a turn
    // spent tearing free is otherwise invisible in the record.
    const eased = r.relieved?.length
      ? `, ${r.relieved
          .map((e) =>
            e.to === null
              ? `shaking off ${e.name} entirely`
              : // A relief that moved NOTHING is the interesting one:
                // somebody spent their turn on it and is still held.
                // "easing Trapped 5 down to 5" reads as a typo.
                e.to === e.from
                ? `trying and failing to shake off ${e.name} ${e.from}`
                : `easing ${e.name} ${e.from} down to ${e.to}`,
          )
          .join(' and ')}`
      : '';
    // Acting on YOURSELF is not an exchange, and reading it as one is
    // noise the model has to see past: "used Tears at the weed on
    // Barrett Vargas — no damage (Health 5 → 5)" says nothing except
    // that a name appears twice. Relieving is the common case and it is
    // always self-targeted.
    if (!r.targetName || r.target === r.by) {
      return `round ${r.round}: ${r.byName} — ${r.action}${eased}${paidOf(r)}${mine}`;
    }
    // A crowd reads as ONE thing that happened, because it was one
    // thing: an area attack rolls its severity once and lands it on
    // everybody. Four separate lines describing four separate turns is
    // what this looked like before the endpoint could take a list.
    if (r.targets && r.targets.length > 1) {
      const who = r.targets.map((t) => t.name);
      const all = `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`;
      const hitAll = r.damage > 0 ? `${r.damage} damage each` : 'no damage';
      const leftAll = r.statuses.length
        ? `, leaving them ${r.statuses.map((s) => `${s.name} ${s.severity}`).join(' and ')}`
        : '';
      return `round ${r.round}: ${r.byName} used ${r.action} and caught ${all} — ${hitAll}${leftAll}${paidOf(r)}${mine}`;
    }
    const hit = r.damage > 0 ? `${r.damage} damage` : 'no damage';
    const vital = r.vital ? ` (${r.vital.name} ${r.vital.from} → ${r.vital.to})` : '';
    const blocked = r.blocked > 0 ? `, ${r.blocked} blocked` : '';
    const left = r.statuses.length
      ? `, leaving ${r.statuses.map((s) => `${s.name} ${s.severity}`).join(' and ')}`
      : '';
    // An attack's cost belongs here too: what a turn could afford last
    // round is how a creature judges what it can afford this one.
    return `round ${r.round}: ${r.byName} used ${r.action} on ${r.targetName} — ${hit}${blocked}${vital}${left}${eased}${paidOf(r)}${mine}`;
  });
  return [
    'WHAT HAS ALREADY HAPPENED (oldest first; this is where the conditions above came from):',
    ...lines,
  ].join('\n');
}

/**
 * Who crossed ground, and whether it was toward or away from YOU.
 *
 * Raw coordinates are noise in a prompt — the useful shape of a move
 * is what a creature would actually register about it: someone came
 * closer, someone backed off, and by how much. So each move is
 * measured against the acting foe's own position, and the verb falls
 * out of the sign.
 *
 * The other half is what did NOT happen: a creature that hasn't left
 * its water in three rounds is the sort of fact a profile turns on,
 * and it can only be stated by something that has been watching.
 */
function describeMoves(
  moves: TokenMove[],
  actor: { x: number; y: number } | null,
  actorId: string,
  bands?: SystemTemplate['bands'],
): string {
  if (!moves.length) return '';
  const gap = (p: { x: number; y: number }) =>
    actor ? Math.hypot(p.x - actor.x, p.y - actor.y) : null;
  const lines = moves.map((mv) => {
    const mine = mv.characterId === actorId;
    const before = gap(mv.from);
    const after = gap(mv.to);
    let sense = '';
    if (!mine && before !== null && after !== null) {
      const delta = before - after;
      const verb =
        Math.abs(delta) < 0.5 ? 'staying about as far off' : delta > 0 ? 'toward you' : 'away from you';
      const now = bandOf(after, bands)?.name;
      const was = bandOf(before, bands)?.name;
      sense =
        now && was
          ? ` — ${verb}, now ${now} (was ${was})`
          : ` — ${verb}`;
    }
    // How FAR they went is a band too — "a short move", not a number.
    const far = bandOf(mv.distance, bands)?.name;
    return `round ${mv.round}: ${mine ? 'YOU' : mv.label} moved${far ? ` about ${far}` : ''}${sense}`;
  });
  const stillness =
    actor && !moves.some((mv) => mv.characterId === actorId)
      ? ['You have not moved in any of the turns recorded above.']
      : [];
  return ['WHO HAS MOVED (oldest first):', ...lines, ...stillness].join('\n');
}

const SYSTEM = `You are Teller, the bookkeeping assistant at an in-person tabletop RPG session. The Warden (GM) is running a fight and asks: what would this foe do on its turn?

You PROPOSE; the Warden decides. Suggest one turn's worth of action for the named foe, played true to its profile and current condition — not optimally. A cowardly creature flees at the wrong moment; a beast attacks the nearest threat, not the healer.

Hard rules:
- Suggest the ACTION only. Never roll dice, never state damage dealt or outcomes — the table's dice decide outcomes.
- Never decide for a player character.
- Base position reasoning only on the board given. When you assume something the board doesn't state, say so in premises.
- SPEAK IN THE WORLD, NOT ON THE TABLE. Table inches are how teller measures; they do not exist in the fiction and must never appear in "action", "rationale" or "preface". Say the band by name ("closes to arm's reach", "at short range") or the world distance it stands for ("a dozen yards"). Premises may cite a measurement when the whole point is that a number is being checked.
- An attack's printed BAND is strict. An attack listed under one band cannot be used from another — if the distance given puts every attack out of reach, the honest turn is to close, reposition, wait, or use something that does reach. Never widen an attack's band to make a plan work, and never do it to avoid a hazard: picking a different attack or a different route is the answer, not reinterpreting the book.
- The GROUND is part of the decision, not scenery. What a creature stands in, what it would have to cross, and what lies between it and a target are all stated. A hazard in the way is a real reason to go around, wait, pick a different target, or accept the cost on purpose — and when the ground changes your choice, say which ground and why in the rationale.

Respond with ONLY a JSON object, no other text:
{"premises": ["assumption the Warden should check", ...], "action": "what the foe does this turn, 1-3 sentences, concrete", "rationale": "why, in one sentence, grounded in profile/condition", "preface": "read-aloud words for the attempt", "roll": {"dice": "2G", "for": "Strangle damage"}, "target": "Barrett Vargas"}

"roll" names the dice the action calls for: use the EXACT pool printed on the foe's own attack or stat line (like "2G" or "3B3G"), and say what it's for. Omit "roll" entirely if the action needs no dice (moving, hiding, waiting).

"target" is who the action is aimed at, spelled EXACTLY as that combatant is named in the fight. Omit it when the action targets nobody (moving, hiding, waiting) or hits an area rather than one named combatant.

"preface" is 1–2 vivid present-tense sentences the Warden READS ALOUD to the players before any dice are rolled. It is the attempt, not the result. Rules for it:
- Stop at the instant of contact. No hit, no miss, no damage, no target's reaction, no consequence of any kind — the dice haven't decided yet and you must not imply what they will.
- End mid-motion, leaning forward. It should make the table want to see the roll.
- Prose only: no dice, no Grit, no bracketed statuses, no stat names.
- Never describe what a player character thinks or feels.
- If this foe was hidden and the action breaks cover, the preface IS the reveal — describe what the posse suddenly sees.

At most 4 premises, each under 15 words. Terse beats thorough — this is read mid-fight.`;

// ---------------------------------------------------------------------------
// The provider call — a fetch, which is why this file is runtime-agnostic
// for free: no SDK, no node API, nothing Workers lacks.

async function complete(env: AssistantEnv, system: string, user: string): Promise<string> {
  const style = env.ASSISTANT_STYLE === 'openai' ? 'openai' : 'anthropic';
  const model = env.ASSISTANT_MODEL!;

  if (style === 'openai') {
    const url = env.ASSISTANT_URL ?? 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.ASSISTANT_KEY ? { authorization: `Bearer ${env.ASSISTANT_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`assistant endpoint said ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('assistant endpoint returned no text');
    return text;
  }

  const url = env.ASSISTANT_URL ?? 'https://api.anthropic.com/v1/messages';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(env.ASSISTANT_KEY ? { 'x-api-key': env.ASSISTANT_KEY } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`assistant endpoint said ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('assistant endpoint returned no text');
  return text;
}

/**
 * The first COMPLETE top-level object in a reply.
 *
 * This used to be indexOf('{') to lastIndexOf('}'), which breaks three
 * ways: a chatty preamble containing a brace starts the slice early, a
 * closing note ends it late, and a reply TRUNCATED mid-object has no
 * closing brace at all and reported the confusing "replied without
 * JSON" while staring at a reply that plainly began with JSON.
 *
 * Walking the braces (respecting strings and escapes) handles all
 * three, and returning null for an unterminated object is what lets
 * the caller say "cut off" instead of "malformed".
 */
function objects(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) found.push(text.slice(start, i + 1));
    }
  }
  return found;
}

/**
 * The first complete object that is actually the ANSWER.
 *
 * Taking the first object full stop assumes the model never says
 * anything before it — and "assistant suggestion had no action" turned
 * up twice in play, which is the error thrown when an object parsed
 * fine and simply wasn't the one wanted. Anything ahead of the answer
 * (a scratch object, an example it talked itself into, a stray `{}`)
 * would take the slot and the real reply behind it was discarded.
 *
 * So: walk the balanced objects and take the first that carries the
 * key that makes it an answer, falling back to the first object at all
 * so a genuinely keyless reply still reports the old, useful error.
 */
function firstObject(text: string, key?: string): string | null {
  const found = objects(text);
  if (!found.length) return null;
  if (!key) return found[0];
  for (const candidate of found) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && parsed[key]) return candidate;
    } catch {
      // Not parseable is not a candidate; keep looking.
    }
  }
  return found[0];
}

/** The model was ASKED for bare JSON; a chatty one gets its braces found anyway. */
function parseSuggestion(reply: string, model: string): TurnSuggestion {
  const found = firstObject(reply, 'action');
  if (!found) {
    throw new Error(
      reply.includes('{')
        ? 'the assistant\'s answer was cut off before it finished — try again'
        : `assistant replied without JSON: ${reply.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(found) as Partial<TurnSuggestion>;
  // Carry the reply into the error. A failure used to discard the one
  // piece of evidence needed to diagnose it, which is why this was
  // seen twice in play and still couldn't be named.
  if (!parsed.action) {
    throw new Error(`assistant suggestion had no action: ${reply.slice(0, 300)}`);
  }
  // The roll is optional, and SALVAGED rather than judged: a model
  // that answers "2G damage" or "roll 2B1G" has named the pool
  // perfectly well, and demanding the whole string be nothing but a
  // pool threw those away silently — the card then had a suggestion
  // and nothing to act on, which reads at the table as "it didn't
  // work" (Brian, 2026-08-15, hitting exactly that).
  const printed = String(parsed.roll?.dice ?? '').replace(/\s+/g, '');
  const pool = /(?:\d+[A-Za-z])+/.exec(printed)?.[0];
  const roll =
    parsed.roll && pool
      ? { dice: pool, for: String(parsed.roll.for ?? 'the roll') }
      : undefined;
  // The target is a GUESS at where damage lands — carried through only
  // when it's a plain name, and matched against the fight on the client
  // (which knows who's actually in it; this file only knows what it was
  // told). Nothing is ever applied from it without a tap.
  const target =
    typeof parsed.target === 'string' && parsed.target.trim()
      ? parsed.target.trim()
      : undefined;
  return {
    premises: Array.isArray(parsed.premises) ? parsed.premises.map(String) : [],
    action: String(parsed.action),
    rationale: String(parsed.rationale ?? ''),
    ...(roll ? { roll } : {}),
    ...(target ? { target } : {}),
    ...(typeof parsed.preface === 'string' && parsed.preface.trim()
      ? { preface: parsed.preface.trim() }
      : {}),
    model,
  };
}

/**
 * One foe's turn, proposed. Reads are arguments; there is no way for
 * this function to write anything anywhere.
 */
/** Everything both asks share: the foe, the board, the physics, the fight. */
function assembleContext(
  campaign: Campaign,
  characters: Character[],
  session: SessionState | null,
  foe: Character,
  heightInches?: number,
  space?: string,
  recent: ResolvedTurn[] = [],
  moves: TokenMove[] = [],
  bands?: SystemTemplate['bands'],
  statusRules?: SystemTemplate['statuses'],
): string {
  const scene =
    campaign.data.maps?.find((s) => s.id === campaign.data.activeMapId) ??
    campaign.data.maps?.[0];

  // A creature knows its own state of concealment — stealth is usually
  // the whole plan — so say it outright rather than hoping the model
  // notices a flag in the token list.
  const ownToken = scene?.tokens?.find((t) => t.characterId === foe.id);
  const concealment = ownToken?.hidden
    ? `\n\n${foe.name} is currently HIDDEN — the posse does not know it's there. Staying hidden, repositioning unseen, or striking from ambush are all on the table; revealing itself is a choice.`
    : '';

  const profile = profileOf(foe);
  return [
    describeFoe(foe) + concealment,
    profile
      ? `PROFILE (how it acts — follow this): ${profile}`
      : 'PROFILE: none written. Infer temperament from its name and stats, and say you did in premises.',
    describeBoard(scene, characters, foe.id, heightInches, bands),
    describeUnplaced(session, scene, characters),
    space ? `SPACE & MOVEMENT (this system's rules — use these, don't guess): ${space}` : '',
    describeStacking(statusRules),
    describeFight(session, characters, foe.id),
    describeHistory(recent, foe.id),
    describeMoves(
      moves,
      ownToken && scene?.widthInches
        ? {
            x: ownToken.u * scene.widthInches,
            y: ownToken.v * (heightInches ?? scene.widthInches),
          }
        : null,
      foe.id,
      bands,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * What changes when the WARDEN has already decided.
 *
 * The whole flow assumed teller proposes and a human disposes, which
 * left no way to say "I've decided it uses the Frenzy — you do the
 * rest" (Brian, 2026-08-15). The automation worth having isn't the
 * choosing; it's the premises, the dice, and the words to read out.
 *
 * So the decision becomes an input. Rule 1 read forwards for once:
 * usually the human overrules the machine after the fact, and here
 * they simply go first. The last line matters most — a Warden's
 * ruling that contradicts the book is still the ruling, and teller
 * carries it out while saying plainly what it noticed.
 */
function decided(intent: string): string {
  return [
    `THE WARDEN HAS ALREADY DECIDED THIS TURN: ${intent}`,
    'Do NOT choose a different action, a different target, or a better one. That decision is made and it is not yours.',
    "Your job is the rest of it: the premises this rests on, the dice it calls for from this creature's own printed lines, who it is aimed at, and the preface to read aloud.",
    'If the decision looks like it breaks a rule — a band it cannot reach, a cost it cannot pay, a threshold not met — say so plainly in premises and then write the turn anyway. The table\'s ruling beats the book, and your job is to flag, not to refuse.',
  ].join('\n');
}

export async function suggestTurn(
  env: AssistantEnv,
  campaign: Campaign,
  characters: Character[],
  session: SessionState | null,
  foe: Character,
  /** True map height in inches, when the caller could measure the art. */
  heightInches?: number,
  /** The system's own scale contract — `SystemTemplate.space`. */
  space?: string,
  /** Exchanges already resolved this fight, oldest first. */
  recent: ResolvedTurn[] = [],
  moves: TokenMove[] = [],
  bands?: SystemTemplate['bands'],
  statusRules?: SystemTemplate['statuses'],
  /** The Warden's own call, when they've made it. See `decided`. */
  intent?: string,
): Promise<TurnSuggestion> {
  const context = assembleContext(
    campaign, characters, session, foe, heightInches, space, recent, moves, bands, statusRules,
  );
  const user = intent?.trim()
    ? `${context}\n\n\n${decided(intent.trim())}`
    : `${context}\n\n\nWhat would ${foe.name} do this turn?`;
  return parseSuggestion(await complete(env, SYSTEM, user), env.ASSISTANT_MODEL!);
}

const NARRATE_SYSTEM = `You are Teller, the bookkeeping assistant at an in-person tabletop RPG session. A foe's turn was just RESOLVED at the table: the Warden picked an action and the players rolled REAL dice. Your job is to dress the already-decided facts as a moment of story.

Write 2–4 vivid sentences the Warden can read aloud to the players, present tense, concrete and sensory — the kind of beat that makes a table lean in.

YOU ARE CONTINUING, NOT STARTING. The Warden has ALREADY read the setup aloud, and when it is given below you must treat it as spoken and behind you: it stopped at the instant of contact, mid-motion. Open where those words broke off and carry straight on into what the dice decided. Do not re-approach, do not re-describe the lunge or the grab, do not restate the setup in fresh words — the table has heard it, and hearing it twice makes the dice feel undone and rolled again.

Hard rules:
- The dice already decided everything. Narrate ONLY what the given action and results state — never add damage, statuses, movement or events they don't contain, and never soften or improve an outcome.
- This will be read TO THE PLAYERS: never mention anything marked hidden or unseen-by-the-posse unless the resolved action itself reveals it.
- Never describe what a player character thinks or feels; their bodies may react, their minds are their players'.
- No rules language in the prose — no dice, Grit, or bracketed statuses; say what Trapped [4] LOOKS like, not what it's called.
- When the results say a target defended, show HOW using only what they visibly wear, carry or did — plate, a shield, cover, bracing. Describing a defense the results already state is not adding an event; inventing protection they don't have is.

Respond with ONLY a JSON object, no other text:
{"narration": "the read-aloud text"}`;

/**
 * The second click: results in, story out. `action` is what the Warden
 * actually ran (the suggestion, edited or not) and `result` is what the
 * table's dice said — both arrive as the Warden's own words, and the
 * model may not embellish past them.
 */
export async function narrateOutcome(
  env: AssistantEnv,
  campaign: Campaign,
  characters: Character[],
  session: SessionState | null,
  foe: Character,
  action: string,
  result: string,
  heightInches?: number,
  space?: string,
  recent: ResolvedTurn[] = [],
  moves: TokenMove[] = [],
  /** The setup already spoken at the table, to continue from. */
  preface?: string,
  bands?: SystemTemplate['bands'],
  statusRules?: SystemTemplate['statuses'],
): Promise<TurnNarration> {
  const user = [
    assembleContext(campaign, characters, session, foe, heightInches, space, recent, moves, bands, statusRules),
    ...(preface
      ? [
          `WHAT THE WARDEN ALREADY READ ALOUD (spoken; continue from where it stops, never retell it): ${preface}`,
        ]
      : []),
    `THE ACTION THE WARDEN RAN: ${action}`,
    `WHAT THE DICE SAID (the table's results, already final): ${result}`,
    `\nNarrate what just happened.`,
  ].join('\n\n');
  const reply = await complete(env, NARRATE_SYSTEM, user);
  const found = firstObject(reply, 'narration');
  if (!found) {
    throw new Error(
      reply.includes('{')
        ? 'the assistant\'s answer was cut off before it finished — try again'
        : `assistant replied without JSON: ${reply.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(found) as { narration?: string };
  if (!parsed.narration) {
    throw new Error(`assistant narration was empty: ${reply.slice(0, 300)}`);
  }
  return { narration: String(parsed.narration), model: env.ASSISTANT_MODEL! };
}

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
  Scene,
  SessionState,
  ResolvedTurn,
  TokenMove,
  TurnNarration,
  TurnSuggestion,
} from './types';

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

function describeFoe(foe: Character): string {
  const lines = [`FOE: ${foe.name}`];
  const fields = foe.data.fields.filter((f) => f.value);
  if (fields.length) {
    lines.push(`stats: ${fields.map((f) => `${f.label}: ${f.value}`).join(' · ')}`);
  }
  for (const c of foe.data.counters) {
    lines.push(`${c.name}: ${c.current}${c.max !== null ? `/${c.max}` : ''}`);
  }
  if (foe.data.tags.length) lines.push(`conditions: ${foe.data.tags.join(', ')}`);
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
): string {
  if (!scene) return 'BOARD: no active scene — positions unknown.';
  const width = scene.widthInches;
  const tall = heightInches ?? width;
  const unit = width ? 'inches from the map left/top edge' : 'map fraction 0..1';
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
    return [...hit.entries()].map(([label, n]) => `${label} (${n} in.)`);
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
      const gap =
        self2 && t.id !== self2.id && width
          ? ` — ${round2(
              Math.hypot((t.u - self2.u) * width, (t.v - self2.v) * tall!),
            )}in from you`
          : '';
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
        const tags = who?.data.tags.length ? `, ${who.data.tags.join('/')}` : '';
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
  const lines = recent.map((r) => {
    const mine = r.by === foeId ? ' (you did this)' : '';
    const hit = r.damage > 0 ? `${r.damage} damage` : 'no damage';
    const vital = r.vital ? ` (${r.vital.name} ${r.vital.from} → ${r.vital.to})` : '';
    const blocked = r.blocked > 0 ? `, ${r.blocked} blocked` : '';
    const left = r.statuses.length
      ? `, leaving ${r.statuses.map((s) => `${s.name} ${s.severity}`).join(' and ')}`
      : '';
    return `round ${r.round}: ${r.byName} used ${r.action} on ${r.targetName} — ${hit}${blocked}${vital}${left}${mine}`;
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
      const verb = Math.abs(delta) < 0.5 ? 'staying about as far off' : delta > 0 ? 'toward you' : 'away from you';
      sense = ` — ${verb}, now ${round2(after)}in from you (was ${round2(before)}in)`;
    }
    return `round ${mv.round}: ${mine ? 'YOU' : mv.label} moved ${round2(mv.distance)}in${sense}`;
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
        max_tokens: 2048,
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
      max_tokens: 2048,
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

/** The model was ASKED for bare JSON; a chatty one gets its braces found anyway. */
function parseSuggestion(reply: string, model: string): TurnSuggestion {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`assistant replied without JSON: ${reply.slice(0, 200)}`);
  const parsed = JSON.parse(reply.slice(start, end + 1)) as Partial<TurnSuggestion>;
  if (!parsed.action) throw new Error('assistant suggestion had no action');
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
    describeBoard(scene, characters, foe.id, heightInches),
    space ? `SPACE & MOVEMENT (this system's rules — use these, don't guess): ${space}` : '',
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
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
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
): Promise<TurnSuggestion> {
  const user = `${assembleContext(campaign, characters, session, foe, heightInches, space, recent, moves)}\n\n\nWhat would ${foe.name} do this turn?`;
  return parseSuggestion(await complete(env, SYSTEM, user), env.ASSISTANT_MODEL!);
}

const NARRATE_SYSTEM = `You are Teller, the bookkeeping assistant at an in-person tabletop RPG session. A foe's turn was just RESOLVED at the table: the Warden picked an action and the players rolled REAL dice. Your job is to dress the already-decided facts as a moment of story.

Write 2–4 vivid sentences the Warden can read aloud to the players, present tense, concrete and sensory — the kind of beat that makes a table lean in.

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
): Promise<TurnNarration> {
  const user = [
    assembleContext(campaign, characters, session, foe, heightInches, space, recent, moves),
    `THE ACTION THE WARDEN RAN: ${action}`,
    `WHAT THE DICE SAID (the table's results, already final): ${result}`,
    `\nNarrate what just happened.`,
  ].join('\n\n');
  const reply = await complete(env, NARRATE_SYSTEM, user);
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`assistant replied without JSON: ${reply.slice(0, 200)}`);
  }
  const parsed = JSON.parse(reply.slice(start, end + 1)) as { narration?: string };
  if (!parsed.narration) throw new Error('assistant narration was empty');
  return { narration: String(parsed.narration), model: env.ASSISTANT_MODEL! };
}

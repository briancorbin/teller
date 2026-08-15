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
): string {
  if (!scene) return 'BOARD: no active scene — positions unknown.';
  const width = scene.widthInches;
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
    .map((t) => {
      const who = t.characterId ? byId.get(t.characterId) : undefined;
      const x = width ? round2(t.u * width) : round2(t.u);
      const y = width ? round2(t.v * width) : round2(t.v);
      const tag = who ? (who.kind === 'pc' ? 'PC' : 'foe') : 'marker';
      const cover = t.hidden
        ? t.characterId === foeId
          ? ' — HIDDEN: the posse cannot see it'
          : ' — hidden, unseen by the posse'
        : '';
      return `- ${t.label} (${tag}) at x=${x}, y=${y}${t.effect ? `, in ${t.effect}` : ''}${cover}`;
    });
  const zones = (scene.zones ?? [])
    .filter((z) => !z.hidden)
    .map((z) => `- ${z.effect} covering ${z.cells.length} square inch(es)`);
  return [
    `BOARD (positions in ${unit}; the map is ${width ? `${width} inches wide` : 'uncalibrated'}):`,
    rows.length ? rows.join('\n') : '- no tokens placed',
    ...(zones.length ? ['ground effects:', ...zones] : []),
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
        return `${i + 1}. ${e.label}${state}${tags} ${marks}`.trimEnd();
      }),
    );
  } else {
    lines.push('TURN ORDER: none set — combat may not have started.');
  }
  return lines.join('\n');
}

const SYSTEM = `You are Teller, the bookkeeping assistant at an in-person tabletop RPG session. The Warden (GM) is running a fight and asks: what would this foe do on its turn?

You PROPOSE; the Warden decides. Suggest one turn's worth of action for the named foe, played true to its profile and current condition — not optimally. A cowardly creature flees at the wrong moment; a beast attacks the nearest threat, not the healer.

Hard rules:
- Suggest the ACTION only. Never roll dice, never state damage dealt or outcomes — the table's dice decide outcomes.
- Never decide for a player character.
- Base position reasoning only on the board given. When you assume something the board doesn't state, say so in premises.

Respond with ONLY a JSON object, no other text:
{"premises": ["assumption the Warden should check", ...], "action": "what the foe does this turn, 1-3 sentences, concrete", "rationale": "why, in one sentence, grounded in profile/condition"}

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
        max_tokens: 1024,
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
      max_tokens: 1024,
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
  return {
    premises: Array.isArray(parsed.premises) ? parsed.premises.map(String) : [],
    action: String(parsed.action),
    rationale: String(parsed.rationale ?? ''),
    model,
  };
}

/**
 * One foe's turn, proposed. Reads are arguments; there is no way for
 * this function to write anything anywhere.
 */
export async function suggestTurn(
  env: AssistantEnv,
  campaign: Campaign,
  characters: Character[],
  session: SessionState | null,
  foe: Character,
): Promise<TurnSuggestion> {
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
  const user = [
    describeFoe(foe) + concealment,
    profile
      ? `PROFILE (how it acts — follow this): ${profile}`
      : 'PROFILE: none written. Infer temperament from its name and stats, and say you did in premises.',
    describeBoard(scene, characters, foe.id),
    describeFight(session, characters, foe.id),
    `\nWhat would ${foe.name} do this turn?`,
  ].join('\n\n');

  return parseSuggestion(await complete(env, SYSTEM, user), env.ASSISTANT_MODEL!);
}

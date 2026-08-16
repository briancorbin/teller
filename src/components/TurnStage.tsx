import type {
  Character,
  Counter,
  EncounterState,
  InitiativeEntry,
  SystemTemplate,
  TurnNarration,
  TurnSuggestion,
} from '../../worker/types';
import { combinePools, tallyFaces } from '../lib/dice';
import {
  gateMet,
  parseAbilities,
  parseAttacks,
  parseDefense,
  statusTag,
  weaponAttacks,
  type StatStatus,
} from '../lib/statblock';
import { btn, btnPrimary } from '../lib/ui';
import { DicePool, rollPool, type DieArt } from './DicePool';
import { PoolGrid, ProseSections } from './Statblock';
import { Range } from './Range';
import { CounterStepper } from './Vitals';
import { STATE_EFFECTS } from './token-visuals';

// THE STAGE — whoever's turn it is, at full size.
//
// The roster answers "who's up and who's hurt". This answers "what do
// they do", and it only ever shows ONE combatant: the one acting. That
// is the whole reason it can afford to be generous. Anything you do to
// somebody ELSE happens over in the roster, so there is no selection
// to get lost in and no way to be looking at the wrong sheet.
//
// The ✦ flow below is four earned steps — propose, roll, resolve,
// narrate — and each appears only once the one above it has something
// to hand down. Nothing in it applies itself: the resolve step does
// the arithmetic the book asks for and then waits to be told.

export type Advice = {
  busy?: boolean;
  error?: string;
  suggestion?: TurnSuggestion;
  /**
   * The Warden's own call for this turn, when they've made it. Sent to
   * teller as the decision to work around rather than a hint.
   */
  intent?: string;
  /** The pool in play — from the suggestion, or a primed attack. */
  roll?: { dice: string; for: string; statuses?: StatStatus[] };
  faces?: (string | null)[];
  /** Where it lands. Proposed by the model, chosen by the Warden. */
  targetId?: string;
  /** Which defenses the target brought — additive, per the book. */
  defenses?: string[];
  /** Dodge dice bought this turn: 1B per Grit the target spent. */
  dodge?: number;
  defFaces?: (string | null)[];
  /** Faces rolled for statuses whose Severity is a pool, by name. */
  sevFaces?: Record<string, (string | null)[]>;
  /**
   * Severity the Warden set by hand, by status name — null means
   * "don't hang this one at all". The book is genuinely ambiguous
   * here (Severity is Hits minus Dodge and Cover, yet a printed
   * "[4]" is described as always 4), so teller shows the printed
   * reading and lets the table's ruling win, as it must.
   */
  sevSet?: Record<string, number | null>;
  /**
   * What the ACTION itself costs, off the printed line, and out of
   * which counter.
   */
  spend?: { counter: string; amount: number };
  /**
   * What the turn spent getting there, counted separately.
   *
   * A turn usually also buys MOVEMENT, which is a judgment about
   * distance, speed and ground that only the Warden can make — but
   * folding it into one total made the log ambiguous, and the log is
   * read by a model: a creature moved and used a free ability, the
   * history said "spent 1 Grit", and the next creature concluded the
   * ABILITY costs a Grit (found in play, 2026-08-15). Two numbers, so
   * the record says which was which.
   */
  moved?: number;
  applied?: boolean;
  /** The vital's value BEFORE applying — the transition, not a re-derivation. */
  appliedFrom?: number;
  /** The Warden's own words, appended to what teller worked out. */
  result?: string;
  narrating?: boolean;
  narration?: TurnNarration;
};

/** The counter a hit comes off — the first bounded one, as everywhere. */
function vitalOf(character: Character): Counter | undefined {
  return character.data.counters.find((c) => c.max !== null && c.max > 0);
}

function fieldOf(character: Character, key: string): string {
  return character.data.fields.find((f) => f.key === key)?.value ?? '';
}

/**
 * What the target could be defending with.
 *
 * Defense is rolled and additive — the book calls it Dodge, Cover and
 * defence-improving items together — so these are toggles that sum,
 * not a single choice. Cover is always offered because anyone can get
 * behind a rock; armour is offered only when they're actually wearing
 * some; a printed pool shows up only on things that print one.
 */
function defenseOptions(target: Character | undefined): { label: string; dice: string }[] {
  if (!target) return [];
  const out: { label: string; dice: string }[] = [];
  const printed = parseDefense(fieldOf(target, 'defense'));
  if (printed) out.push({ label: 'its own Defense', dice: printed });
  for (const item of target.data.items ?? []) {
    const fields = item.fields ?? [];
    const cover = fields.find((f) => /^cover$/i.test(f.key))?.value;
    const armor = fields.find((f) => /^defen[cs]e$/i.test(f.key))?.value;
    if (armor) out.push({ label: item.name, dice: armor.replace(/\s+/g, '') });
    else if (cover) out.push({ label: item.name, dice: /heavy/i.test(cover) ? '2B' : '1B' });
  }
  out.push({ label: 'light cover', dice: '1B' });
  out.push({ label: 'heavy cover', dice: '2B' });
  return out;
}

/**
 * The statuses a roll inflicts, when the roll didn't bring its own.
 *
 * A suggestion names a pool and what it's for ("2G", "Strangle
 * damage") because that's all the model is asked for — the bracketed
 * status lives on the printed line, which teller can read itself. So
 * match the suggestion back to the statblock: by name first, then by
 * an unambiguous pool. A wrong guess would hang a status on somebody,
 * so anything ambiguous matches nothing and the Warden types it.
 */
function statusesFor(
  roll: { dice: string; for: string } | undefined,
  attacks: ReturnType<typeof parseAttacks>,
): StatStatus[] {
  if (!roll) return [];
  const named = attacks.filter((a) =>
    roll.for.toLowerCase().includes(a.name.toLowerCase()),
  );
  if (named.length === 1) return named[0].statuses;
  const byPool = attacks.filter((a) => a.dice === roll.dice);
  return byPool.length === 1 ? byPool[0].statuses : [];
}

export function TurnStage({
  character,
  entry,
  index,
  total,
  round,
  initiative,
  characters,
  states,
  dice,
  dieArt,
  advice,
  onAdvice,
  onSuggest,
  onNarrate,
  onPatchCharacter,
  onResolve,
  catalog,
  scene,
  bands,
}: {
  character: Character;
  entry: InitiativeEntry;
  index: number;
  total: number;
  round: number;
  initiative: InitiativeEntry[];
  characters: Character[];
  states: EncounterState[];
  dice: SystemTemplate['dice'];
  dieArt?: DieArt;
  advice: Advice | undefined;
  onAdvice: (patch: Advice | null) => void;
  /**
   * Ask Teller for the turn. With an `intent` the Warden has already
   * decided WHAT happens and is asking for everything else — premises,
   * dice, target, and the words to read out.
   */
  onSuggest?: (intent?: string) => void;
  onNarrate?: (action: string, result: string, preface?: string) => void;
  onPatchCharacter: (id: string, patch: { data?: Partial<Character['data']> }) => void;
  /** Land the exchange and record who did it — see EncounterPanel. */
  onResolve: (body: {
    actorId: string;
    /** Absent for a turn aimed at nobody — moving, hiding, waiting. */
    targetId?: string;
    /** Everyone caught, for an area action. */
    targets?: string[];
    action: string;
    hits: number;
    blocked: number;
    damage: number;
    statuses: { name: string; severity: number }[];
    /** Line items — what each part of the turn paid for. */
    spend?: { counter: string; amount: number; on?: string }[];
  }) => void;
  /**
   * The pack's item entries by id, so a carried weapon can be read for
   * its dice — a person's attacks are their GEAR, and the character's
   * copy only references the catalogue.
   */
  catalog: Map<string, { name: string; kind?: string; fields?: { key: string; value: string }[] }>;
  /** The live scene, to measure the gap to a target. */
  scene?: { widthInches?: number; heightInches?: number; tokens?: { characterId?: string | null; u: number; v: number }[] };
  /** The system's range bands — absent means teller says nothing. */
  bands?: SystemTemplate['bands'];
}) {
  const a = advice ?? {};
  const foe = character.kind === 'npc';
  // A printed statblock for a creature, carried weapons for a person —
  // and both, for anything that has both.
  const attacks = [
    ...parseAttacks(fieldOf(character, 'attacks')),
    ...weaponAttacks(character.data.items ?? [], catalog),
  ];
  /**
   * The things it can do that AREN'T on the attack line — a frenzy, a
   * special. Every long field is swept rather than a named one, because
   * which heading a book files its specials under is the book's affair
   * and teller has no list of them (rule 2).
   */
  const abilities = character.data.fields
    .filter((f) => f.value && f.key !== 'attacks' && f.value.includes('.'))
    .flatMap((f) => parseAbilities(f.value));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const target = a.targetId ? byId.get(a.targetId) : undefined;
  const targetFoe = target?.kind === 'npc';

  const options = defenseOptions(target);
  const chosen = options.filter((o) => (a.defenses ?? []).includes(o.label));
  // Dodge is 1B per Grit spent, so it's a DIAL, not a checkbox — one
  // chip that counts up beats four chips that don't.
  const dodge = a.dodge ?? 0;
  const defPool = combinePools([
    ...chosen.map((o) => o.dice),
    ...(dodge > 0 ? [`${dodge}B`] : []),
  ]);
  const statuses = a.roll?.statuses ?? statusesFor(a.roll, attacks);

  /** The gap between the acting creature and someone, in table inches. */
  const gapTo = (who: Character | undefined): number | null => {
    const w = scene?.widthInches;
    if (!who || !w || !scene?.tokens) return null;
    const mine = scene.tokens.find((t) => t.characterId === character.id);
    const theirs = scene.tokens.find((t) => t.characterId === who.id);
    if (!mine || !theirs) return null;
    const tall = scene.heightInches ?? w;
    return Math.hypot((theirs.u - mine.u) * w, (theirs.v - mine.v) * tall);
  };

  const hits = tallyFaces(a.faces ?? [], dice).total;
  const blocked = tallyFaces(a.defFaces ?? [], dice).total;
  const damage = Math.max(0, hits - blocked);
  const rolled = (a.faces ?? []).some(Boolean);

  /** Severity for a status: the Warden's word, else printed, else rolled. */
  const severityOf = (s: StatStatus): number | null => {
    if (a.sevSet && s.name in a.sevSet) return a.sevSet[s.name];
    return (
      s.severity ??
      (a.sevFaces?.[s.name]?.some(Boolean)
        ? tallyFaces(a.sevFaces[s.name], dice).total
        : null)
    );
  };

  const setSeverity = (name: string, value: number | null) =>
    onAdvice({ ...a, sevSet: { ...(a.sevSet ?? {}), [name]: value }, applied: false });

  const bump = (who: Character, counter: Counter, delta: number) =>
    onPatchCharacter(who.id, {
      data: {
        counters: who.data.counters.map((c) =>
          c.id === counter.id
            ? {
                ...c,
                current: Math.max(
                  0,
                  c.max !== null ? Math.min(c.max, c.current + delta) : c.current + delta,
                ),
              }
            : c,
        ),
      },
    });

  const toggleTag = (who: Character, tag: string) =>
    onPatchCharacter(who.id, {
      data: {
        tags: who.data.tags.includes(tag)
          ? who.data.tags.filter((t) => t !== tag)
          : [...who.data.tags, tag],
      },
    });

  /**
   * Land it. One press writes the damage and every status that has a
   * Severity — which is the only automation here, and it happens after
   * a human has read the arithmetic and chosen to press.
   */
  /**
   * The counter a turn is PAID out of.
   *
   * Usually the printed cost names it. When an action has no printed
   * cost at all — slipping into cover, a free feature — there's still
   * movement to pay for, so fall back to the first bounded counter
   * that isn't what damage comes off. That's the action budget in
   * every system that has one, and teller never learns its name.
   */
  const costCounter =
    a.spend?.counter ??
    character.data.counters.find((c) => c.max !== null && c !== vitalOf(character))?.name;

  const apply = () => {
    const vital = target ? vitalOf(target) : undefined;
    onResolve({
      actorId: character.id,
      // Nobody on the other end is a turn, not a missing field (TEL-98):
      // slipping into the brush costs Grit and belongs in the log, and
      // the assistant reads that log to know what a creature just did.
      ...(target ? { targetId: target.id } : {}),
      action: a.roll?.for ?? a.suggestion?.action ?? (target ? 'an attack' : 'a turn'),
      hits: target ? hits : 0,
      blocked: target ? blocked : 0,
      damage: target ? damage : 0,
      statuses: target
        ? statuses
            .map((s) => ({ name: s.name, severity: severityOf(s) }))
            .filter((s): s is { name: string; severity: number } => s.severity !== null)
        : [],
      // Line items, so the history says what each part paid for.
      spend: [
        ...(a.spend && a.spend.amount > 0
          ? [{ ...a.spend, on: a.roll?.for ?? a.spend.counter }]
          : []),
        ...(costCounter && (a.moved ?? 0) > 0
          ? [{ counter: costCounter, amount: a.moved!, on: 'moving' }]
          : []),
      ],
    });
    onAdvice({ ...a, applied: true, appliedFrom: vital?.current });
  };

  /** What teller worked out, in one sentence the narrator can use. */
  const exchange = (): string => {
    const parts: string[] = [];
    if (a.roll && rolled) {
      const faces = (a.faces ?? []).filter(Boolean).join(', ');
      parts.push(`${a.roll.for} — ${character.name} rolled ${a.roll.dice}: ${faces} = ${hits} ${dice?.unit ?? 'Hits'}`);
    }
    if (target) {
      const how = [...chosen.map((c) => c.label), ...(dodge > 0 ? ['a braced dodge'] : [])];
      const shown = (a.defFaces ?? []).filter(Boolean).join(', ');
      parts.push(
        how.length
          ? `${target.name} defended with ${how.join(' + ')} (${defPool}): ${shown || 'not yet rolled'} = ${blocked}`
          : `${target.name} had no defense`,
      );
      if (rolled) {
        const vital = vitalOf(target);
        // Read the BEFORE off what was recorded at the press, never off
        // the counter — by now the counter is the after.
        const from = a.appliedFrom;
        const after =
          vital && a.applied && from !== undefined
            ? ` (${vital.name} ${from} → ${Math.max(0, from - damage)})`
            : '';
        parts.push(`${target.name} takes ${damage}${after}`);
      }
      const applied = statuses
        .map((s) => {
          const sev = severityOf(s);
          return sev === null ? null : statusTag(s, sev);
        })
        .filter(Boolean);
      if (applied.length) parts.push(`statuses: ${applied.join(', ')}`);
    }
    const extra = a.result?.trim();
    if (extra) parts.push(extra);
    return parts.join('. ');
  };

  /**
   * Its printed attacks, tappable. Rendered in the statblock AND as
   * the way out when a suggestion arrives with no dice named — a card
   * you can read but not act on is the one thing this flow must never
   * hand back (Brian, 2026-08-15).
   */
  const attackChips = (
    <div className="flex flex-wrap gap-1.5">
      {attacks.map((atk, i) => (
        <button
          key={i}
          className={`rounded-md px-2 py-1 text-left font-mono text-[11px] transition-colors ${
            a.roll?.for === atk.name
              ? 'bg-amber-900/60 text-amber-100 ring-1 ring-amber-600'
              : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
          }`}
          title={`${atk.band} · ${atk.cost} ${atk.costUnit} · ${atk.effect}`}
          onClick={() =>
            onAdvice({
              ...a,
              // Priming an attack is already a decision — say so, so
              // "…or tell it what they do" is one Enter away.
              intent: `${atk.name} — ${atk.band}, ${atk.cost} ${atk.costUnit}, ${atk.effect}`,
              roll: atk.dice
        ? { dice: atk.dice, for: atk.name, statuses: atk.statuses }
        : undefined,
              faces: undefined,
              defFaces: undefined,
              sevFaces: {},
              applied: false,
              narration: undefined,
            })
          }
        >
          {atk.name}
          {/* The band, because one weapon prints a pool per reach and
              two "Used Pistol" chips are otherwise indistinguishable. */}
          {atk.band && <span className="ml-1.5 text-[10px] text-stone-500">{atk.band}</span>}
          {atk.dice && <span className="ml-1.5 text-amber-300">{atk.dice}</span>}
          {/* Spelled out, because "4G" beside a "2G" pool reads
              as four Gold dice and it is four GRIT. */}
          <span className="ml-1.5 text-[10px] text-stone-500">
            {atk.cost} {atk.costUnit.toLowerCase()}
          </span>
        </button>
      ))}
      {/*
        The things it can do that aren't on the attack line. A gate it
        hasn't reached DIMS the chip and never disables it — teller
        shows the Warden where the line is and lets them cross it
        (rule 1). Reaching one is the interesting moment of a fight and
        it lights up on its own.
      */}
      {abilities.map((ab, i) => {
        const open = gateMet(ab, character.data.counters);
        return (
          <button
            key={`ab-${i}`}
            className={`rounded-md px-2 py-1 text-left font-mono text-[11px] transition-colors ${
              a.roll?.for === ab.name
                ? 'bg-amber-900/60 text-amber-100 ring-1 ring-amber-600'
                : open
                  ? 'bg-rose-950/70 text-rose-200 hover:bg-rose-900/70'
                  : 'bg-stone-900 text-stone-600 hover:bg-stone-800'
            }`}
            title={`${ab.gate ? `at ${ab.gate.at} ${ab.gate.counter} or less — ` : ''}${ab.text}`}
            onClick={() =>
              onAdvice({
                ...a,
                intent: `${ab.name}. ${ab.text}`,
                roll: ab.dice
                  ? { dice: ab.dice, for: ab.name, statuses: ab.statuses }
                  : undefined,
                ...(ab.cost
                  ? { spend: { counter: ab.cost.unit, amount: ab.cost.amount } }
                  : {}),
                faces: undefined,
                defFaces: undefined,
                sevFaces: {},
                applied: false,
                narration: undefined,
              })
            }
          >
            {ab.name}
            {ab.gate && (
              <span className={`ml-1.5 text-[10px] ${open ? 'text-rose-300' : 'text-stone-600'}`}>
                {open ? 'ready' : `at ${ab.gate.at} ${ab.gate.counter.toLowerCase()}`}
              </span>
            )}
            {ab.dice && <span className="ml-1.5 text-amber-300">{ab.dice}</span>}
            {ab.cost && (
              <span className="ml-1.5 text-[10px] text-stone-500">
                {ab.cost.amount} {ab.cost.unit.toLowerCase()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const step = (n: number, label: string) => (
    <div className="flex items-center gap-2">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-700 font-mono text-[9px] text-stone-950">
        {n}
      </span>
      <span className="text-[11px] text-stone-400">{label}</span>
    </div>
  );

  const extraTags = character.data.tags.filter(
    (t) => !states.some((s) => s.name === t),
  );

  return (
    // Its own container, so the statblock's columns answer to the
    // STAGE's width rather than the whole panel's — in the split layout
    // those are very different numbers, and no device list exists to
    // ask instead.
    <div className="@container space-y-2.5">
      {/* ---- who's acting ---- */}
      <div className="rounded-xl border border-stone-800 bg-stone-900/70 p-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-serif text-xl text-amber-50">{entry.label}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              foe ? 'bg-red-950 text-red-300' : 'bg-stone-800 text-stone-400'
            }`}
          >
            {foe ? 'foe' : 'posse'}
          </span>
          {extraTags.map((t) => (
            <button
              key={t}
              className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 transition-colors hover:bg-red-950 hover:text-red-300"
              title="remove"
              onClick={() => toggleTag(character, t)}
            >
              {t} ✕
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-stone-600">
            {index + 1} of {total} · round {round}
          </span>
        </div>

        {/* Bounded counters first: mid-fight you want Health and Grit,
            not a running Prestige total that has no ceiling to draw. */}
        <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
          {[...character.data.counters]
            .sort((a, b) => Number(b.max !== null) - Number(a.max !== null))
            .slice(0, 4)
            .map((c) => (
              <CounterStepper key={c.id} counter={c} big onBump={(d) => bump(character, c, d)} />
            ))}
        </div>

        {states.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {states.map((state) => {
              const on = character.data.tags.includes(state.name);
              const visual = STATE_EFFECTS[state.effect ?? 'mark'];
              return (
                <button
                  key={state.name}
                  className="rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors"
                  style={
                    on
                      ? { background: visual.chip, color: '#0c0a09' }
                      : { background: '#1c1917', color: '#78716c' }
                  }
                  onClick={() => toggleTag(character, state.name)}
                >
                  {state.name}
                </button>
              );
            })}
          </div>
        )}

        {/* What the book says it can do — chips, so the pool and the
            status it inflicts are one tap away without asking anyone. */}
        {attacks.length + abilities.length > 0 && (
          <div className="mt-3 border-t border-stone-800 pt-2.5">
            <span className="text-[10px] uppercase tracking-widest text-stone-600">
              What it does
            </span>
            <div className="mt-1.5">{attackChips}</div>
            {/*
              And what it IS, right here (Brian, 2026-08-15: "I don't
              wanna have to click into the info popup every time I have
              a question"). The sheet dialog is for reading a creature;
              this is for deciding a turn, and a decision you have to
              open a dialog to make is one you make worse.

              Everything long is split into its named parts, because a
              trait you can find is worth four you have to read past.
              Nothing is filtered by name — which heading a book files
              its specials under is the book's affair (rule 2).
            */}
            {/*
              And what it IS, right here (Brian, 2026-08-15: "I don't
              wanna have to click into the info popup every time I have
              a question"). The sheet dialog is for reading a creature;
              this is for deciding a turn, and a decision you have to
              open a dialog to make is one you make worse.

              Same renderer the dialog uses, at its tight density — one
              statblock, two places, no chance of them drifting apart.
            */}
            <div className="mt-3 space-y-3">
              <PoolGrid character={character} dense />
              <ProseSections character={character} dense />
            </div>
          </div>
        )}
      </div>

      {/*
        A player's turn gets no flow, and the stage says why rather
        than going blank. teller does not play player characters — the
        thing on screen during their turn is their sheet, in case the
        Warden needs to reach into it, and nothing else.
      */}
      {!foe && !a.roll && (
        <p className="px-1 text-[12px] italic text-stone-600">
          {entry.label} plays themselves — pick what they swung to record it.
        </p>
      )}

      {/*
        The exchange. The ✦ half is a foe's — teller never plays the
        posse — but the DICE half belongs to everyone: a player's hit
        on a monster is the same subtraction, and until it was recorded
        here, half of every fight went unwritten and the assistant only
        ever knew what the monsters had done (Brian, 2026-08-15).
      */}
      {((onSuggest && foe) || a.roll) && (
        <div className="rounded-xl border border-amber-800/60 bg-stone-900/70 p-3.5">
          {onSuggest && foe && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
              ✦ teller
            </span>
            {a.suggestion && (
              <span className="font-mono text-[10px] text-stone-700">
                {a.suggestion.model}
              </span>
            )}
            <button
              className={`ml-auto rounded-md px-2 py-1 text-[11px] transition-colors ${
                a.busy
                  ? 'animate-pulse text-amber-300'
                  : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
              }`}
              disabled={a.busy}
              onClick={() => onSuggest()}
            >
              {a.busy ? 'thinking…' : a.suggestion ? 'ask again ↻' : 'what would they do?'}
            </button>
            {(a.suggestion || a.roll) && (
              <button
                className="rounded-md px-1.5 py-1 text-[11px] text-stone-500 transition-colors hover:text-red-300"
                title="clear the turn"
                onClick={() => onAdvice(null)}
              >
                ✕
              </button>
            )}
          </div>
          )}

          {/*
            You decide, teller does the rest (Brian, 2026-08-15: "if I
            want to just say that I think it would use the frenzy
            attack now because I decided, but I still want the rest of
            the agent automation").

            The choosing was never the valuable part — the premises,
            the dice off the printed line, and the words to read out
            are. So the decision becomes an input, and rule 1 reads
            forwards for once: instead of the human overruling the
            machine afterwards, they go first.

            Tapping a printed attack fills this, so the common case is
            two taps rather than typing.
          */}
          {onSuggest && foe && (
            <input
              className="mt-2 w-full rounded-md border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-[12px] text-stone-200 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none"
              placeholder="…or tell it what they do, and press enter"
              value={a.intent ?? ''}
              disabled={a.busy}
              onChange={(e) => onAdvice({ ...a, intent: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !a.intent?.trim()) return;
                onSuggest(a.intent.trim());
              }}
            />
          )}

          {a.error && <p className="mt-2 text-[11px] text-red-300">{a.error}</p>}

          {a.suggestion && (
            <div className="mt-2 space-y-1.5">
              {a.suggestion.premises.length > 0 && (
                <ul className="space-y-0.5">
                  {a.suggestion.premises.map((p, i) => (
                    <li key={i} className="text-[11px] italic leading-snug text-stone-500">
                      assuming {p}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[15px] leading-snug text-amber-100">{a.suggestion.action}</p>
              {a.suggestion.rationale && (
                <p className="text-[11px] leading-snug text-stone-500">
                  {a.suggestion.rationale}
                </p>
              )}

              {/*
                The front bookend: the attempt, in words for the TABLE,
                stopping at the moment of contact. Everything above it
                is the Warden's brief and is written in teller's voice;
                this is the only part of the card meant to be spoken,
                which is why it gets the serif and the rule.
              */}
              {a.suggestion.preface && (
                <blockquote className="mt-2 border-l-2 border-amber-700/70 pl-3">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-stone-600">
                    read aloud, then roll
                  </span>
                  <p className="font-serif text-[17px] leading-relaxed text-amber-50">
                    {a.suggestion.preface}
                  </p>
                </blockquote>
              )}
            </div>
          )}

          {/*
            A suggestion with no dice named. Sometimes that's right —
            it moved, it hid, it waited — and sometimes the model just
            didn't say. Either way the card must offer a next step
            instead of ending in prose, so its own attacks come to you.
          */}
          {a.suggestion && !a.roll && attacks.length + abilities.length > 0 && (
            <div className="mt-3 border-t border-stone-800 pt-2.5">
              <span className="text-[11px] text-stone-500">
                no roll named — if it attacked, pick which
              </span>
              <div className="mt-1.5">{attackChips}</div>
            </div>
          )}

          {/* 1 — the dice the action calls for */}
          {a.roll && dice && (
            <div className="mt-3 border-t border-stone-800 pt-2.5">
              {step(1, `roll ${a.roll.dice} — ${a.roll.for}`)}
              <div className="mt-2">
                <DicePool
                  pool={a.roll.dice}
                  faces={a.faces}
                  onFaces={(faces) => onAdvice({ ...a, faces })}
                  dice={dice}
                  dieArt={dieArt}
                  // Rule 5: teller rolls the monsters' dice and nobody
                  // else's. A player's attack is theirs to throw; this
                  // records what the plastic said.
                  onRoll={
                    foe
                      ? () => onAdvice({ ...a, faces: rollPool(a.roll!.dice, dice) })
                      : undefined
                  }
                />
              </div>
            </div>
          )}

          {/* 2 — who it lands on, and what they had to stop it */}
          {a.roll && rolled && (
            <div className="mt-3 border-t border-stone-800 pt-2.5">
              {step(2, 'who it lands on, and what stops it')}
              <div className="mt-2 flex flex-wrap gap-1">
                {initiative
                  .filter((e) => e.characterId && e.characterId !== character.id)
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                        a.targetId === e.characterId
                          ? 'bg-amber-800 text-amber-50'
                          : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                      }`}
                      onClick={() =>
                        onAdvice({
                          ...a,
                          targetId: e.characterId!,
                          defenses: [],
                          defFaces: undefined,
                          applied: false,
                        })
                      }
                    >
                      {e.label}
                    </button>
                  ))}
              </div>

              {target && (
                <div className="mt-2.5 space-y-2">
                  {gapTo(target) !== null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-stone-500">
                        {target.name} is
                      </span>
                      <Range inches={gapTo(target)!} bands={bands} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {options.map((o) => {
                      const on = (a.defenses ?? []).includes(o.label);
                      return (
                        <button
                          key={o.label}
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                            on
                              ? 'bg-sky-900 text-sky-100'
                              : 'bg-stone-800 text-stone-500 hover:bg-stone-700'
                          }`}
                          onClick={() =>
                            onAdvice({
                              ...a,
                              defenses: on
                                ? (a.defenses ?? []).filter((d) => d !== o.label)
                                : [...(a.defenses ?? []), o.label],
                              defFaces: undefined,
                              applied: false,
                            })
                          }
                        >
                          {o.label} {o.dice}
                        </button>
                      );
                    })}
                    {/* One Black die per Grit they spent bracing, so
                        this counts up rather than offering a row of
                        near-identical chips. Wraps back to none. */}
                    <button
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        dodge > 0
                          ? 'bg-sky-900 text-sky-100'
                          : 'bg-stone-800 text-stone-500 hover:bg-stone-700'
                      }`}
                      title="dodge — 1 Black die per Grit spent; tap to count up"
                      onClick={() =>
                        onAdvice({
                          ...a,
                          dodge: dodge >= 4 ? 0 : dodge + 1,
                          defFaces: undefined,
                          applied: false,
                        })
                      }
                    >
                      dodge {dodge > 0 ? `${dodge}B` : '＋'}
                    </button>
                  </div>

                  {defPool && dice && (
                    <DicePool
                      pool={defPool}
                      faces={a.defFaces}
                      onFaces={(defFaces) => onAdvice({ ...a, defFaces })}
                      dice={dice}
                      dieArt={dieArt}
                      size="sm"
                      // teller throws for foes only. A player's defense
                      // dice are the player's, same as every other die
                      // they own.
                      onRoll={
                        targetFoe
                          ? () => onAdvice({ ...a, defFaces: rollPool(defPool, dice) })
                          : undefined
                      }
                    />
                  )}

                  {statuses.map((s) => {
                    const sev = severityOf(s);
                    return (
                      <div key={s.name} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-stone-400">
                          {s.name}
                          {s.dice ? ` [${s.dice}]` : ` [${s.severity}]`}
                        </span>
                        {s.dice && dice && (
                          <DicePool
                            pool={s.dice}
                            faces={a.sevFaces?.[s.name]}
                            onFaces={(f) =>
                              onAdvice({
                                ...a,
                                sevFaces: { ...(a.sevFaces ?? {}), [s.name]: f },
                              })
                            }
                            dice={dice}
                            dieArt={dieArt}
                            size="sm"
                            onRoll={() =>
                              onAdvice({
                                ...a,
                                sevFaces: {
                                  ...(a.sevFaces ?? {}),
                                  [s.name]: rollPool(s.dice!, dice),
                                },
                              })
                            }
                          />
                        )}
                        {/* Nudge it, or drop it entirely. A blocked
                            hit that still hangs a status is teller
                            ruling on the table's behalf. */}
                        <span className="flex items-center gap-0.5">
                          <button
                            className="rounded px-1 text-xs text-stone-500 hover:bg-stone-800 hover:text-stone-200"
                            onClick={() => setSeverity(s.name, Math.max(0, (sev ?? 0) - 1))}
                            aria-label={`${s.name} severity down`}
                          >
                            −
                          </button>
                          <button
                            className="rounded px-1 text-xs text-stone-500 hover:bg-stone-800 hover:text-stone-200"
                            onClick={() => setSeverity(s.name, (sev ?? 0) + 1)}
                            aria-label={`${s.name} severity up`}
                          >
                            +
                          </button>
                          <button
                            className={`ml-1 rounded px-1.5 font-mono text-[10px] transition-colors ${
                              sev === null
                                ? 'bg-stone-800 text-stone-600'
                                : 'text-stone-500 hover:text-red-300'
                            }`}
                            title={sev === null ? 'put it back' : "don't hang this one"}
                            onClick={() => setSeverity(s.name, sev === null ? (s.severity ?? 1) : null)}
                          >
                            {sev === null ? 'dropped' : '✕'}
                          </button>
                        </span>
                        {sev !== null && (
                          <span className="font-mono text-[11px] text-sky-300">
                            → {statusTag(s, sev)}
                          </span>
                        )}
                      </div>
                    );
                  })}

                </div>
              )}

              {/* The ledger — and it hangs outside the target block on
                  purpose (TEL-98). A turn aimed at nobody still costs
                  its actor and still belongs in the log; gating this
                  row on a target is what left hiding, repositioning and
                  readying unrecorded, and the assistant reads the log.

                  The arithmetic the book asks for is shown before it is
                  done to anybody. Rule 1: teller proposes the
                  subtraction; pressing it is the Warden's. */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-stone-950/60 px-3 py-2">
                {target ? (
                  <span className="font-mono text-[11px] text-stone-400">
                    {hits} − {blocked} ={' '}
                    <span className="text-base text-amber-200">{damage}</span> damage
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-stone-500">nobody is hit</span>
                )}
                {/* What the ACTOR pays, in TWO numbers rather than one.
                    The printed cost is teller's to fill in; what the
                    turn spent getting there is a ruling about distance,
                    speed and ground that only the person who watched it
                    can make. Adding them together lost which was which,
                    and the history is read by a model that then priced
                    a free ability at a Grit. */}
                {a.spend && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-stone-400">
                    <span className="text-stone-600">action</span>
                    <button
                      className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                      onClick={() =>
                        onAdvice({
                          ...a,
                          spend: { ...a.spend!, amount: Math.max(0, a.spend!.amount - 1) },
                          applied: false,
                        })
                      }
                      aria-label="action costs less"
                    >
                      −
                    </button>
                    <span className="text-amber-200">{a.spend.amount}</span>
                    <button
                      className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                      onClick={() =>
                        onAdvice({
                          ...a,
                          spend: { ...a.spend!, amount: a.spend!.amount + 1 },
                          applied: false,
                        })
                      }
                      aria-label="action costs more"
                    >
                      +
                    </button>
                    <span className="text-stone-600">{a.spend.counter}</span>
                  </span>
                )}
                {costCounter && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-stone-400">
                    <span className="text-stone-600">moving</span>
                    <button
                      className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                      onClick={() =>
                        onAdvice({
                          ...a,
                          moved: Math.max(0, (a.moved ?? 0) - 1),
                          applied: false,
                        })
                      }
                      aria-label="moved less"
                    >
                      −
                    </button>
                    <span className={(a.moved ?? 0) > 0 ? 'text-amber-200' : 'text-stone-600'}>
                      {a.moved ?? 0}
                    </span>
                    <button
                      className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                      onClick={() =>
                        onAdvice({ ...a, moved: (a.moved ?? 0) + 1, applied: false })
                      }
                      aria-label="moved more"
                    >
                      +
                    </button>
                    <span className="text-stone-600">{costCounter}</span>
                  </span>
                )}
                <button
                  className={`ml-auto ${a.applied ? btn : btnPrimary} text-xs`}
                  onClick={apply}
                >
                  {a.applied
                    ? 'recorded ✓'
                    : target
                      ? `apply to ${target.name}`
                      : 'record this turn'}
                </button>
              </div>
            </div>
          )}

          {/* 3 — anything teller couldn't know, then the words */}
          {onNarrate && foe && (a.roll || a.suggestion) && (
            <div className="mt-3 border-t border-stone-800 pt-2.5">
              {step(3, 'anything else, then read it out')}
              <div className="mt-2 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-[12px] text-stone-200 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none"
                  placeholder="knocked prone, dragged into the shallows…"
                  value={a.result ?? ''}
                  onChange={(e) => onAdvice({ ...a, result: e.target.value })}
                  onKeyDown={(e) =>
                    e.key === 'Enter' &&
                    onNarrate(
                      a.suggestion?.action ?? a.roll?.for ?? '',
                      exchange(),
                      a.suggestion?.preface,
                    )
                  }
                />
                <button
                  className={`${btnPrimary} shrink-0 text-xs ${a.narrating ? 'animate-pulse' : ''}`}
                  disabled={a.narrating || (!rolled && !a.result?.trim())}
                  onClick={() =>
                    onNarrate(
                      a.suggestion?.action ?? a.roll?.for ?? '',
                      exchange(),
                      a.suggestion?.preface,
                    )
                  }
                >
                  tell it ⟶
                </button>
              </div>
              {rolled && (
                <p className="mt-1.5 font-mono text-[10px] leading-snug text-stone-600">
                  {exchange()}
                </p>
              )}
            </div>
          )}

          {/* The back bookend, matched to the front one on purpose:
              same rule, same serif, so the two things you SAY look
              like a pair with the dice sitting between them. */}
          {a.narration && (
            <blockquote className="mt-3 border-l-2 border-amber-600 pl-3">
              <span className="font-mono text-[9px] uppercase tracking-widest text-stone-600">
                read aloud — what happened
              </span>
              <p className="font-serif text-[17px] leading-relaxed text-amber-50">
                {a.narration.narration}
              </p>
            </blockquote>
          )}
        </div>
      )}
    </div>
  );
}

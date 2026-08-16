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
  parseAttacks,
  parseDefense,
  statusTag,
  weaponAttacks,
  type StatStatus,
} from '../lib/statblock';
import { btn, btnPrimary } from '../lib/ui';
import { DicePool, rollPool, type DieArt } from './DicePool';
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
   * What the actor pays, and out of which counter. Taken from the
   * printed line and then the Warden's — a turn usually also costs
   * MOVEMENT, which is a judgment about distance, speed and ground
   * that only they can make, so the number is theirs to raise.
   */
  spend?: { counter: string; amount: number };
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
  onSuggest?: () => void;
  onNarrate?: (action: string, result: string, preface?: string) => void;
  onPatchCharacter: (id: string, patch: { data?: Partial<Character['data']> }) => void;
  /** Land the exchange and record who did it — see EncounterPanel. */
  onResolve: (body: {
    actorId: string;
    targetId: string;
    action: string;
    hits: number;
    blocked: number;
    damage: number;
    statuses: { name: string; severity: number }[];
    spend?: { counter: string; amount: number };
  }) => void;
  /**
   * The pack's item entries by id, so a carried weapon can be read for
   * its dice — a person's attacks are their GEAR, and the character's
   * copy only references the catalogue.
   */
  catalog: Map<string, { name: string; kind?: string; fields?: { key: string; value: string }[] }>;
}) {
  const a = advice ?? {};
  const foe = character.kind === 'npc';
  // A printed statblock for a creature, carried weapons for a person —
  // and both, for anything that has both.
  const attacks = [
    ...parseAttacks(fieldOf(character, 'attacks')),
    ...weaponAttacks(character.data.items ?? [], catalog),
  ];
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
  const apply = () => {
    if (!target) return;
    const vital = vitalOf(target);
    onResolve({
      actorId: character.id,
      targetId: target.id,
      action: a.roll?.for ?? 'an attack',
      hits,
      blocked,
      damage,
      statuses: statuses
        .map((s) => ({ name: s.name, severity: severityOf(s) }))
        .filter((s): s is { name: string; severity: number } => s.severity !== null),
      ...(a.spend && a.spend.amount > 0 ? { spend: a.spend } : {}),
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
    <div className="space-y-2.5">
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
        {attacks.length > 0 && (
          <div className="mt-3 border-t border-stone-800 pt-2.5">
            <span className="text-[10px] uppercase tracking-widest text-stone-600">
              What it does
            </span>
            <div className="mt-1.5">{attackChips}</div>
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
              onClick={onSuggest}
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
          {a.suggestion && !a.roll && attacks.length > 0 && (
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

                  {/* The arithmetic the book asks for, shown before it
                      is done to anybody. Rule 1: teller proposes the
                      subtraction; pressing it is the Warden's. */}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-950/60 px-3 py-2">
                    <span className="font-mono text-[11px] text-stone-400">
                      {hits} − {blocked} ={' '}
                      <span className="text-base text-amber-200">{damage}</span> damage
                    </span>
                    {/* What the ACTOR pays. The printed cost is the
                        floor; a turn usually also bought movement, and
                        how much is a ruling about distance, speed and
                        ground — so teller fills in what the book says
                        and leaves the rest to the person who watched
                        it happen. */}
                    {a.spend && (
                      <span className="flex items-center gap-1 font-mono text-[11px] text-stone-400">
                        <span className="text-stone-600">spends</span>
                        <button
                          className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                          onClick={() =>
                            onAdvice({
                              ...a,
                              spend: { ...a.spend!, amount: Math.max(0, a.spend!.amount - 1) },
                              applied: false,
                            })
                          }
                          aria-label="spend less"
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
                          aria-label="spend more"
                        >
                          +
                        </button>
                        <span className="text-stone-600">{a.spend.counter}</span>
                      </span>
                    )}
                    <button
                      className={`ml-auto ${a.applied ? btn : btnPrimary} text-xs`}
                      onClick={apply}
                    >
                      {a.applied ? 'applied ✓' : `apply to ${target.name}`}
                    </button>
                  </div>
                </div>
              )}
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

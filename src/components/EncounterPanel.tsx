import { useState } from 'react';
import type { SourcedNpc } from '../../worker/bestiary';
import type {
  Character,
  CharacterData,
  Counter,
  EncounterState,
  InitiativeEntry,
  SessionOp,
  SessionState,
  TurnNarration,
  TurnSuggestion,
} from '../../worker/types';
import { newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { QuickSpawn } from './BestiaryPanel';
import { STATE_EFFECTS } from './token-visuals';

// The encounter: turn order, plus everything you reach for while it's
// running. Order is still a manually arranged list — teller models no
// system's initiative mechanics; the table decides and the DM matches.
//
// What's new here is reach: the vital counter is one tap away, states
// are one tap away, and a combatant's token is one tap from existing.
// Nothing computes: teller may OFFER a state when a counter crosses a
// line, but only the DM applies it (rules 1 and 2).

/** The counter a state watches, else the first bounded one. */
function vitalCounter(
  counters: Counter[],
  states: EncounterState[],
): Counter | undefined {
  const watched = states
    .map((s) => s.suggest?.counter?.toLowerCase())
    .filter(Boolean) as string[];
  const named = counters.find((c) => watched.includes(c.name.toLowerCase()));
  return named ?? counters.find((c) => c.max !== null && c.max > 0);
}

/** States whose line this character has crossed but hasn't been given. */
function suggestions(
  character: Character,
  states: EncounterState[],
): EncounterState[] {
  return states.filter((state) => {
    if (!state.suggest) return false;
    if (character.data.tags.includes(state.name)) return false;
    const counter = character.data.counters.find(
      (c) => c.name.toLowerCase() === state.suggest!.counter.toLowerCase(),
    );
    if (!counter || counter.max === null || counter.max <= 0) return false;
    return counter.current / counter.max <= state.suggest.atOrBelow;
  });
}

export function EncounterPanel({
  session,
  characters,
  states,
  npcs,
  tokenLinks,
  onOp,
  onPatchCharacter,
  onDropToken,
  onSpawn,
  onRollNpcs,
  onSuggest,
  onNarrate,
}: {
  session: SessionState | null;
  characters: Character[];
  states: EncounterState[];
  /** The bestiary — stamp these out into the fight. */
  npcs: SourcedNpc[];
  /** Character ids that already have a token on the active scene. */
  tokenLinks: Set<string>;
  onOp: (op: SessionOp) => void;
  onPatchCharacter: (id: string, patch: { data?: Partial<CharacterData> }) => void;
  onDropToken: (characterId: string, label: string) => void;
  onSpawn: (npcId: string, count: number) => void;
  /** Open the rolling phase and roll for the monsters in one act. */
  onRollNpcs: () => void;
  /**
   * Ask Teller what a foe would do (TEL-86). Absent when no assistant
   * is configured, and the button simply doesn't exist — an
   * unconfigured host never nags (rule 7).
   */
  onSuggest?: (characterId: string) => Promise<TurnSuggestion>;
  /**
   * The second click (Brian's two-step): the Warden runs the action
   * with REAL dice, types what the table rolled, and Teller hands back
   * words to read aloud. Absent alongside onSuggest.
   */
  onNarrate?: (
    characterId: string,
    action: string,
    result: string,
  ) => Promise<TurnNarration>;
}) {
  const [draft, setDraft] = useState('');
  /** Rows opened to show the whole sheet. Running a monster shouldn't
   *  mean leaving the fight to go and read it. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  /**
   * Teller's proposals, per ROW — keyed by entry id, not character id,
   * so two wolves stamped from one blueprint are advised apart. Local
   * state on purpose: a suggestion is words on the Warden's screen,
   * never session state, and dismissing one leaves no trace anywhere.
   */
  const [advice, setAdvice] = useState<
    Record<
      string,
      {
        busy: boolean;
        suggestion?: TurnSuggestion;
        error?: string;
        /** The Warden's own record of what the dice said. */
        result?: string;
        narrating?: boolean;
        narration?: TurnNarration;
      }
    >
  >({});
  const ask = (entryId: string, characterId: string) => {
    if (!onSuggest) return;
    setAdvice((prev) => ({
      ...prev,
      [entryId]: { busy: true, suggestion: prev[entryId]?.suggestion },
    }));
    onSuggest(characterId)
      // A fresh suggestion starts a fresh turn: whatever results or
      // narration the LAST turn earned would be stale under it.
      .then((s) =>
        setAdvice((prev) => ({ ...prev, [entryId]: { busy: false, suggestion: s } })),
      )
      .catch((e) =>
        setAdvice((prev) => ({
          ...prev,
          [entryId]: { busy: false, error: (e as Error).message },
        })),
      );
  };
  const tell = (entryId: string, characterId: string) => {
    const a = advice[entryId];
    if (!onNarrate || !a?.suggestion || !a.result?.trim()) return;
    setAdvice((prev) => ({
      ...prev,
      [entryId]: { ...prev[entryId], busy: false, narrating: true },
    }));
    onNarrate(characterId, a.suggestion.action, a.result.trim())
      .then((n) =>
        setAdvice((prev) => ({
          ...prev,
          [entryId]: { ...prev[entryId], narrating: false, narration: n },
        })),
      )
      .catch((e) =>
        setAdvice((prev) => ({
          ...prev,
          [entryId]: { ...prev[entryId], narrating: false, error: (e as Error).message },
        })),
      );
  };
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const running = turn !== null;

  const set = (entries: InitiativeEntry[]) => onOp({ op: 'set', initiative: entries });

  const addEntry = (label: string, characterId: string | null) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    set([...initiative, { id: newLocalId('ini'), characterId, label: trimmed }]);
    setDraft('');
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...initiative];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set(next);
  };

  const bump = (character: Character, counter: Counter, delta: number) => {
    const current = Math.max(
      0,
      counter.max !== null
        ? Math.min(counter.max, counter.current + delta)
        : counter.current + delta,
    );
    onPatchCharacter(character.id, {
      data: {
        counters: character.data.counters.map((c) =>
          c.id === counter.id ? { ...c, current } : c,
        ),
      },
    });
  };

  const toggleTag = (character: Character, tag: string) => {
    const has = character.data.tags.includes(tag);
    onPatchCharacter(character.id, {
      data: {
        tags: has
          ? character.data.tags.filter((t) => t !== tag)
          : [...character.data.tags, tag],
      },
    });
  };

  const rolling = session?.rolling ?? false;
  /** Who hasn't reported a roll yet — null is "hasn't", not a real 0. */
  const waiting = initiative.filter((e) => typeof e.score !== 'number');

  const unlistedPcs = characters.filter(
    (c) => c.kind === 'pc' && !initiative.some((e) => e.characterId === c.id),
  );

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Encounter</span>
        {running && (
          <span className="rounded bg-amber-950 px-2 py-0.5 font-mono text-xs text-amber-300">
            round {session?.round}
          </span>
        )}
      </div>

      {initiative.length === 0 && (
        <p className="text-sm text-stone-600">
          add combatants, arrange to match the table, then start
        </p>
      )}

      {/*
        Taking rolls. Players roll real dice and type what they got on
        their own seat — the dice stay physical, only the arithmetic
        goes virtual. teller has already rolled for anything it deployed.
      */}
      {initiative.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
          {rolling ? (
            <>
              <span className="font-mono text-xs text-amber-300">taking rolls</span>
              {/* The names live on the rows now; this only has to say
                  how many are left, and go quiet when none are. */}
              <span
                className={`font-mono text-[11px] ${
                  waiting.length ? 'text-stone-400' : 'text-emerald-400'
                }`}
              >
                {waiting.length
                  ? `${waiting.length} still to roll`
                  : 'everyone is in'}
              </span>
              <button
                className={`${btn} ml-auto text-xs`}
                onClick={() => onOp({ op: 'rolling', on: false })}
              >
                done
              </button>
            </>
          ) : (
            <>
              <span className="font-mono text-[11px] text-stone-600">
                seats can enter their own initiative
              </span>
              <button
                className={`${btn} ml-auto text-xs`}
                onClick={() => onRollNpcs()}
                title="clear every score and ask each seat for a fresh roll"
              >
                roll initiative
              </button>
            </>
          )}
        </div>
      )}

      <ol className="space-y-1.5">
        {initiative.map((entry, index) => {
          const character = entry.characterId
            ? characters.find((c) => c.id === entry.characterId)
            : null;
          const counter = character
            ? vitalCounter(character.data.counters, states)
            : undefined;
          const offers = character ? suggestions(character, states) : [];
          const isTurn = index === turn;
          // Mid-roll, the LIST is the status board: a row still owed a
          // number says so on the row, not in a sentence above it.
          const owed = rolling && typeof entry.score !== 'number';
          return (
            <li
              key={entry.id}
              className={`space-y-1.5 rounded-md px-2 py-1.5 ${
                owed
                  ? 'bg-stone-900 text-stone-300 ring-1 ring-amber-600/70'
                  : isTurn
                    ? 'bg-amber-900/40 text-amber-100 ring-1 ring-amber-700'
                    : 'bg-stone-900 text-stone-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="w-5 text-right font-mono text-xs text-stone-500">
                  {index + 1}
                </span>

                {/* The score sits where the position number would go
                    once a fight is running: during rolls it's the thing
                    you're scanning for. */}
                {rolling &&
                  (owed ? (
                    <>
                      <span
                        className="animate-pulse rounded bg-amber-700 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-stone-950"
                        title="hasn't rolled yet"
                      >
                        ROLL
                      </span>
                      {/* Not everyone has a panel in front of them. The
                          Warden can take a number called across the
                          table without leaving the order. */}
                      <input
                        className="w-12 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-xs text-stone-100 focus:outline-none"
                        inputMode="numeric"
                        placeholder="—"
                        aria-label={`${entry.label} rolled`}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          const n = Number(e.currentTarget.value.trim());
                          if (!Number.isFinite(n)) return;
                          onOp({ op: 'score', entryId: entry.id, score: n });
                          e.currentTarget.value = '';
                        }}
                      />
                    </>
                  ) : (
                    <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
                      {entry.score}
                    </span>
                  ))}
                {character ? (
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm hover:text-stone-100"
                    onClick={() => toggleOpen(entry.id)}
                    title="show the whole sheet"
                  >
                    {entry.label}
                    <span className="ml-1.5 font-mono text-[10px] text-stone-600">
                      {open.has(entry.id) ? '▾' : '▸'}
                    </span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
                )}

                {counter && character && (
                  <span className="flex items-center gap-1">
                    <button
                      className={btnGhost}
                      onClick={() => bump(character, counter, -1)}
                      aria-label={`${counter.name} down`}
                    >
                      −
                    </button>
                    <span className="min-w-14 text-center font-mono text-xs">
                      {counter.current}
                      {counter.max !== null && (
                        <span className="text-stone-500">/{counter.max}</span>
                      )}
                    </span>
                    <button
                      className={btnGhost}
                      onClick={() => bump(character, counter, 1)}
                      aria-label={`${counter.name} up`}
                    >
                      +
                    </button>
                  </span>
                )}

                {/* Ask Teller. Foes only — the posse plays itself. */}
                {onSuggest && character && character.kind === 'npc' && (
                  <button
                    className={`${btnGhost} ${advice[entry.id]?.busy ? 'animate-pulse text-amber-300' : ''}`}
                    title="what would they do? Teller proposes; you decide"
                    disabled={advice[entry.id]?.busy}
                    onClick={() => ask(entry.id, character.id)}
                  >
                    ✦
                  </button>
                )}

                {character &&
                  (tokenLinks.has(character.id) ? (
                    <span
                      className="px-1 text-xs text-stone-500"
                      title="has a token on the live scene"
                    >
                      ◉
                    </span>
                  ) : (
                    <button
                      className={btnGhost}
                      title="drop a token for this combatant on the live scene"
                      onClick={() => onDropToken(character.id, entry.label)}
                    >
                      ◌
                    </button>
                  ))}

                <button className={btnGhost} onClick={() => move(index, -1)} aria-label="move up">
                  ↑
                </button>
                <button className={btnGhost} onClick={() => move(index, 1)} aria-label="move down">
                  ↓
                </button>
                <button
                  className={`${btnGhost} hover:text-red-300`}
                  onClick={() => set(initiative.filter((e) => e.id !== entry.id))}
                  aria-label="remove"
                >
                  ✕
                </button>
              </div>

              {character && open.has(entry.id) && (
                <div className="space-y-1.5 pl-6 pr-1">
                  {character.data.fields.filter((f) => f.value).length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {character.data.fields
                        .filter((f) => f.value)
                        .map((f) => (
                          <span key={f.key} className="font-mono text-[11px]">
                            <span className="text-stone-500">{f.label} </span>
                            <span className="text-stone-200">{f.value}</span>
                          </span>
                        ))}
                    </div>
                  )}
                  {/* Every other counter, not just the vital one. */}
                  {character.data.counters
                    .filter((c) => c.id !== counter?.id)
                    .map((c) => (
                      <div key={c.id} className="flex items-center gap-1">
                        <span className="min-w-20 font-mono text-[11px] text-stone-500">
                          {c.name}
                        </span>
                        <button
                          className={btnGhost}
                          onClick={() => bump(character, c, -1)}
                          aria-label={`${c.name} down`}
                        >
                          −
                        </button>
                        <span className="min-w-10 text-center font-mono text-[11px]">
                          {c.current}
                          {c.max !== null && (
                            <span className="text-stone-500">/{c.max}</span>
                          )}
                        </span>
                        <button
                          className={btnGhost}
                          onClick={() => bump(character, c, 1)}
                          aria-label={`${c.name} up`}
                        >
                          +
                        </button>
                      </div>
                    ))}
                  {character.data.notes && (
                    <p className="whitespace-pre-wrap text-[11px] leading-snug text-stone-400">
                      {character.data.notes}
                    </p>
                  )}
                </div>
              )}

              {character && (states.length > 0 || offers.length > 0) && (
                <div className="flex flex-wrap items-center gap-1 pl-6">
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
                  {/* teller asks; the DM decides. It never applies itself. */}
                  {offers.map((state) => (
                    <button
                      key={`offer-${state.name}`}
                      className="rounded-full border border-amber-600 px-2 py-0.5 font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-900/40"
                      onClick={() => toggleTag(character, state.name)}
                      title="teller noticed the threshold — applying it is your call"
                    >
                      {state.name}?
                    </button>
                  ))}
                </div>
              )}

              {/*
                Teller's proposal — words on a card, deliberately with
                no apply button anywhere on it. The Warden speaks the
                turn (or doesn't); the card can only be redrawn or
                waved away. Premises come first because they're the
                part that can be WRONG: virtual tokens are only as
                fresh as the last drag, so the assumptions are shown
                for checking before the action is worth reading.
              */}
              {character && (advice[entry.id]?.suggestion || advice[entry.id]?.error) && (
                <div className="ml-6 space-y-1 rounded-md border border-amber-700/50 bg-amber-950/20 px-2.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-amber-400">
                      ✦ teller suggests
                    </span>
                    {advice[entry.id]?.suggestion && (
                      <span className="font-mono text-[10px] text-stone-600">
                        {advice[entry.id].suggestion!.model}
                      </span>
                    )}
                    <button
                      className={`${btnGhost} ml-auto`}
                      title="ask again"
                      disabled={advice[entry.id]?.busy}
                      onClick={() => ask(entry.id, character.id)}
                    >
                      ↻
                    </button>
                    <button
                      className={btnGhost}
                      title="wave it away"
                      onClick={() =>
                        setAdvice((prev) => {
                          const next = { ...prev };
                          delete next[entry.id];
                          return next;
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                  {advice[entry.id]?.error ? (
                    <p className="text-[11px] text-red-300">{advice[entry.id].error}</p>
                  ) : (
                    <>
                      {advice[entry.id].suggestion!.premises.length > 0 && (
                        <ul className="space-y-0.5">
                          {advice[entry.id].suggestion!.premises.map((p, i) => (
                            <li key={i} className="text-[11px] italic text-stone-400">
                              assuming {p}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-sm leading-snug text-amber-100">
                        {advice[entry.id].suggestion!.action}
                      </p>
                      {advice[entry.id].suggestion!.rationale && (
                        <p className="text-[11px] leading-snug text-stone-400">
                          {advice[entry.id].suggestion!.rationale}
                        </p>
                      )}

                      {/*
                        The second click. The Warden runs the action
                        with the table's REAL dice, types what they
                        said, and Teller hands back words to read
                        aloud — narration is downstream of dice, never
                        a substitute for them (the thesis, in prose).
                      */}
                      {onNarrate && (
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <input
                            className="min-w-0 flex-1 rounded bg-stone-900 px-2 py-1 font-mono text-[11px] text-stone-200 placeholder:text-stone-600 focus:outline-none"
                            placeholder="what the dice said — hits, damage dealt, statuses…"
                            value={advice[entry.id].result ?? ''}
                            onChange={(e) =>
                              setAdvice((prev) => ({
                                ...prev,
                                [entry.id]: { ...prev[entry.id], result: e.target.value },
                              }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && tell(entry.id, character.id)}
                          />
                          <button
                            className={`${btnGhost} ${advice[entry.id].narrating ? 'animate-pulse text-amber-300' : ''}`}
                            title="turn the results into words for the table"
                            disabled={advice[entry.id].narrating || !advice[entry.id].result?.trim()}
                            onClick={() => tell(entry.id, character.id)}
                          >
                            tell it ⟶
                          </button>
                        </div>
                      )}
                      {advice[entry.id].narration && (
                        <blockquote className="border-l-2 border-amber-600 pl-2.5 text-[13px] italic leading-snug text-stone-100">
                          {advice[entry.id].narration!.narration}
                        </blockquote>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <QuickSpawn npcs={npcs} onSpawn={onSpawn} />

      {/*
        Only people. Foes arrive in the order already — deploy seats what
        it stamps, and a bestiary spawn does the same — so a foe down
        here would mean something went wrong, not something to tidy up.

        These are NOT the bestiary search above: that STAMPS OUT a new
        creature, this seats one that already exists. They used to be
        identical chips side by side, and hitting the wrong one mid-fight
        spawned a monster.
      */}
      {unlistedPcs.length > 0 && (
        <div className="space-y-1.5 rounded-md bg-stone-900/60 px-2 py-2">
          <span className={sectionLabel}>Not in the order yet</span>
          <div className="flex flex-wrap gap-1.5">
            {unlistedPcs.map((c) => (
              <button
                key={c.id}
                className={btnGhost}
                onClick={() => addEntry(c.name, c.id)}
                title={`put ${c.name} in the turn order`}
              >
                + {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="ad-hoc: 3 prairie wolves…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addEntry(draft, null)}
        />
        <button className={btn} onClick={() => addEntry(draft, null)}>
          add
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          className={btnPrimary}
          disabled={initiative.length === 0}
          onClick={() => onOp({ op: 'next' })}
        >
          {running ? 'next turn ▸' : 'start combat'}
        </button>
        <button className={btn} disabled={!running} onClick={() => onOp({ op: 'prev' })}>
          ◂ back
        </button>
        <button
          className={`${btn} ml-auto hover:bg-red-950`}
          disabled={!running}
          onClick={() => onOp({ op: 'end' })}
        >
          end
        </button>
      </div>
    </section>
  );
}

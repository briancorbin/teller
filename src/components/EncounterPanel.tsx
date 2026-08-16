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
  SystemTemplate,
  TurnNarration,
  TurnSuggestion,
} from '../../worker/types';
import { newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { QuickSpawn } from './BestiaryPanel';
import { CreatureSheet } from './CreatureSheet';
import { TurnStage, type Advice } from './TurnStage';
import { VitalBar } from './Vitals';
import type { DieArt } from './DicePool';
import { STATE_EFFECTS } from './token-visuals';

// The encounter, as two different tools wearing one panel.
//
// STAGING and RUNNING are not the same job, and the panel used to look
// identical doing both — eleven controls on every row of eight, with
// the bestiary and the whole unseated posse holding permanent ground
// underneath a fight in progress. Now the roster is a thing you SCAN
// (one line, a bar, a dot) and the stage is the one combatant you're
// actually operating. Setup folds away the moment a fight starts.
//
// The split is driven by a CONTAINER query, not a breakpoint: this
// panel is the whole pane on a desktop console and a 22rem sidebar in
// the full console, and it should answer to its own width rather than
// to a list of devices that the client deliberately doesn't keep.

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
  onResolve,
  onDropToken,
  onSpawn,
  onRollNpcs,
  onSuggest,
  onNarrate,
  dice,
  dieArt,
  catalog,
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
  /**
   * Land an exchange: damage and statuses onto the target, and one
   * attributed line into the log. Separate from `onPatchCharacter`
   * because the log has to know a FOE did this to a PERSON, not that
   * the dm edited some counters (rule 3, finally saying who).
   */
  onResolve: (body: {
    actorId: string;
    /** Absent for a turn aimed at nobody — moving, hiding, waiting. */
    targetId?: string;
    action: string;
    hits: number;
    blocked: number;
    damage: number;
    statuses: { name: string; severity: number }[];
    /** What the ACTOR pays for the turn, out of which counter. */
    spend?: { counter: string; amount: number };
  }) => void;
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
   * with REAL dice, records what the table rolled, and Teller hands
   * back words to read aloud. Absent alongside onSuggest.
   */
  onNarrate?: (
    characterId: string,
    action: string,
    result: string,
    preface?: string,
  ) => Promise<TurnNarration>;
  /** The system's dice, so a suggested roll renders as tappable dice. */
  dice?: SystemTemplate['dice'];
  /**
   * The book's own die-face art, exactly as the character creator
   * shows it — `creation.marks` from whichever pack carries it, plus
   * the pack version for cache-busting. Absent = text chips.
   */
  dieArt?: DieArt;
  /** The pack's items by id — a person's attacks are their gear. */
  catalog: Map<string, { name: string; kind?: string; fields?: { key: string; value: string }[] }>;
}) {
  const [draft, setDraft] = useState('');
  /**
   * The row whose full sheet is open, if any. A DIALOG now rather than
   * an in-place expansion: a printed statblock unrolled inside a 15rem
   * column was every fact and no shape (Brian, 2026-08-15).
   */
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  /** Setup, while a fight is running — closed by default, on purpose. */
  const [setupOpen, setSetupOpen] = useState(false);
  /**
   * Teller's proposals, per ROW — keyed by entry id, not character id,
   * so two wolves stamped from one blueprint are advised apart. Local
   * state on purpose: a suggestion is words on the Warden's screen,
   * never session state, and dismissing one leaves no trace anywhere.
   */
  const [advice, setAdvice] = useState<Record<string, Advice>>({});

  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const running = turn !== null;
  const rolling = session?.rolling ?? false;
  /** Who hasn't reported a roll yet — null is "hasn't", not a real 0. */
  const waiting = initiative.filter((e) => typeof e.score !== 'number');

  const patchAdvice = (entryId: string, patch: Advice | null) =>
    setAdvice((prev) => {
      if (patch === null) {
        const next = { ...prev };
        delete next[entryId];
        return next;
      }
      return { ...prev, [entryId]: patch };
    });

  const ask = (entryId: string, characterId: string) => {
    if (!onSuggest) return;
    setAdvice((prev) => ({ ...prev, [entryId]: { ...prev[entryId], busy: true } }));
    onSuggest(characterId)
      // A fresh suggestion starts a fresh turn: whatever results or
      // narration the LAST one earned would be stale under it. The
      // model's named target is taken as the OPENING guess only.
      .then((s) =>
        setAdvice((prev) => ({
          ...prev,
          [entryId]: {
            busy: false,
            suggestion: s,
            ...(s.roll ? { roll: { dice: s.roll.dice, for: s.roll.for } } : {}),
            ...(s.target
              ? {
                  targetId: characters.find(
                    (c) =>
                      c.name.toLowerCase() === s.target!.toLowerCase() ||
                      initiative.some(
                        (e) =>
                          e.characterId === c.id &&
                          e.label.toLowerCase() === s.target!.toLowerCase(),
                      ),
                  )?.id,
                }
              : {}),
          },
        })),
      )
      .catch((e) =>
        setAdvice((prev) => ({
          ...prev,
          [entryId]: { ...prev[entryId], busy: false, error: (e as Error).message },
        })),
      );
  };

  const tell = (
    entryId: string,
    characterId: string,
    action: string,
    result: string,
    preface?: string,
  ) => {
    if (!onNarrate || !result.trim()) return;
    setAdvice((prev) => ({ ...prev, [entryId]: { ...prev[entryId], narrating: true } }));
    onNarrate(characterId, action, result, preface)
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

  const unlistedPcs = characters.filter(
    (c) => c.kind === 'pc' && !initiative.some((e) => e.characterId === c.id),
  );

  const active = turn !== null ? initiative[turn] : undefined;
  const actor = active?.characterId
    ? characters.find((c) => c.id === active.characterId)
    : undefined;
  /** Whoever the acting turn is currently aimed at — lit in the roster. */
  const aimedAt = active ? advice[active.id]?.targetId : undefined;

  // -------------------------------------------------------------- roster

  const rosterRow = (entry: InitiativeEntry, index: number) => {
    const character = entry.characterId
      ? characters.find((c) => c.id === entry.characterId)
      : null;
    const counter = character ? vitalCounter(character.data.counters, states) : undefined;
    const offers = character ? suggestions(character, states) : [];
    const isTurn = index === turn;
    const isTarget = character?.id === aimedAt;
    const foe = character?.kind === 'npc';
    // Mid-roll, the LIST is the status board: a row still owed a
    // number says so on the row, not in a sentence above it.
    const owed = rolling && typeof entry.score !== 'number';
    const dots = states.filter((s) => character?.data.tags.includes(s.name));
    const extra = character
      ? character.data.tags.filter((t) => !states.some((s) => s.name === t))
      : [];

    return (
      <li
        key={entry.id}
        className={`group border-l-2 py-1.5 pl-2 pr-1.5 transition-colors ${
          owed
            ? 'border-l-amber-500 bg-stone-900'
            : isTurn
              ? 'border-l-amber-600 bg-amber-950/40'
              : isTarget
                ? 'border-l-sky-700 bg-sky-950/20'
                : foe
                  ? 'border-l-red-900/70 bg-stone-900/40 hover:bg-stone-900'
                  : 'border-l-stone-700 bg-stone-900/40 hover:bg-stone-900'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`w-4 shrink-0 text-right font-mono text-[10px] ${
              isTurn ? 'text-amber-300' : 'text-stone-600'
            }`}
          >
            {index + 1}
          </span>

          {/* During rolls the score sits where the position number is:
              it's the thing you're scanning for. */}
          {rolling &&
            (owed ? (
              <>
                <span
                  className="animate-pulse rounded bg-amber-700 px-1 py-0.5 font-mono text-[9px] font-semibold text-stone-950"
                  title="hasn't rolled yet"
                >
                  ROLL
                </span>
                <input
                  className="w-10 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-[11px] text-stone-100 focus:outline-none"
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
              <span className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[10px] text-amber-300">
                {entry.score}
              </span>
            ))}

          {character ? (
            <button
              className={`min-w-0 flex-1 truncate text-left text-[13px] ${
                isTurn ? 'text-amber-100' : 'text-stone-300 hover:text-stone-100'
              }`}
              onClick={() => setSheetFor(entry.id)}
              title="everything about them"
            >
              {entry.label}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[13px] text-stone-300">
              {entry.label}
            </span>
          )}

          {/* Conditions, as colour. The chips live on the stage. */}
          <span className="flex shrink-0 items-center gap-0.5">
            {dots.map((s) => (
              <span
                key={s.name}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: STATE_EFFECTS[s.effect ?? 'mark'].chip }}
                title={s.name}
              />
            ))}
            {extra.length > 0 && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-sky-400"
                title={extra.join(', ')}
              />
            )}
            {offers.length > 0 && (
              <span
                className="font-mono text-[10px] text-amber-500"
                title={`${offers.map((o) => o.name).join(', ')} — teller noticed the line`}
              >
                ?
              </span>
            )}
          </span>

          {/* The edit you make most often is to somebody ELSE'S health,
              on the turn of the thing that just hit them. So it lives
              here, on the row, and never costs you the stage. */}
          {counter && character && (
            <span
              className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
                isTurn || isTarget
                  ? ''
                  : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
              }`}
            >
              <button
                className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                onClick={() => bump(character, counter, -1)}
                aria-label={`${counter.name} down`}
              >
                −
              </button>
              <span className="min-w-9 text-center font-mono text-[11px] text-stone-300">
                {counter.current}
                {counter.max !== null && (
                  <span className="text-stone-600">/{counter.max}</span>
                )}
              </span>
              <button
                className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                onClick={() => bump(character, counter, 1)}
                aria-label={`${counter.name} up`}
              >
                +
              </button>
            </span>
          )}

          {/* Whether they're on the map is worth a glyph; putting one
              there is not something you do twice a fight, so the
              button for it lives in the open row with the rest. */}
          {character && tokenLinks.has(character.id) && (
            <span className="shrink-0 px-0.5 text-[10px] text-stone-700" title="on the live scene">
              ◉
            </span>
          )}
        </div>

        {counter && <VitalBar counter={counter} className="mt-1.5" />}

      </li>
    );
  };

  // --------------------------------------------------------------- setup

  const setupTools = (
    <div className="space-y-2">
      <QuickSpawn npcs={npcs} onSpawn={onSpawn} />
      {/*
        Only people. Foes arrive in the order already — deploy seats
        what it stamps, and a bestiary spawn does the same. These are
        NOT the bestiary search above: that STAMPS OUT a new creature,
        this seats one that already exists. They used to be identical
        chips side by side, and hitting the wrong one mid-fight spawned
        a monster.
      */}
      {unlistedPcs.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-stone-900/60 px-2 py-2">
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
    </div>
  );

  const turnControls = (
    <div className="flex items-center gap-2">
      <button
        className={btn}
        disabled={!running}
        onClick={() => onOp({ op: 'prev' })}
      >
        ◂ back
      </button>
      <button
        className={`${btnPrimary} px-6`}
        disabled={initiative.length === 0}
        onClick={() => onOp({ op: 'next' })}
      >
        {running ? 'next turn ▸' : 'start combat'}
      </button>
      <button
        className={`${btn} ml-auto hover:bg-red-950`}
        disabled={!running}
        onClick={() => onOp({ op: 'end' })}
      >
        end
      </button>
    </div>
  );

  return (
    <section className={`${card} @container space-y-3`}>
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

      {/* Taking rolls. Players roll real dice and report on their own
          seat; teller has already rolled for anything it deployed. */}
      {initiative.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
          {rolling ? (
            <>
              <span className="font-mono text-xs text-amber-300">taking rolls</span>
              <span
                className={`font-mono text-[11px] ${
                  waiting.length ? 'text-stone-400' : 'text-emerald-400'
                }`}
              >
                {waiting.length ? `${waiting.length} still to roll` : 'everyone is in'}
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

      <div
        className={
          running
            ? 'grid items-start gap-4 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]'
            : 'grid items-start gap-4 @2xl:grid-cols-2'
        }
      >
        <div className="space-y-2">
          {initiative.length > 0 ? (
            <ol className="divide-y divide-stone-800/60 overflow-hidden rounded-lg">
              {initiative.map(rosterRow)}
            </ol>
          ) : (
            // Staging with nobody seated: the column that will hold the
            // order says so, rather than leaving a hole beside a full
            // one and reading as broken.
            <p className="rounded-lg border border-dashed border-stone-800 px-3 py-6 text-center text-[11px] text-stone-600">
              the turn order builds here
            </p>
          )}

          {/* While a fight runs, setup is one line until asked for. */}
          {running ? (
            <div>
              <button
                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-stone-600 transition-colors hover:bg-stone-900 hover:text-stone-300"
                onClick={() => setSetupOpen((v) => !v)}
              >
                {setupOpen ? '▾' : '▸'} add to the fight
              </button>
              {setupOpen && <div className="mt-2">{setupTools}</div>}
            </div>
          ) : (
            <div className="@2xl:hidden">{setupTools}</div>
          )}

        </div>

        <div className="space-y-3">
          {running && actor && active ? (
            <>
              <TurnStage
                character={actor}
                entry={active}
                index={turn!}
                total={initiative.length}
                round={session?.round ?? 1}
                initiative={initiative}
                characters={characters}
                states={states}
                dice={dice}
                dieArt={dieArt}
                advice={advice[active.id]}
                onAdvice={(patch) => patchAdvice(active.id, patch)}
                onSuggest={onSuggest ? () => ask(active.id, actor.id) : undefined}
                onNarrate={
                  onNarrate
                    ? (action, result, preface) =>
                        tell(active.id, actor.id, action, result, preface)
                    : undefined
                }
                onPatchCharacter={onPatchCharacter}
                onResolve={onResolve}
                catalog={catalog}
              />
              {turnControls}
            </>
          ) : running ? (
            <>
              <p className="text-sm text-stone-600">
                {active
                  ? `${active.label} is up — an ad-hoc entry, so there's no sheet to show.`
                  : 'no one is up'}
              </p>
              {turnControls}
            </>
          ) : (
            <div className="hidden @2xl:block">{setupTools}</div>
          )}
        </div>
      </div>

      {/* Staging: the way in sits under BOTH columns, because it acts on
          the order and the setup together. Running, it lives under the
          stage instead — beside the turn it advances. */}
      {!running && turnControls}

      {/* Look somebody up. The rare row actions — reorder, remove, put a
          token down — ride along here rather than crowding a row you
          read eight of at a glance. */}
      {(() => {
        const index = initiative.findIndex((e) => e.id === sheetFor);
        const entry = index >= 0 ? initiative[index] : undefined;
        const who = entry?.characterId
          ? characters.find((c) => c.id === entry.characterId)
          : undefined;
        if (!entry || !who) return null;
        return (
          <CreatureSheet
            character={who}
            npcs={npcs}
            onClose={() => setSheetFor(null)}
            onBump={(counter, delta) => bump(who, counter, delta)}
            onToggleTag={(tag) => toggleTag(who, tag)}
            actions={
              <>
                <button className={btnGhost} onClick={() => move(index, -1)} title="earlier in the order">
                  ↑
                </button>
                <button className={btnGhost} onClick={() => move(index, 1)} title="later in the order">
                  ↓
                </button>
                {!tokenLinks.has(who.id) && (
                  <button
                    className={btnGhost}
                    title="drop a token on the live scene"
                    onClick={() => onDropToken(who.id, entry.label)}
                  >
                    ◌ token
                  </button>
                )}
                <button
                  className={`${btnGhost} hover:text-red-300`}
                  onClick={() => {
                    set(initiative.filter((e) => e.id !== entry.id));
                    setSheetFor(null);
                  }}
                >
                  ✕ remove
                </button>
              </>
            }
          />
        );
      })()}
    </section>
  );
}

import { useState } from 'react';
import type {
  Character,
  CharacterData,
  Counter,
  EncounterState,
  InitiativeEntry,
  NpcBlueprint,
  SessionOp,
  SessionState,
} from '../../worker/types';
import { newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
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
}: {
  session: SessionState | null;
  characters: Character[];
  states: EncounterState[];
  /** The bestiary — stamp these out into the fight. */
  npcs: NpcBlueprint[];
  /** Character ids that already have a token on the active scene. */
  tokenLinks: Set<string>;
  onOp: (op: SessionOp) => void;
  onPatchCharacter: (id: string, patch: { data?: Partial<CharacterData> }) => void;
  onDropToken: (characterId: string, label: string) => void;
  onSpawn: (npcId: string, count: number) => void;
}) {
  const [draft, setDraft] = useState('');
  /** How many of the next thing you tap — set once, tap several. */
  const [count, setCount] = useState(1);
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

  const unlisted = characters.filter(
    (c) => !initiative.some((e) => e.characterId === c.id),
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
          return (
            <li
              key={entry.id}
              className={`space-y-1.5 rounded-md px-2 py-1.5 ${
                isTurn
                  ? 'bg-amber-900/40 text-amber-100 ring-1 ring-amber-700'
                  : 'bg-stone-900 text-stone-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="w-5 text-right font-mono text-xs text-stone-500">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>

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
            </li>
          );
        })}
      </ol>

      {npcs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-stone-600">
            bestiary
          </span>
          <span className="flex items-center gap-0.5">
            <button
              className={btnGhost}
              onClick={() => setCount((n) => Math.max(1, n - 1))}
              aria-label="fewer"
            >
              −
            </button>
            <span className="w-6 text-center font-mono text-xs text-stone-300">
              ×{count}
            </span>
            <button
              className={btnGhost}
              onClick={() => setCount((n) => Math.min(20, n + 1))}
              aria-label="more"
            >
              +
            </button>
          </span>
          {npcs.map((n) => (
            <button
              key={n.id}
              className={btnGhost}
              onClick={() => onSpawn(n.id, count)}
              title={`add ${count} × ${n.name} to the fight`}
            >
              + {n.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {unlisted.map((c) => (
          <button key={c.id} className={btnGhost} onClick={() => addEntry(c.name, c.id)}>
            + {c.name}
          </button>
        ))}
      </div>

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

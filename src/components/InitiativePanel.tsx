import { useState } from 'react';
import type { Character, InitiativeEntry, SessionOp, SessionState } from '../../worker/types';
import { newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';

// Turn order is a manually ordered list — teller never models any
// system's initiative mechanics. The table rolls/draws/whatever; the
// DM arranges the list to match.

export function InitiativePanel({
  session,
  characters,
  onOp,
}: {
  session: SessionState | null;
  characters: Character[];
  onOp: (op: SessionOp) => void;
}) {
  const [draft, setDraft] = useState('');
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

  const unlisted = characters.filter(
    (c) => !initiative.some((e) => e.characterId === c.id),
  );

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Initiative</span>
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

      <ol className="space-y-1">
        {initiative.map((entry, index) => (
          <li
            key={entry.id}
            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 ${
              index === turn
                ? 'bg-amber-900/40 text-amber-100 ring-1 ring-amber-700'
                : 'bg-stone-900 text-stone-300'
            }`}
          >
            <span className="w-5 text-right font-mono text-xs text-stone-500">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
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
          </li>
        ))}
      </ol>

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

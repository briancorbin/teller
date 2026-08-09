import { useMemo, useState } from 'react';
import type { SourcedNpc } from '../../worker/bestiary';
import { useBooks } from '../lib/use-books';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { BookReader, type BookTarget } from './BookReader';

// The bestiary: everything you could put in front of the party.
//
// A wall of buttons stopped working the moment a pack brought sixty
// foes with it, so this is a list you search rather than a row you
// scan. Open one to see what it actually is before you commit to
// dropping three of them on the table.
//
// It shows what packs bring AND what this campaign wrote itself, which
// is the merge the server already did — `from` says which, so a foe
// you've retuned is distinguishable from the one the book describes.

/** Match against the name first, then anything written on the sheet. */
function matches(npc: SourcedNpc, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  if (npc.name.toLowerCase().includes(q)) return true;
  return npc.fields.some((f) => String(f.value).toLowerCase().includes(q));
}

export function BestiaryPanel({
  npcs,
  onSpawn,
}: {
  npcs: SourcedNpc[];
  onSpawn: (npcId: string, count: number) => void;
}) {
  const { books } = useBooks();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [reading, setReading] = useState<BookTarget | null>(null);

  const found = useMemo(
    () => npcs.filter((n) => matches(n, query.trim())),
    [npcs, query],
  );

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Bestiary</span>
        <span className="font-mono text-[11px] text-stone-600">
          {query ? `${found.length} of ${npcs.length}` : `${npcs.length} foes`}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="wolf, bear, 2G…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* How many land when you pick one — set it once, then browse. */}
        <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.max(1, n - 1))}
            aria-label="fewer"
          >
            −
          </button>
          <span className="w-7 text-center font-mono text-sm text-stone-300">×{count}</span>
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.min(20, n + 1))}
            aria-label="more"
          >
            +
          </button>
        </span>
      </div>

      <ul className="space-y-1">
        {found.map((npc) => {
          const health = npc.counters.find((c) => /health|hp/i.test(c.name));
          const description = npc.fields.find((f) => f.key === 'description');
          const stats = npc.fields.filter((f) => f.key !== 'description');
          const isOpen = open === npc.id;
          // The page it's printed on — the art and the flavour a stat
          // block can't carry. Only when the book is actually here.
          const book =
            npc.page && npc.book ? books.find((b) => b.id === npc.book) : undefined;
          return (
            <li key={npc.id} className="rounded-md bg-stone-900">
              <button
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left"
                onClick={() => setOpen(isOpen ? null : npc.id)}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
                  {npc.name}
                </span>
                {health && (
                  <span className="font-mono text-[11px] text-stone-500">
                    {health.max ?? health.current} hp
                  </span>
                )}
                <span className="font-mono text-[11px] text-stone-600">
                  {npc.from ?? 'yours'}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-stone-800 px-2 py-2">
                  {stats.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {stats.map((f) => (
                        <span key={f.key} className="font-mono text-xs text-stone-400">
                          <span className="text-stone-600">{f.label}</span> {f.value}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {npc.counters.map((c) => (
                      <span key={c.id} className="font-mono text-xs text-amber-400/80">
                        <span className="text-stone-600">{c.name}</span>{' '}
                        {c.max ?? c.current}
                      </span>
                    ))}
                  </div>
                  {description && (
                    <p className="text-xs leading-relaxed text-stone-400">
                      {description.value}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <button className={btnPrimary} onClick={() => onSpawn(npc.id, count)}>
                      add {count > 1 ? `${count} ` : ''}to the fight
                    </button>
                    {book && (
                      <button
                        className={`${btnGhost} text-[11px] text-amber-400/90`}
                        onClick={() =>
                          setReading({ bookId: book.id, page: npc.page!, name: book.name })
                        }
                      >
                        {book.name} · p.{npc.page} →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {found.length === 0 && (
          <li className="text-sm text-stone-600">
            {npcs.length ? 'nothing by that name' : 'no foes yet — a pack brings them'}
          </li>
        )}
      </ul>

      {reading && <BookReader target={reading} onClose={() => setReading(null)} />}
    </section>
  );
}

/**
 * The compact version, for the encounter pane.
 *
 * Mid-fight you already know what you want, so this is a filter box and
 * the first few matches — not sixty buttons to hunt through. Browsing
 * belongs in the bestiary pane.
 */
export function QuickSpawn({
  npcs,
  onSpawn,
}: {
  npcs: SourcedNpc[];
  onSpawn: (npcId: string, count: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(1);
  const found = npcs.filter((n) => matches(n, query.trim())).slice(0, 8);

  if (!npcs.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={sectionLabel}>Bestiary</span>
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder={`search ${npcs.length} foes…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.max(1, n - 1))}
            aria-label="fewer"
          >
            −
          </button>
          <span className="w-7 text-center font-mono text-sm text-stone-300">×{count}</span>
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.min(20, n + 1))}
            aria-label="more"
          >
            +
          </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {found.map((n) => (
          <button
            key={n.id}
            className={btn}
            onClick={() => onSpawn(n.id, count)}
            title={n.from ? `${n.name} — from ${n.from}` : n.name}
          >
            + {n.name}
          </button>
        ))}
        {query && !found.length && (
          <span className="text-sm text-stone-600">nothing by that name</span>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { Character, Counter } from '../../worker/types';
import type { SourcedNpc } from '../../worker/bestiary';
import { useBooks } from '../lib/use-books';
import { btn, btnGhost, sectionLabel } from '../lib/ui';
import { BookReader, type BookTarget } from './BookReader';
import { AttackLines, PoolGrid, ProseSections } from './Statblock';
import { VitalBar } from './Vitals';

// EVERYTHING ABOUT ONE CREATURE, laid out like a page instead of a
// field dump (Brian, 2026-08-15: "a nice view to see all of the info
// about the creature we have. stats, abilities, behaviors, etc").
//
// The roster row used to expand in place, which put an entire printed
// statblock — description, behaviour, attacks, features, trophies — as
// unstyled key/value text into a 15rem column. Every fact was present
// and none of it was findable. Same data, given a shape: pools in a
// grid, attacks in bands, features as the named things they are.
//
// It's a DIALOG rather than a pane on purpose. The stage belongs to
// whoever's turn it is and must never wander (that's the whole reason
// there's no selection mode); looking something up is explicitly a
// detour, and a detour should announce itself and end.

function fieldOf(character: Character, key: string): string {
  return character.data.fields.find((f) => f.key === key)?.value ?? '';
}

export function CreatureSheet({
  character,
  npcs,
  onClose,
  onBump,
  onToggleTag,
  actions,
}: {
  character: Character;
  /** The bestiary, for the printing this creature was stamped from. */
  npcs: SourcedNpc[];
  onClose: () => void;
  onBump: (counter: Counter, delta: number) => void;
  onToggleTag: (tag: string) => void;
  /** Row actions that used to live in the expansion — move, remove. */
  actions?: React.ReactNode;
}) {
  const { books } = useBooks();
  const [reading, setReading] = useState<BookTarget | null>(null);

  // Escape closes it. A lookup you can't dismiss with the key everyone
  // reaches for is a lookup that feels like a trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const blueprint = character.data.blueprintId
    ? npcs.find((n) => n.id === character.data.blueprintId)
    : undefined;
  // Every printing this creature has, so a reprint is one tap away
  // from the one this table runs on.
  const printings = blueprint?.sources?.length
    ? blueprint.sources
    : blueprint?.page
      ? [{ packId: '', pack: blueprint.from ?? '', book: undefined, page: blueprint.page }]
      : [];

  const kz = fieldOf(character, 'kz');
  const foe = character.kind === 'npc';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/80 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-stone-800 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- who ---- */}
        <div className="flex flex-wrap items-baseline gap-2 border-b border-stone-800 px-5 py-4">
          <h2 className="font-serif text-2xl text-amber-50">{character.name}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              foe ? 'bg-red-950 text-red-300' : 'bg-stone-800 text-stone-400'
            }`}
          >
            {foe ? 'foe' : 'posse'}
          </span>
          {kz && (
            <span
              className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[10px] text-stone-400"
              title="Kryptozoological frequency"
            >
              Kz {kz}
            </span>
          )}
          <button className={`${btnGhost} ml-auto`} onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* ---- vitals ---- */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {character.data.counters
              .filter((c) => c.max !== null && c.max > 0)
              .map((c) => (
                <div key={c.id}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-stone-400">{c.name}</span>
                    <span className="ml-auto font-mono text-base text-stone-100">
                      {c.current}
                      <span className="text-stone-600">/{c.max}</span>
                    </span>
                    <span className="flex items-center gap-0.5">
                      <button
                        className="rounded px-1.5 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                        onClick={() => onBump(c, -1)}
                        aria-label={`${c.name} down`}
                      >
                        −
                      </button>
                      <button
                        className="rounded px-1.5 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                        onClick={() => onBump(c, 1)}
                        aria-label={`${c.name} up`}
                      >
                        +
                      </button>
                    </span>
                  </div>
                  <VitalBar counter={c} className="mt-1" />
                </div>
              ))}
          </div>

          {/* ---- the printed pools ---- */}
          <PoolGrid fields={character.data.fields} />

          {/* ---- conditions ---- */}
          {character.data.tags.length > 0 && (
            <div>
              <span className={sectionLabel}>Conditions</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {character.data.tags.map((t) => (
                  <button
                    key={t}
                    className="rounded-full bg-sky-950 px-2.5 py-0.5 font-mono text-[11px] text-sky-300 transition-colors hover:bg-red-950 hover:text-red-300"
                    title="remove"
                    onClick={() => onToggleTag(t)}
                  >
                    {t} ✕
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- what it can do, by band ---- */}
          <AttackLines
            fields={character.data.fields}
            items={character.data.items ?? []}
            catalog={new Map()}
          />

          {/* ---- the prose, each part given its own head ---- */}
          <ProseSections fields={character.data.fields} />

          {character.data.notes && (
            <div>
              <span className={sectionLabel}>The Warden's notes</span>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-400">
                {character.data.notes}
              </p>
            </div>
          )}
        </div>

        {/* ---- where it came from, and what to do with it ---- */}
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800 px-5 py-3">
          {printings.map((s, i) => {
            const book = books.find((b) => b.id === s.book);
            return book && s.page ? (
              <button
                key={i}
                className={`${btnGhost} text-[11px] text-amber-400/90`}
                onClick={() => setReading({ bookId: book.id, page: s.page!, name: book.name })}
              >
                {book.name} · p.{s.page} →
              </button>
            ) : (
              <span key={i} className="font-mono text-[11px] text-stone-700">
                {s.pack || 'printing'}
                {s.page ? ` · p.${s.page}` : ''} — {s.book ? 'book not on this host' : 'no book'}
              </span>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button className={btn} onClick={onClose}>
              done
            </button>
          </div>
        </div>
      </div>

      {reading && <BookReader target={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

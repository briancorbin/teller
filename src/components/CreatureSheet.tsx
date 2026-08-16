import { useEffect, useState } from 'react';
import type { Character, Counter } from '../../worker/types';
import type { SourcedNpc } from '../../worker/bestiary';
import { formatTag } from '../../worker/tags';
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
  picks,
  onPick,
}: {
  character: Character;
  /** The bestiary, for the printing this creature was stamped from. */
  npcs: SourcedNpc[];
  onClose: () => void;
  /**
   * Absent when there is nothing to change — a bestiary BLUEPRINT is a
   * printing, not a creature in a fight, and its Health is what the
   * book says rather than a number anybody is spending down.
   */
  onBump?: (counter: Counter, delta: number) => void;
  onToggleTag?: (tag: string) => void;
  /** Row actions that used to live in the expansion — move, remove. */
  actions?: React.ReactNode;
  /**
   * Which printing this table runs on, when there's a choice to make.
   *
   * A creature printed in a core bestiary AND in the adventure that
   * reprints it has two statblocks, and which one wins is the
   * campaign's pack order. The bestiary lets the Warden say; moving the
   * lookup into this dialog would have quietly taken that away.
   *
   * Offered on a BLUEPRINT only — see `live` below.
   */
  picks?: Record<string, string>;
  onPick?: (npcId: string, packId: string) => void;
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

  /**
   * Is this a creature ON THE TABLE, or a printing in a book?
   *
   * One question, two consequences, and `onBump` is the honest signal:
   * only a thing in a fight has counters anybody spends down. A
   * printing shows what the book says, and its source is fixed.
   *
   * Which printing a creature came from stops being a choice the
   * moment it's stamped out (Brian, 2026-08-16: "disable the ability to
   * swap which book it's from once it's instantiated as a thing on the
   * table"). Swapping then would rewrite a creature mid-combat —
   * different Health, different attacks, under a name somebody has
   * already been fighting.
   *
   * Structural rather than incidental: the encounter panel doesn't pass
   * `onPick` today, but this holds even if some later wiring does.
   */
  const live = Boolean(onBump);

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
          {live ? (
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
                          onClick={() => onBump?.(c, -1)}
                          aria-label={`${c.name} down`}
                        >
                          −
                        </button>
                        <button
                          className="rounded px-1.5 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
                          onClick={() => onBump?.(c, 1)}
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
          ) : (
            // What the book prints, not what anybody has left.
            <div className="flex flex-wrap gap-2">
              {character.data.counters.map((c) => (
                <span key={c.id} className="rounded-lg bg-stone-950/60 px-3 py-2">
                  <span className="font-mono text-sm text-amber-200">{c.max ?? c.current}</span>
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-stone-600">
                    {c.name}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* ---- the printed pools ---- */}
          <PoolGrid fields={character.data.fields} />

          {/* ---- conditions ---- */}
          {character.data.tags.length > 0 && (
            <div>
              <span className={sectionLabel}>Conditions</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {character.data.tags.map((t) => (
                  <button
                    key={t.name}
                    className="rounded-full bg-sky-950 px-2.5 py-0.5 font-mono text-[11px] text-sky-300 transition-colors hover:bg-red-950 hover:text-red-300"
                    title="remove"
                    onClick={() => onToggleTag?.(t.name)}
                  >
                    {formatTag(t)} ✕
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
            // The server says which printing won — it depends on the
            // campaign's pack ORDER, and a client that guessed "the
            // first one" was right by accident until precedence became
            // explicit.
            const chosen = blueprint?.fromId
              ? blueprint.fromId === s.packId
              : picks?.[character.data.blueprintId ?? ''] === s.packId;
            const pickable = !live && onPick && printings.length > 1 && s.packId;
            return (
              <span key={i} className="flex items-center gap-1">
                {pickable && (
                  <button
                    className={`${btnGhost} px-1 font-mono text-[11px] ${
                      chosen ? 'text-amber-400' : 'text-stone-600'
                    }`}
                    onClick={() => onPick!(character.data.blueprintId!, s.packId)}
                    title={
                      chosen
                        ? 'this printing is the one this table uses'
                        : 'use this printing instead'
                    }
                    aria-pressed={chosen}
                  >
                    {chosen ? '●' : '○'} {s.pack}
                  </button>
                )}
                {book && s.page ? (
                  <button
                    className={`${btnGhost} text-[11px] text-amber-400/90`}
                    onClick={() => setReading({ bookId: book.id, page: s.page!, name: book.name })}
                  >
                    {pickable ? '' : `${book.name} · `}p.{s.page} →
                  </button>
                ) : (
                  !pickable && (
                    <span className="font-mono text-[11px] text-stone-700">
                      {s.pack || 'printing'}
                      {s.page ? ` · p.${s.page}` : ''} —{' '}
                      {s.book ? 'book not on this host' : 'no book'}
                    </span>
                  )
                )}
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

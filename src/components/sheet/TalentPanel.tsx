import type { SystemTemplate } from '../../../worker/types';
import {
  hasTag,
  sameTag,
  setTag,
  withoutTag,
  type Tag,
} from '../../../worker/tags';
import { SheetPanel } from './SheetPanel';
import { Starburst } from './Track';

// The roster the back of the printed sheet carries: every category the
// system sells, each with its ✶ box — ticked when owned. The ✶ marks
// scattered across skills and weapons ANNOTATE; this is the one place
// that ANSWERS "which do I have?", including a category the character
// has no matching gear for.
//
// Built as a standalone panel on purpose: blocks first, arrangement
// second, which is how the whole sheet has gone together. It sits on
// whatever screen the layout gives it and moves in one line.
//
// Tapping toggles the mark — a manual grant/revoke, the same authority
// a stepper has over a counter (rule 1). The PRICED buy (4 Prestige) is
// the spend menu's job (TEL-66); this panel is the truth it writes to.
// A mark naming no declared category still renders, at the end: a
// homebrew category doesn't disappear for want of a declaration.
//
// Marks are held in their own kind now, so a mark's NAME is the bare
// category ("Rifles"). It used to be a tag called "Talent: Rifles" and
// every reader here sliced the prefix back off — see `worker/kinds.ts`.

export function TalentPanel({
  marks,
  held,
  onHeld,
  note,
  fill = false,
}: {
  marks: NonNullable<SystemTemplate['marks']>;
  /** What this character holds of the mark kind. */
  held: Tag[];
  /** Absent on a surface that may look but not edit. */
  onHeld?: (next: Tag[]) => void;
  note?: string;
  fill?: boolean;
}) {
  const owns = (category: string) => hasTag(held, category);

  const categories = marks.categories ?? [];
  // Marks naming no declared category — shown, never dropped.
  const strays = held.filter((t) => !categories.some((c) => sameTag(c, t)));

  const toggle = (category: string) => {
    if (!onHeld) return;
    onHeld(
      owns(category) ? withoutTag(held, category) : setTag(held, category),
    );
  };

  return (
    <SheetPanel title={marks.label ?? 'Marks'} note={note} fill={fill}>
      <div className="flex flex-wrap content-center gap-x-4 gap-y-1.5">
        {categories.map((category) => {
          const owned = owns(category);
          return (
            <button
              key={category}
              type="button"
              disabled={!onHeld}
              onClick={() => toggle(category)}
              aria-pressed={owned}
              aria-label={`${category} — ${owned ? 'owned' : 'not owned'}${
                marks.text ? `; ${marks.text}` : ''
              }`}
              className="flex min-w-[9.5rem] flex-1 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors enabled:hover:bg-stone-800/60"
            >
              <span
                className="flex h-[1.15rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border"
                style={
                  owned
                    ? {
                        background: 'var(--sheet-accent, #f59e0b)',
                        borderColor: 'var(--sheet-accent, #f59e0b)',
                      }
                    : { borderColor: '#a8a29e' }
                }
              >
                {owned && <Starburst size={11} fill="#1c1917" />}
              </span>
              <span
                className={`break-words text-[0.8rem] leading-tight ${
                  owned ? 'text-stone-100' : 'text-stone-400'
                }`}
              >
                {category}
              </span>
            </button>
          );
        })}
        {strays.map((tag) => (
          <span
            key={tag.name}
            className="flex min-w-[9.5rem] flex-1 items-center gap-2 px-1 py-0.5"
            title={marks.text}
          >
            <span
              className="flex h-[1.15rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px]"
              style={{ background: 'var(--sheet-accent, #f59e0b)' }}
            >
              <Starburst size={11} fill="#1c1917" />
            </span>
            <span className="break-words text-[0.8rem] leading-tight text-stone-100">
              {tag.name}
            </span>
          </span>
        ))}
      </div>
    </SheetPanel>
  );
}

import { useEffect, useRef } from 'react';
import type { PackEntry } from '../../../worker/types';

// The rule text, on tap.
//
// Every block on the printed sheet carries prose under its headings —
// what each Status does, what each Skill covers. On paper that's free:
// the page is as big as it is and nobody scrolls. On a phone it's the
// difference between a panel that fits and one that doesn't, and it's
// also the part teller may never ship (rule 4: it's the publisher's
// expression, and it lives in the reader's own pack).
//
// Both problems have the same answer — don't render it until asked. The
// row shows the name, the number and the mechanic; the words are one tap
// away, over the top of the card rather than pushing it around.
//
// **It must overlay, never reflow.** The seat has a hard no-scrolling
// rule, and a disclosure that grows the card is a disclosure that either
// scrolls it or makes `FitBox` shrink everything else the moment someone
// taps. Absolute positioning keeps the card exactly the size it was.

export function InfoPopover({
  entry,
  onClose,
}: {
  entry: PackEntry & { section?: string };
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // `pointerdown` rather than `click`: the button that opened this is
    // still under the finger on mouseup, and a click listener would
    // catch its own opening event and close again immediately.
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={entry.name}
      // Pinned to the panel, not to the row: a row-anchored card near the
      // bottom of a phone opens off the bottom of the glass.
      className="absolute inset-x-2 bottom-2 z-20 max-h-[85%] overflow-auto rounded-md border bg-stone-950/97 p-3 shadow-xl backdrop-blur-sm"
      style={{ borderColor: 'var(--sheet-accent, #f59e0b)' }}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="font-serif text-sm font-bold uppercase tracking-wide"
          style={{ color: 'var(--sheet-accent, #f59e0b)' }}
        >
          {entry.name}
        </span>
        {entry.meta && (
          <span className="font-mono text-[11px] text-stone-400">{entry.meta}</span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="ml-auto -my-1 px-1.5 py-1 text-stone-500 transition-colors hover:text-stone-200"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">
        {entry.text}
      </p>
    </div>
  );
}

/** The affordance that opens one. Rendered only when there's text to show. */
export function InfoDot({
  onClick,
  open,
  label,
}: {
  onClick: () => void;
  open: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`what does ${label} do`}
      aria-expanded={open}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs transition-colors ${
        open ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:bg-stone-800 hover:text-stone-200'
      }`}
    >
      ⓘ
    </button>
  );
}

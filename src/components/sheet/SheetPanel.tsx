// The chrome every block on the printed sheet wears.
//
// SKILLS, HEALTH, GRIT, STATUSES, WEAPONS and ABILITIES are all the same
// object: a ruled rectangle with a tick bracketing each corner, and a
// centred display-face heading flanked by two tapered darts with a
// diamond between dart and word. Drawing that four times in four files
// is how three of them end up subtly different, so it lives here once.
//
// Nothing in this file knows what it's framing — it takes a title and
// children. The accent comes off `--sheet-accent`, set once by the card.
//
// **No publisher text.** Every panel on the sheet also prints a line of
// instruction under its heading ("increase max Health with Prestige").
// That's the publisher's prose, so `note` renders only when someone
// supplies one, and nothing in this repo ever does — it's the skin layer
// a pack fills in (TEL-63).

/**
 * The sheet's heading rule: a dart that tapers away from the word, with
 * a diamond pip at the thick end.
 *
 * Drawn rather than lifted. The shape is generic; the book's own is
 * their artwork.
 */
function Dart({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      // Bounded, not greedy. `flex-1` alone let the rule run the whole
      // width of a wide panel, which turns a flourish into the loudest
      // thing in the block — on paper it's about a word long.
      className="h-[0.5em] w-full min-w-3 max-w-[4.5rem] flex-1"
      style={{ transform: flip ? 'scaleX(-1)' : undefined }}
    >
      {/* Tapered from the outside in — thick at the far end, a point
          nearest the word, which is the direction the sheet draws it. */}
      <path d="M 0 3.5 L 78 5 L 78 7 L 0 8.5 Z" fill="var(--sheet-accent, #f59e0b)" />
      <path d="M 88 6 L 93 2 L 98 6 L 93 10 Z" fill="var(--sheet-accent, #f59e0b)" />
    </svg>
  );
}

/** One corner tick. Positioned by the caller; the shape is the same four times. */
function Corner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  const spin = { tl: 0, tr: 90, br: 180, bl: 270 }[at];
  const place = {
    tl: 'left-1 top-1',
    tr: 'right-1 top-1',
    bl: 'left-1 bottom-1',
    br: 'right-1 bottom-1',
  }[at];
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`pointer-events-none absolute h-2.5 w-2.5 text-stone-400 ${place}`}
      style={{ transform: `rotate(${spin}deg)` }}
    >
      <path
        d="M 2 14 L 2 5 Q 2 2 5 2 L 14 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SheetPanel({
  title,
  note,
  children,
  className = '',
  fill = false,
}: {
  title: string;
  /** The sheet's instruction line. Publisher prose — pack-supplied only. */
  note?: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Grow to fill the column instead of hugging the content.
   *
   * For the rail bar, where the blocks are different heights and hugging
   * left the shortest one floating above a third of a panel of nothing.
   * The frame stretches and the CONTENT centres inside it — stretching
   * the content itself would just put the gaps somewhere else.
   */
  fill?: boolean;
}) {
  return (
    <section
      // `inline-size`, never `size`: these panels take their height from
      // their contents, and size containment on both axes collapses them
      // to nothing.
      className={`relative rounded-md border border-stone-600/80 px-3 py-2.5 ${
        fill ? 'flex h-full flex-col' : ''
      } ${className}`}
      style={{ containerType: 'inline-size' }}
    >
      <Corner at="tl" />
      <Corner at="tr" />
      <Corner at="bl" />
      <Corner at="br" />

      {/* One block, so the gap between heading and caption is set once
          and every panel gets the same one — and one margin below it, so
          the gap from caption to content matches too.

          **Every size on this sheet is FIXED**, here and in every panel.
          Container-query type looked adaptive and behaved arbitrarily:
          each panel is its own container, so a heading was scaled by the
          width of whichever column it happened to land in, and HEALTH
          came out visibly bigger than the SKILLS beside it. The same
          fluid sizing made a phone's text shrink with the card instead
          of staying readable.

          A size chosen once is a size you can reason about. Fitting the
          glass is the LAYOUT's job — wrap, stack, scroll, or scale as a
          last resort — not the type's. */}
      <div className="mb-2">
        <header className="flex items-center justify-center gap-1.5 px-2">
          <Dart />
          <h2 className="whitespace-nowrap font-serif text-[1rem] font-bold uppercase leading-tight tracking-[0.14em] text-stone-100">
            {title}
          </h2>
          <Dart flip />
        </header>

        {note && (
          <p className="mt-1 text-center font-serif text-[0.75rem] italic leading-snug text-stone-400">
            {note}
          </p>
        )}
      </div>

      {fill ? (
        <div className="flex min-h-0 flex-1 flex-col justify-center">{children}</div>
      ) : (
        children
      )}
    </section>
  );
}

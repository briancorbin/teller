import { useState } from 'react';

// More than one screen on one piece of glass.
//
// The seat is designed from the 12.6" rail bar (CLAUDE.md rule 6), and
// 515px of height does not hold a character sheet — the upper half alone
// already scales to 0.79, and Weapons and Abilities are still to come. So
// the card is SCREENS, and deciding what earns a place on the first one
// is the design work.
//
// The segmented bar is the ONE way to move (Brian, 2026-08-12). There
// used to be a swipe as well; it died the day item rows became shelves
// that pan sideways — two horizontal gestures on one surface fight,
// and the bar was already the discoverable half and the only one that
// works with a mouse.

export type Screen = {
  /** Stable key, and the label on the bar. */
  name: string;
  render: () => React.ReactNode;
};

export function Screens({
  screens,
  mounted = false,
}: {
  screens: Screen[];
  /** Mounted glass: scaled to fit, and it never scrolls. */
  mounted?: boolean;
}) {
  const [at, setAt] = useState(0);

  // One screen needs no chrome at all. A segmented bar with a single
  // segment is a control that can't do anything, which is worse than no
  // control — it advertises somewhere to go and then refuses.
  if (screens.length <= 1) {
    return <>{screens[0]?.render()}</>;
  }

  const current = Math.min(at, screens.length - 1);
  const go = (next: number) =>
    setAt(Math.max(0, Math.min(screens.length - 1, next)));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col">
        {screens[current].render()}
      </div>

      {/* At the BOTTOM. Hands rest at the near edge of a rail panel and
          at the bottom of a phone, so that's where the control used every
          turn belongs.

          **Sticky only where the card scrolls**, which is held glass.
          Mounted glass never scrolls, so there is nothing for the bar
          to stick to — sticky is a scrolling behaviour and only held
          glass scrolls.

          The condition is exactly the one that decides everything else
          about glass (rule 6): mounted or held. Same question, no second
          device matrix. */}
      <nav
        aria-label="screens"
        className={`z-10 flex shrink-0 gap-1 rounded-lg bg-stone-950/85 p-1 backdrop-blur-sm ${
          mounted ? '' : 'sticky bottom-0'
        }`}
      >
        {screens.map((screen, i) => (
          <button
            key={screen.name}
            type="button"
            onClick={() => go(i)}
            aria-current={i === current}
            // `break-words`, never `truncate` — a cut-off label is a
            // label that says something else, and this one names the
            // place you're trying to get to.
            className={`min-w-0 flex-1 break-words rounded-md px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors ${
              i === current
                ? 'text-stone-950'
                : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
            }`}
            style={
              i === current
                ? { background: 'var(--sheet-accent, #f59e0b)' }
                : undefined
            }
          >
            {screen.name}
          </button>
        ))}
      </nav>
    </div>
  );
}

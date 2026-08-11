import { useRef, useState } from 'react';

// More than one screen on one piece of glass.
//
// The seat is designed from the 12.6" rail bar (CLAUDE.md rule 6), and
// 515px of height does not hold a character sheet — the upper half alone
// already scales to 0.79, and Weapons and Abilities are still to come. So
// the card is SCREENS, and deciding what earns a place on the first one
// is the design work.
//
// Two ways to move, on purpose, because they are for different moments:
//
//   * **The segmented bar** is how you learn what exists. A swipe-only
//     interface hides its own contents; a player who never discovers the
//     abilities screen may as well not have one.
//   * **The swipe** is how you actually move mid-fight, with dice in the
//     other hand. It's the gesture your thumb already makes.
//
// The bar is not decoration on top of the swipe: it is the discoverable
// half, and it is also the only half that works with a mouse or a
// keyboard.

/** Enough travel to be deliberate, and clearly sideways rather than a scroll. */
const TRAVEL = 50;
const SIDEWAYS = 1.5;

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
  const from = useRef<{ x: number; y: number } | null>(null);

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
      <div
        className="flex min-h-0 flex-1 flex-col"
        // Pointer events, so this is one implementation for a finger on
        // the rail panel and a mouse at a desk.
        //
        // Nothing is prevented and nothing is captured: on a phone the
        // card scrolls vertically, and swallowing the gesture to look at
        // it would fight the scroll. The direction test below is what
        // keeps a diagonal drag from changing screens under someone who
        // was only scrolling.
        onPointerDown={(e) => {
          from.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const start = from.current;
          from.current = null;
          if (!start) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.abs(dx) < TRAVEL) return;
          if (Math.abs(dx) < Math.abs(dy) * SIDEWAYS) return;
          go(current + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          from.current = null;
        }}
      >
        {screens[current].render()}
      </div>

      {/* At the BOTTOM. Hands rest at the near edge of a rail panel and
          at the bottom of a phone, so that's where the control used every
          turn belongs.

          **Sticky only where the card scrolls**, which is held glass.
          Mounted glass is scaled to fit and never scrolls, so there is
          nothing for the bar to stick to — and it doesn't merely have no
          job there, it actively breaks: `position: sticky` resolves its
          offset against the scrollport in UNSCALED coordinates, then gets
          scaled with everything else, so inside `FitBox` the bar pinned
          about 40px above its own row and sat on top of the weapons
          panels. It looked like an overlapping z-index bug; it was
          sticky and a transform disagreeing about which pixels are which.

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

import { useState } from 'react';
import { Glyph } from './glyphs';

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
  /** The mark it wears when there's no room for the word. */
  icon?: string;
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
    // `min-h-full` on held glass, and it is what actually keeps the bar
    // DOWN. Sticky can only hold a thing against the bottom of the
    // scrollport once there's something to scroll; on a short screen —
    // Weapons with two guns on it — there was nothing, so the bar rode
    // up to meet the content and sat in the middle of the glass. Filling
    // the height gives the content's `flex-1` something to push
    // against, and the bar has a bottom to be at.
    <div
      className={`flex min-h-0 flex-1 flex-col gap-2 ${
        mounted ? '' : 'min-h-full'
      }`}
    >
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
        {screens.map((screen, i) => {
          // Five words don't fit across a phone. They used to try, and
          // broke mid-word — "WEAPO NS", "INVEN TORY" — which is worse
          // than no label, because a label that says something else is
          // a wrong sign rather than a missing one.
          //
          // So off mounted glass the bar is MARKS, and only the screen
          // you're on says its name. You always know where you are, the
          // other four are a tap wide, and nothing wraps. Every button
          // keeps its name in `aria-label` whether or not it's drawn.
          const named = mounted || i === current;
          return (
            <button
              key={screen.name}
              type="button"
              onClick={() => go(i)}
              aria-current={i === current}
              aria-label={screen.name}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors ${
                named ? 'flex-1' : 'shrink-0'
              } ${
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
              {screen.icon && (
                <Glyph name={screen.icon} className="h-[1.15rem] w-[1.15rem] shrink-0" />
              )}
              {/* `break-words`, never `truncate` — a cut-off label is a
                  label that says something else, and this one names the
                  place you're trying to get to. A screen with no mark
                  always shows its word; it has nothing else to show. */}
              {(named || !screen.icon) && (
                <span className="min-w-0 break-words">{screen.name}</span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

// Make it fit — on glass that has no other option.
//
// A panel screwed to the table rail cannot scroll: nobody is going to
// flick it, and a screen the whole table reads has to show everything at
// once. So on MOUNTED glass the card is scaled until it fits.
//
// **This is the wrong tool for a phone**, which is why `Fit` exists
// beside it. Held glass has somewhere to go — scrolling is free and
// everyone already knows how — and squeezing it instead costs both
// legibility and width. Measured at 390×844, a card wanting 1163px of
// height in 744 rendered at 0.64: panels using 234px of a 390px screen,
// and 16px headings coming out at 10px.
//
// So read the scale as a DIAGNOSTIC. Anything far below 1 means the
// layout is wrong for that glass, not that the glass is small.
//
// The layouts do most of this themselves with fluid grids, because
// content that fits honestly beats content that was shrunk. This is the
// backstop for when honesty runs out: a character with twelve counters
// on a rail panel.
//
// It NEVER scales up. `1` is the only scale where text renders exactly
// as designed, and inflating a small card to fill a rail panel would
// look like a children's book.
//
// Two traps, both hit while building this:
//
//  * **Don't measure by mutating the element.** Setting `transform:
//    scale(1)` to take a reading and then calling `setState` leaves the
//    DOM in the measuring state whenever the computed scale is UNCHANGED
//    — React skips the re-render, so nothing puts the transform back.
//    Transforms don't affect layout anyway, so `scrollHeight` is already
//    the untransformed size and there is nothing to undo.
//  * **Don't widen the wrapper to compensate.** `width: 100/scale%`
//    seems fair — a card shrunk to 80% gets 125% of the width — but the
//    extra width re-wraps the content, which changes its height, which
//    changes the scale. It oscillates. The wrapper stays exactly the
//    box's width, so the only thing scaling changes is pixels.

export function FitBox({
  children,
  /**
   * Floor on the shrink.
   *
   * Low on purpose. A card at 0.35 is hard to read, but the requirement
   * is that everything is THERE — a player can lean in, and can't lean
   * in to something that was cut off. Only pathological viewports get
   * anywhere near this; a real phone sits at 1.
   */
  min = 0.25,
  className = '',
}: {
  children: React.ReactNode;
  min?: number;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Measured SYNCHRONOUSLY, never off a `requestAnimationFrame`.
  //
  // The rAF version looked correct and silently did nothing: a browser
  // reports `visibilityState: "hidden"` for a tab it isn't painting, and
  // a hidden tab never runs animation frames. So the card rendered at
  // scale 1 and simply clipped. That's not just a test-harness quirk — a
  // phone whose screen is off is a hidden tab, and a player waking it
  // mid-fight would find a clipped card.
  //
  // There's nothing to defer to anyway. Reading a size inside a
  // ResizeObserver callback happens after layout, and writing a
  // `transform` can't invalidate layout, so this can't loop.
  const measure = useCallback(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const availableH = box.clientHeight;
    const wantedH = content.scrollHeight;
    // Zero means layout hasn't happened yet. Do nothing: going from 0 to
    // a real size is itself a resize, so the observer brings us back.
    if (!availableH || !wantedH) return;
    const next = Math.min(1, availableH / wantedH);
    setScale((now) => {
      const wanted = Math.max(min, Number.isFinite(next) ? next : 1);
      // Converges in one step, since scaling changes no layout; the
      // epsilon only stops sub-pixel jitter causing renders.
      return Math.abs(wanted - now) < 0.005 ? now : wanted;
    });
  }, [min]);

  useEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure]);

  // Children can change without anything resizing — swapping Gauges for
  // Classic replaces the content wholesale. No dependency array on
  // purpose: after every render, check whether it still fits.
  useLayoutEffect(measure);

  return (
    <div ref={outer} className={`relative overflow-hidden ${className}`}>
      {/* `min-h-full` lets a layout that fits comfortably STRETCH into the
          space rather than leaving a hole under it — bigger targets for
          a fingertip. It doesn't defeat the measurement: content that
          genuinely wants more than the box still reports more, and still
          gets scaled. */}
      {/* A flex column, not just `min-h-full`: a percentage height inside
          an auto-height parent resolves to zero, so a child asking for
          `min-h-full` got nothing and left a hole. Flex stretch needs no
          resolvable height — a child with `flex-1` fills what's spare.
          Content that wants MORE than the box still overflows this box
          honestly, which is what the measurement above reads. */}
      <div
        ref={inner}
        className="flex min-h-full w-full flex-col origin-top"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * `FitBox` on mounted glass, a plain box on held glass.
 *
 * The choice lives at the call site (`wide` in `SeatView`), but it is
 * expressed here so nothing has to write the conditional-wrapper dance
 * twice. Off, this renders exactly what it was given, at full width and
 * natural size, and whatever contains it decides whether that scrolls.
 */
export function Fit({
  on,
  children,
  className = '',
}: {
  on: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (!on) return <div className={className}>{children}</div>;
  return <FitBox className={className}>{children}</FitBox>;
}

import { useEffect, useRef, useState } from 'react';

// Pretend to be another screen.
//
// The seat has to work on a phone, a tablet and a 1920×515 rail panel,
// and nobody owns all three while they're deciding whether a layout
// feels right. So the card can be rendered at another device's exact
// dimensions, scaled down to fit the glass you're actually holding.
//
// This is a viewing aid, not a setting: it lives in component state and
// is gone on reload. A player who wandered into it and left it on
// "Rail" would otherwise be stuck looking at a letterboxed card forever.
//
// The trick that makes it honest is `container-type: size`. Inside the
// frame, `cqh`/`cqw` resolve against the FRAME, not the browser window —
// so a font sized in `cqh` shrinks for the simulated rail exactly as it
// would on the real one. Anything still written in `vh` would quietly
// keep measuring the real window and the preview would be a lie, which
// is why the layouts use `cqh` throughout.
//
// TRUE SIZE goes one further: a preset that knows its physical inches
// can render at them, so a candidate panel is judged with eyes and a
// tape measure before any hardware is bought. Browser pixels lie about
// inches — no web API reports the screen's real density — so the one
// missing number, this screen's CSS pixels per inch, comes from a
// person once: drag an on-screen credit card until it matches a real
// one. That's a fact about the monitor, not a viewing choice, so it
// alone persists.

export type SeatSize = {
  id: string;
  name: string;
  w: number;
  h: number;
  /**
   * The glass's physical face, for true-size rendering. Only presets
   * that exist to answer "how big is this in the real world" carry it —
   * a phone preset doesn't, because you already own a phone.
   */
  inches?: { w: number; h: number };
} | null;

/** Null is "whatever this screen actually is", and is the default. */
export const SEAT_SIZES: NonNullable<SeatSize>[] = [
  { id: 'phone', name: 'Phone', w: 390, h: 844 },
  { id: 'phone-wide', name: 'Phone ↻', w: 844, h: 390 },
  { id: 'tablet', name: 'Tablet', w: 810, h: 1080 },
  { id: 'tablet-wide', name: 'Tablet ↻', w: 1080, h: 810 },
  // The rail-bar candidates, physical faces worked out from their
  // diagonals: 12.6" at 1920×515 and 8.8" at 1920×480. Same layout,
  // very different amounts of glass — which is the entire question.
  { id: 'rail', name: 'Rail 12.6″', w: 1920, h: 515, inches: { w: 12.17, h: 3.26 } },
  { id: 'rail-sm', name: 'Rail 8.8″', w: 1920, h: 480, inches: { w: 8.54, h: 2.13 } },
  { id: 'tv', name: 'Table TV', w: 1920, h: 1080 },
];

const PPI_STORAGE = 'teller.screenPpi';
/** ISO/IEC 7810 ID-1 — the card in everyone's wallet. */
export const CARD_INCHES = { w: 3.37, h: 2.125 };

/** CSS pixels per inch of THIS screen, if a person has calibrated it. */
export function getScreenPpi(): number | null {
  const raw = Number(localStorage.getItem(PPI_STORAGE));
  return Number.isFinite(raw) && raw >= 50 && raw <= 400 ? raw : null;
}

export function setScreenPpi(ppi: number): void {
  localStorage.setItem(PPI_STORAGE, String(ppi));
}

export function SizeFrame({
  size,
  ppi,
  children,
}: {
  size: SeatSize;
  /**
   * Render at physical size using this screen's CSS px/inch. Only
   * honoured when the preset knows its inches; without it the frame
   * scales down to fit exactly as before.
   */
  ppi?: number | null;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [room, setRoom] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el || !size) return;
    // Synchronous, never deferred to an animation frame: a browser
    // reports a tab it isn't painting as hidden and never runs its
    // animation frames, so a deferred measure silently never happens
    // and the frame renders at the wrong scale with no clue why.
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setRoom({ w, h });
      setFitScale(Math.min(1, w / size.w, h / size.h));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();
    return () => observer.disconnect();
  }, [size]);

  // No frame: the card simply IS the remaining page, and still gets a
  // container context so `cqh` means the same thing in both modes. The
  // PARENT owns the height — the chrome (identity, pickers) sits above
  // the frame, outside the glass, so 100dvh here would double-count it.
  if (!size) {
    return (
      <div
        className="min-h-0 w-full flex-1"
        style={{ containerType: 'size' }}
      >
        {children}
      </div>
    );
  }

  // True size beats fit-to-window when it's available — the clamp would
  // defeat the point, so a panel bigger than this monitor CLIPS, and
  // says so, rather than quietly shrinking back into a guess.
  const truly = Boolean(ppi && size.inches);
  const scale = truly ? (size.inches!.w * ppi!) / size.w : fitScale;
  const clipped =
    truly && (size.w * scale > room.w || size.h * scale > room.h);

  return (
    <div
      ref={box}
      className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-stone-950 p-2"
    >
      <div
        className="shrink-0 overflow-hidden rounded-lg ring-1 ring-stone-700"
        style={{
          width: size.w,
          height: size.h,
          transform: `scale(${scale})`,
          // Scaling from the centre keeps the frame where the flexbox put
          // it; top-left would slide it off toward the corner.
          transformOrigin: 'center',
          containerType: 'size',
        }}
      >
        {children}
      </div>
      {truly && (
        <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[10px] text-stone-600">
          true size — {size.inches!.w.toFixed(1)}″ × {size.inches!.h.toFixed(1)}″
          {clipped && ' · wider than this screen, showing the middle'}
        </span>
      )}
    </div>
  );
}

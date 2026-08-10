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

export type SeatSize = {
  id: string;
  name: string;
  w: number;
  h: number;
} | null;

/** Null is "whatever this screen actually is", and is the default. */
export const SEAT_SIZES: NonNullable<SeatSize>[] = [
  { id: 'phone', name: 'Phone', w: 390, h: 844 },
  { id: 'phone-wide', name: 'Phone ↻', w: 844, h: 390 },
  { id: 'tablet', name: 'Tablet', w: 810, h: 1080 },
  { id: 'tablet-wide', name: 'Tablet ↻', w: 1080, h: 810 },
  { id: 'rail', name: 'Rail panel', w: 1920, h: 515 },
  { id: 'tv', name: 'Table TV', w: 1920, h: 1080 },
];

export function SizeFrame({
  size,
  children,
}: {
  size: SeatSize;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el || !size) return;
    // Synchronous, for the same reason `FitBox` is: a hidden tab never
    // runs animation frames, and a card that silently never measured
    // would render at the wrong scale with no clue why.
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setScale(Math.min(1, w / size.w, h / size.h));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    fit();
    return () => observer.disconnect();
  }, [size]);

  // No frame: the card simply IS the window, and still gets a container
  // context so `cqh` means the same thing in both modes.
  if (!size) {
    return (
      <div className="h-[100dvh] w-full" style={{ containerType: 'size' }}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={box}
      className="flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-stone-950 p-2"
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
    </div>
  );
}

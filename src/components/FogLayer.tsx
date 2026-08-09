import { useId } from 'react';
import type { Fog } from '../../worker/types';

// Fog as a single masked sheet: one dark rect over the whole map with
// the revealed cells punched out and blurred, so explored ground has
// soft organic edges instead of a staircase of squares. The console
// sees through its own fog (the Warden knows what's out there); the
// table gets it near-opaque.

export function FogLayer({
  fog,
  left,
  top,
  width,
  height,
  cellPx,
  dm = false,
}: {
  fog?: Fog;
  left: number;
  top: number;
  width: number;
  height: number;
  cellPx: number;
  dm?: boolean;
}) {
  const uid = useId();
  if (!fog?.on || !cellPx || !width || !height) return null;
  const blur = cellPx * 0.28;
  const bleed = cellPx * 0.12; // let neighbours meet before the blur
  // What's actually clear: freeform reveals plus every revealed region.
  // (The table receives this already flattened; recomputing is a no-op
  // there and keeps the console honest.)
  const clear: [number, number][] = [
    ...(fog.revealed ?? []),
    ...(fog.regions ?? []).filter((r) => r.revealed).flatMap((r) => r.cells),
  ];

  return (
    <svg
      className="pointer-events-none absolute"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <filter id={`fogblur-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <mask id={`fogmask-${uid}`}>
          <rect x="0" y="0" width={width} height={height} fill="white" />
          <g filter={`url(#fogblur-${uid})`}>
            {/* a cell can be revealed twice (freeform + region) — index
                keys, since the coordinates are not unique here */}
            {clear.map(([c, r], i) => (
              <rect
                key={i}
                x={c * cellPx - bleed}
                y={r * cellPx - bleed}
                width={cellPx + bleed * 2}
                height={cellPx + bleed * 2}
                rx={cellPx * 0.3}
                fill="black"
              />
            ))}
          </g>
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="#0a0908"
        opacity={dm ? 0.55 : 0.97}
        mask={`url(#fogmask-${uid})`}
      />
    </svg>
  );
}

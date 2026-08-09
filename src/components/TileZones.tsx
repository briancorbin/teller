import { useId } from 'react';
import type { TileZone } from '../../worker/types';
import { zoneBase } from './token-visuals';

// Painted tile zones as ONE organic layer: all cells of an effect
// render as rounded rects through an SVG "goo" filter (blur + alpha
// contrast), so adjacent tiles melt into a single blob while isolated
// tiles stay rounded squares. Animated effects get a hot core per
// cell above the goo. Shared by the scene editor and the table.

export function TileZones({
  zones,
  left,
  top,
  width,
  height,
  cellPx,
}: {
  zones: TileZone[];
  left: number;
  top: number;
  width: number;
  height: number;
  cellPx: number;
}) {
  const uid = useId();
  if (zones.length === 0 || !cellPx) return null;
  const inset = cellPx * 0.06;
  const blur = cellPx * 0.22;

  return (
    <svg
      className="pointer-events-none absolute"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <filter
          id={`goo-${uid}`}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
          />
        </filter>
      </defs>
      {zones.map((zone) => {
        const base = zoneBase(zone.effect);
        const coreId = `core-${uid}-${zone.effect}`;
        return (
          <g key={zone.effect}>
            {base.core && (
              <defs>
                <radialGradient id={coreId}>
                  <stop offset="0%" stopColor={base.core} stopOpacity="0.85" />
                  <stop offset="100%" stopColor={base.core} stopOpacity="0" />
                </radialGradient>
              </defs>
            )}
            {/* opaque fills through the goo filter; translucency AFTER */}
            <g opacity={base.opacity} className={base.core ? 'animate-pulse' : undefined}>
              <g filter={`url(#goo-${uid})`}>
                {zone.cells.map(([c, r]) => (
                  <rect
                    key={`${c},${r}`}
                    x={c * cellPx + inset}
                    y={r * cellPx + inset}
                    width={cellPx - inset * 2}
                    height={cellPx - inset * 2}
                    rx={cellPx * 0.18}
                    fill={base.fill}
                  />
                ))}
              </g>
            </g>
            {base.core &&
              zone.cells.map(([c, r]) => (
                <circle
                  key={`core-${c},${r}`}
                  cx={(c + 0.5) * cellPx}
                  cy={(r + 0.5) * cellPx}
                  r={cellPx * 0.42}
                  fill={`url(#${coreId})`}
                  className="animate-pulse"
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

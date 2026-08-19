import { useEffect, useRef, useState } from 'react';
import type { Entry } from '../../../core/entity.ts';
import { SheetPanel } from './SheetPanel.tsx';

// A counter drawn as a revolver's cylinder.
//
// Ported from the old app (src/components/sheet/Cylinder.tsx) — the
// geometry, the derive-angle-from-value rule and the counter-rotating
// labels are all kept verbatim; only the write goes through `onSet`
// (a plain number) instead of a whole `Counter` object, since an `Entry`
// has no id of its own to carry along.
//
// The sheet prints Grit this way and it is the right control as well as
// the right picture: six chambers, you spend one at a time, and it
// reloads at the top of your turn. Firing advances the cylinder a click.
//
// **Nothing here knows what Grit is** (rule 2). This face is requested by
// name in the `dials` record; the component only knows how to draw N
// chambers for an entry whose max is N.
//
// Three decisions worth keeping:
//
// **The angle is DERIVED from the value, never accumulated by the click.**
// A change arriving over SSE from the DM animates for free, same as a
// player's own tap — drift is not representable.
//
// **The numbers counter-rotate so they stay upright.**
//
// **The whole range stays one tap away.** Tapping any chamber SETS the
// value; the middle fires one.

/** Past this a ring of chambers stops being countable. */
const RING_LIMIT = 12;

/** Can this entry reasonably be drawn as a cylinder at all? */
export function dialable(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0 && entry.max <= RING_LIMIT;
}

/** Where everything sits, for a cylinder of `n` chambers. */
function geometry(n: number) {
  const spread = Math.sin(Math.PI / n);
  const orbit = 46 / (1 + 1.24 * spread);
  const lobe = 1.24 * orbit * spread;
  return {
    orbit,
    lobe,
    hole: lobe * 0.72,
    hub: Math.max(12, orbit - lobe + 6),
    font: lobe * 0.72 * 0.95,
  };
}

/** Chamber `i` of `n`, in viewBox coordinates. Index 0 sits at the top. */
function seat(i: number, n: number, orbit: number) {
  const a = (-90 + (360 / n) * i) * (Math.PI / 180);
  return { x: 50 + orbit * Math.cos(a), y: 50 + orbit * Math.sin(a) };
}

export function Cylinder({
  entry,
  onSet,
  note,
  fill = false,
  accent,
}: {
  entry: Entry;
  onSet: (next: number) => void;
  /** The sheet's caption. Pack-supplied only. */
  note?: string;
  /** Grow to fill the column. */
  fill?: boolean;
  accent?: string;
}) {
  const max = entry.max!;
  const current = typeof entry.value === 'number' ? entry.value : 0;
  const step = 360 / max;
  const g = geometry(max);

  // Chamber `c` (labelled c, 1-based) holds a round while c <= current.
  // The next to fire is `current`, at index current-1; bringing it to
  // the top means turning by -(current-1) steps.
  const angle = -(current - 1) * step;

  // A brief kick when the value goes DOWN.
  const [firing, setFiring] = useState(false);
  const previous = useRef(current);
  useEffect(() => {
    const dropped = current < previous.current;
    previous.current = current;
    if (!dropped) return;
    setFiring(true);
    const t = setTimeout(() => setFiring(false), 170);
    return () => clearTimeout(t);
  }, [current]);

  const tint = accent ?? 'var(--sheet-accent, #f59e0b)';
  const set = (n: number) => onSet(Math.max(0, Math.min(max, n)));

  const chambers = Array.from({ length: max }, (_, i) => {
    const label = i + 1;
    return { i, label, loaded: label <= current, ...seat(i, max, g.orbit) };
  });

  return (
    <SheetPanel title={entry.name} note={note} fill={fill}>
      <div className="flex flex-col items-center gap-1">
        <svg
          viewBox="0 0 100 100"
          className="h-auto w-full max-w-[min(13rem,60cqw)]"
          role="group"
          aria-label={`${entry.name}: ${current} of ${max}`}
        >
          <g
            className="transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:transition-none"
            style={{
              transform: `rotate(${angle}deg) scale(${firing ? 0.965 : 1})`,
              transformOrigin: '50px 50px',
            }}
          >
            <g fill="#e7e5e4">
              <circle cx={50} cy={50} r={g.hub} />
              {chambers.map((c) => (
                <circle key={`lobe${c.i}`} cx={c.x} cy={c.y} r={g.lobe} />
              ))}
            </g>

            {chambers.map((c) => (
              <g key={c.i}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={g.hole}
                  fill="#12100f"
                  stroke={c.loaded ? tint : '#57534e'}
                  strokeWidth={c.loaded ? 2.2 : 1.2}
                  className="transition-[stroke,stroke-width] duration-200 motion-reduce:transition-none"
                />
                <g
                  className="transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:transition-none"
                  style={{
                    transform: `rotate(${-angle}deg)`,
                    transformOrigin: `${c.x}px ${c.y}px`,
                  }}
                >
                  <text
                    x={c.x}
                    y={c.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={g.font}
                    fontWeight="bold"
                    fill={c.loaded ? tint : '#57534e'}
                    className="pointer-events-none select-none font-mono"
                  >
                    {c.label}
                  </text>
                </g>
              </g>
            ))}
          </g>

          <circle
            cx={50}
            cy={50}
            r={46}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-disabled={current <= 0}
            aria-label={`spend 1 ${entry.name}`}
            className={current > 0 ? 'cursor-pointer outline-none' : 'outline-none'}
            onClick={() => current > 0 && set(current - 1)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (current > 0) set(current - 1);
            }}
          />

          <g
            role="button"
            tabIndex={current < max ? 0 : -1}
            aria-label={`reload ${entry.name}`}
            aria-disabled={current >= max}
            className={
              current < max
                ? 'cursor-pointer outline-none'
                : 'pointer-events-none opacity-25'
            }
            onClick={() => set(max)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              set(max);
            }}
          >
            <circle cx={50} cy={50} r={g.hub * 0.62} fill="#12100f" />
            <text
              x={50}
              y={50}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={g.hub * 0.9}
              fill={tint}
              className="pointer-events-none select-none"
            >
              ↻
            </text>
          </g>
        </svg>
      </div>
    </SheetPanel>
  );
}

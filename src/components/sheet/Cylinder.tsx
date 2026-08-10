import { useEffect, useRef, useState } from 'react';
import type { Counter } from '../../../worker/types';
import { SheetPanel } from './SheetPanel';

// A counter drawn as a revolver's cylinder.
//
// The sheet prints Grit this way and it is the right control as well as
// the right picture: six chambers, you spend one at a time, and it
// reloads at the top of your turn. Firing advances the cylinder a click,
// which is a thing everyone already knows how to read.
//
// **Nothing here knows what Grit is** (rule 2). This face is requested by
// name in `SystemTemplate.dials`; the component only knows how to draw N
// chambers for a counter whose max is N. Point it at ammunition, at a
// four-segment clock, at anything small and bounded.
//
// Three decisions worth keeping:
//
// **The angle is DERIVED from the value, never accumulated by the click.**
// If a tap played an animation, a change arriving over SSE from the DM
// wouldn't animate at all, and a single dropped frame would leave the
// cylinder permanently out of step with the number. As a pure function of
// `current`, every path animates for free — the player's tap, the DM's
// edit, an undo — and drift is not representable.
//
// **The numbers counter-rotate so they stay upright.** The cylinder turns;
// the labels don't. Otherwise a player reads their Grit upside down five
// times out of six.
//
// **The whole range stays one tap away.** A control you can only step
// down by one is a control that takes four taps to spend four Grit, and
// the printed sheet's own gesture is to circle the number you're on. So
// tapping any chamber SETS the value; the middle fires one.

/** Past this a ring of chambers stops being countable — see `Sheet`. */
const RING_LIMIT = 12;

/** Can this counter reasonably be drawn as a cylinder at all? */
export function dialable(counter: Counter): boolean {
  return counter.max !== null && counter.max > 0 && counter.max <= RING_LIMIT;
}

/**
 * Where everything sits, for a cylinder of `n` chambers.
 *
 * Derived rather than tuned for six, so a four-chamber clock and a
 * twelve-chamber drum are both drawn properly instead of being a
 * six-shooter with pieces missing. Everything is kept inside a radius of
 * 46 in a 100-unit box, which leaves room for the stroke.
 */
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
  counter,
  onChange,
  note,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
  /** The sheet's caption. Publisher prose, so pack-supplied only. */
  note?: string;
}) {
  const max = counter.max!;
  const step = 360 / max;
  const g = geometry(max);

  // Chamber `c` (labelled c, 1-based) holds a round while c <= current,
  // so the loaded ones are always 1..current — the same reading as the
  // printed sheet, where you circle the number you're on.
  //
  // The next to fire is the highest loaded, which is `current`, sitting
  // at index current-1. Bringing it to the top means turning by
  // -(current-1) steps — which increases by exactly one step every time
  // the value drops, so spending always advances the cylinder the same
  // way round.
  const angle = -(counter.current - 1) * step;

  // A brief kick when the value goes DOWN. `setTimeout` rather than
  // anything frame-driven on purpose: a hidden tab never runs an
  // animation frame, and a flag that only clears on a frame would stick
  // on forever for a player whose screen slept mid-fight.
  const [firing, setFiring] = useState(false);
  const previous = useRef(counter.current);
  useEffect(() => {
    const dropped = counter.current < previous.current;
    previous.current = counter.current;
    if (!dropped) return;
    setFiring(true);
    const t = setTimeout(() => setFiring(false), 170);
    return () => clearTimeout(t);
  }, [counter.current]);

  const accent = 'var(--sheet-accent, #f59e0b)';
  const set = (n: number) =>
    onChange({ ...counter, current: Math.max(0, Math.min(max, n)) });

  const chambers = Array.from({ length: max }, (_, i) => {
    const label = i + 1;
    return { i, label, loaded: label <= counter.current, ...seat(i, max, g.orbit) };
  });

  return (
    <SheetPanel title={counter.name} note={note}>
      <div className="flex flex-col items-center gap-1">
        {/* No "2/6" readout. The lit chambers ARE the number, and a
            second copy of it beside them is the kind of redundancy that
            reads as distrust of the picture. It stays in the accessible
            name below, where it costs no space and is the only way a
            screen reader gets it at all. */}
        <svg
          viewBox="0 0 100 100"
          className="h-auto w-full max-w-[min(13rem,60cqw)]"
          role="group"
          aria-label={`${counter.name}: ${counter.current} of ${max}`}
        >
          <g
            className="transition-transform duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] motion-reduce:transition-none"
            style={{
              // The kick rides on the same transform as the turn, so the
              // two can't fight each other for the property.
              transform: `rotate(${angle}deg) scale(${firing ? 0.965 : 1})`,
              transformOrigin: '50px 50px',
            }}
          >
            {/* The body: a hub plus one lobe per chamber. They overlap,
                so the fills union into the scalloped silhouette the sheet
                prints without anyone computing a path for it. */}
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
                  stroke={c.loaded ? accent : '#57534e'}
                  strokeWidth={c.loaded ? 2.2 : 1.2}
                  className="transition-[stroke,stroke-width] duration-200 motion-reduce:transition-none"
                />
                {/* Upright whatever the cylinder is doing. */}
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
                    fill={c.loaded ? accent : '#57534e'}
                    className="pointer-events-none select-none font-mono"
                  >
                    {c.label}
                  </text>
                </g>
              </g>
            ))}

          </g>

          {/* Spend sits UNDER reload in paint order, so the small centre
              target wins where the two overlap. Both live outside the
              rotating group — a control that spins away from the finger
              is a control you miss.

              Deliberately not one target per chamber. Tap-a-number-to-set
              is the printed sheet's gesture, but on a screen the thing
              you do twenty times an hour is spend a point, and making
              that a single unmissable target beats making it one of six
              small ones. Setting an exact value is still there — on the
              console, and on every other seat layout. */}
          <circle
            cx={50}
            cy={50}
            r={46}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-disabled={counter.current <= 0}
            aria-label={`spend 1 ${counter.name}`}
            className={counter.current > 0 ? 'cursor-pointer outline-none' : 'outline-none'}
            onClick={() => counter.current > 0 && set(counter.current - 1)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (counter.current > 0) set(counter.current - 1);
            }}
          />

          {/* The pin IS the reload, and it neither rotates nor is covered
              by the spend target. ↻ is the same glyph `Refill` uses
              everywhere else in the app, so it means here what it means
              there. Dimmed rather than hidden when the cylinder is
              already full — nothing on this panel should move. */}
          <g
            role="button"
            tabIndex={counter.current < max ? 0 : -1}
            aria-label={`reload ${counter.name}`}
            aria-disabled={counter.current >= max}
            className={
              counter.current < max
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
              fill={accent}
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

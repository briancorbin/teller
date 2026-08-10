import type { Counter } from '../../../worker/types';
import { ClockFace } from '../ClockFace';
import {
  bumped,
  Name,
  Refill,
  Ring,
  split,
  Step,
  Value,
  type CounterViewProps,
} from './shared';

// Dials — read it without reading it.
//
// The bet: at a table, mid-turn, with someone talking at you, a shape is
// faster than a number. A ring three-quarters full says "fine" before
// you've parsed "7/10", and an almost-empty one is alarming without
// anybody choosing a red.
//
// Small maxes get `ClockFace`'s discrete wedges, because six wedges of
// Grit are countable and that's genuinely useful — you can see you have
// two left. Past a dozen the wedges turn to mush, so it becomes a
// continuous ring instead. Same counter, same events; only the renderer
// changes.

const WEDGE_LIMIT = 12;

function Dial({
  counter,
  big,
  crowded,
  onChange,
}: {
  counter: Counter;
  big?: boolean;
  /** More than a pair on screen — height is scarcer than legibility. */
  crowded?: boolean;
  onChange: (next: Counter) => void;
}) {
  // Generous on purpose. A dial you can hit without looking is the whole
  // pitch, and `FitBox` shrinks the card if a character carries enough
  // counters that this stops fitting — so the size can be chosen for the
  // common case instead of the worst one.
  // Two dials stacked need roughly twice this in height, so it's sized
  // for the common case and trimmed when a character carries more than a
  // pair — past that, height is the scarce thing, not legibility.
  const size = big ? (crowded ? 104 : 132) : 76;
  const countable = counter.max! <= WEDGE_LIMIT;

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-stone-800 bg-stone-900/70 p-3">
      <div className="relative">
        {countable ? (
          <div className="relative" style={{ width: size, height: size }}>
            <ClockFace
              current={counter.current}
              max={counter.max!}
              size={size}
              onClick={() => onChange(bumped(counter, 1))}
              label={`${counter.name}: ${counter.current} of ${counter.max} — tap to advance`}
            />
          </div>
        ) : (
          <Ring counter={counter} size={size}>
            <Value
              counter={counter}
              className={big ? 'text-xl' : 'text-base'}
            />
          </Ring>
        )}
      </div>

      <div className="flex w-full items-center gap-1">
        <Name
          counter={counter}
          className="min-w-0 flex-1 text-center text-[11px] uppercase tracking-widest text-stone-400"
        />
        <Refill counter={counter} onChange={onChange} big={big} />
      </div>

      {/* The face advances on tap; these are how you go back, and how
          someone who doesn't realise the face is tappable gets anywhere. */}
      <div className="flex w-full gap-1.5">
        <Step
          sign="−"
          big={big}
          className="flex-1"
          label={`decrease ${counter.name}`}
          onClick={() => onChange(bumped(counter, -1))}
        />
        <Step
          sign="+"
          big={big}
          className="flex-1"
          label={`increase ${counter.name}`}
          onClick={() => onChange(bumped(counter, 1))}
        />
      </div>
    </div>
  );
}

export function Dials({ counters, onChange, big }: CounterViewProps) {
  const { gauges, tallies } = split(counters);
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
      {gauges.length > 0 && (
        // A dial is a circle, so stretching its row just adds padding
        // around it — the tile takes what it needs and the leftover
        // height centres the block.
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(auto-fit, minmax(${big ? 10 : 7}rem, 1fr))`,
            gridAutoRows: 'minmax(0, max-content)',
          }}
        >
          {gauges.map((counter) => (
            <Dial
              key={counter.id}
              counter={counter}
              big={big}
              crowded={gauges.length > 2}
              onChange={update}
            />
          ))}
        </div>
      )}

      {/* A tally has no ceiling, so it has no dial to draw — it stays a
          number. Pretending otherwise would mean inventing a maximum. */}
      {tallies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tallies.map((counter) => (
            <div
              key={counter.id}
              className="flex items-center gap-2 rounded-full bg-stone-900/70 py-1 pl-3 pr-1"
            >
              <Name counter={counter} className="text-xs text-stone-400" />
              <Value counter={counter} className="text-sm" />
              <Step
                sign="−"
                label={`decrease ${counter.name}`}
                onClick={() => update(bumped(counter, -1))}
              />
              <Step
                sign="+"
                label={`increase ${counter.name}`}
                onClick={() => update(bumped(counter, 1))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

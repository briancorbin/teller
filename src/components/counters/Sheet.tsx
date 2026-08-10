import type { Counter } from '../../../worker/types';
import { SkillPanel } from '../sheet/SkillPanel';
import {
  Bar,
  bumped,
  Name,
  Refill,
  split,
  Step,
  Value,
  type CounterViewProps,
} from './shared';

// Sheet — arranged like the paper.
//
// Read off the actual WiW character sheet rather than invented: skills
// boxed down the left, the spendable resources in the middle, tallies
// along the bottom where the sheet keeps wallet and scrap. A player who
// has filled one of these in already knows where to look, which is worth
// more than any arrangement I'd come up with.
//
// Two devices are lifted directly because they're better than what we
// had:
//
//   * **Grit is a ring of numbers you mark**, not a bar. On paper you
//     circle where you are, so tapping a number SETS it — one touch to
//     go from 6 to 2, where −/+ takes four.
//   * **A stat is a box with the value big and the name small under it**,
//     which is how every sheet in the hobby prints them.
//
// What is NOT lifted is the sheet's text. The status descriptions, the
// ability wording, the trade blurbs — that's the publisher's prose and
// it stays in your pack, where the conditions list already reads it from
// (rule 4). This file knows about boxes and rings, not about the West.
//
// Nothing here is game-specific either (rule 2). "Ring it if the max is
// small, otherwise show a bar" is a statement about numbers; it lands on
// Grit for WiW and on spell slots or ammo somewhere else.

/** Past this, a ring of numbers stops being countable and becomes noise. */
const RING_LIMIT = 12;

/**
 * The sheet's own control: the numbers, marked up to where you are.
 *
 * Tapping the number you're already on steps back one, so the ring can
 * reach zero without a separate control — the same gesture a row of
 * stars uses, and it means the whole range is one touch away in both
 * directions.
 */
function NumberRing({
  counter,
  onChange,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
}) {
  const max = counter.max!;
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const marked = n <= counter.current;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ ...counter, current: n === counter.current ? n - 1 : n })}
            aria-label={`set ${counter.name} to ${n === counter.current ? n - 1 : n}`}
            aria-pressed={marked}
            className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm transition-colors ${
              marked
                ? 'border-amber-500 bg-amber-600 text-stone-950'
                : 'border-stone-700 text-stone-500 hover:border-stone-500'
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** A boxed resource, the way the sheet prints Health. */
function SheetGauge({
  counter,
  onChange,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
}) {
  const ringable = counter.max! <= RING_LIMIT;
  return (
    // `inline-size`, NOT `size`. `container-type: size` applies size
    // containment in BOTH axes, which means the box stops taking its
    // height from its contents — fine when a grid row fixes the height,
    // fatal here, where rows are content-sized: every tile collapsed and
    // the rings drew on top of each other.
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-stone-700 bg-stone-900/60 p-2.5"
      style={{ containerType: 'inline-size' }}
    >
      <div className="flex items-baseline gap-2">
        <Name
          counter={counter}
          className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400"
        />
        <Refill counter={counter} onChange={onChange} />
      </div>

      {ringable ? (
        <div className="flex flex-1 items-center justify-center">
          <NumberRing counter={counter} onChange={onChange} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          <div className="flex items-end gap-2">
            <Value
              counter={counter}
              className="leading-none"
              style={{ fontSize: 'clamp(1.25rem, 26cqw, 3.5rem)' }}
            />
          </div>
          <Bar counter={counter} thick />
          <div className="flex gap-1.5">
            <Step
              sign="−"
              className="h-9 flex-1"
              label={`decrease ${counter.name}`}
              onClick={() => onChange(bumped(counter, -1))}
            />
            <Step
              sign="+"
              className="h-9 flex-1"
              label={`increase ${counter.name}`}
              onClick={() => onChange(bumped(counter, 1))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function Sheet({ counters, onChange, fields = [], dice }: CounterViewProps) {
  const { gauges, tallies } = split(counters);
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className="grid min-h-0 flex-1 gap-2"
        // Skills column then resources, the sheet's own reading order.
        // It collapses to one column when there isn't width for two,
        // which is the one liberty paper doesn't have to take.
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))' }}
      >
        <SkillPanel fields={fields} dice={dice} />

        {gauges.length > 0 && (
          <section className="flex min-h-0 flex-col gap-1.5" style={{ containerType: 'inline-size' }}>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-500">
              Condition
            </h2>
            <div
              className="grid min-h-0 flex-1 gap-2"
              // A ring is as tall as it is; stretching the row just puts
              // a void above and below it. Content-sized rows keep the
              // boxes tight, which is also how they sit on paper.
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
                gridAutoRows: 'minmax(0, max-content)',
              }}
            >
              {gauges.map((counter) => (
                <SheetGauge key={counter.id} counter={counter} onChange={update} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* The bottom of page two: wallet, scrap, supplies. Quiet, because
          on the sheet they're a margin, not the middle. */}
      {tallies.length > 0 && (
        <div
          className="grid shrink-0 gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}
        >
          {tallies.map((counter) => (
            <div
              key={counter.id}
              className="flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
                <Name
                  counter={counter}
                  className="text-[10px] uppercase tracking-widest text-stone-500"
                />
                <Value counter={counter} className="text-base" />
              </div>
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

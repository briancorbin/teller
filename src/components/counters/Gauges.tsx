import type { Counter } from '../../../worker/types';
import { ClockFace } from '../ClockFace';
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

// Gauges — the default.
//
// Two tiers from one fact about the data: a counter with a ceiling is
// something you spend in a fight, and a counter without one is something
// you count between sessions. Health and Grit get a tile with a bar you
// can read across a table; Wallet and Scrap get one quiet line each.
//
// The old layout gave all seven equal weight and full width, which meant
// seven rows that overflowed a phone and put Health's − and + at opposite
// ends of a 1920px rail. Here − and + live inside the tile, so the tile
// can be any width and the buttons stay under your thumb.

function GaugeTile({
  counter,
  big,
  onChange,
}: {
  counter: Counter;
  big?: boolean;
  onChange: (next: Counter) => void;
}) {
  const isClock = counter.display === 'clock';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-stone-800 bg-stone-900/70 p-3">
      <div className="flex items-baseline gap-2">
        <Name
          counter={counter}
          className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-widest text-stone-400"
        />
        <Refill counter={counter} onChange={onChange} big={big} />
      </div>

      {isClock ? (
        <div className="flex justify-center py-1">
          <ClockFace
            current={counter.current}
            max={counter.max!}
            size={big ? 84 : 60}
            onClick={() => onChange(bumped(counter, 1))}
            label={`${counter.name}: ${counter.current} of ${counter.max} — tap to advance`}
          />
        </div>
      ) : (
        // Centred in whatever height the tile was given, with the buttons
        // pinned below — a stretched tile should put its slack under the
        // number, not leave a hole beneath the controls.
        <div className="flex flex-1 flex-col justify-center gap-2">
          {/* Fluid, so the number is readable from across a table on a
              rail panel and still sane in a hand. A fixed size can only
              be right for one of them. */}
          <Value
            counter={counter}
            className={big ? 'text-[clamp(2rem,11vh,4rem)] leading-none' : 'text-2xl'}
          />
          <Bar counter={counter} thick={big} />
        </div>
      )}

      <div className="flex gap-2">
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

function TallyRow({
  counter,
  big,
  onChange,
}: {
  counter: Counter;
  big?: boolean;
  onChange: (next: Counter) => void;
}) {
  return (
    // Name and value share a line where there's room and wrap where
    // there isn't, rather than always stacking. Side-by-side-always gave
    // the name whatever the number didn't want — which at 10rem was
    // nothing, so five rows read as anonymous "0/—".
    <div className="flex items-center gap-2 rounded-lg bg-stone-900/70 px-2.5 py-1">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <Name counter={counter} className="text-sm leading-snug text-stone-400" />
        <Value counter={counter} className={big ? 'text-lg' : 'text-base'} />
      </div>
      <Step
        sign="−"
        big={big}
        label={`decrease ${counter.name}`}
        onClick={() => onChange(bumped(counter, -1))}
      />
      <Step
        sign="+"
        big={big}
        label={`increase ${counter.name}`}
        onClick={() => onChange(bumped(counter, 1))}
      />
    </div>
  );
}

export function Gauges({ counters, onChange, big }: CounterViewProps) {
  const { gauges, tallies } = split(counters);
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {gauges.length > 0 && (
        // auto-fit rather than a breakpoint: one column on a phone, four
        // across a rail, and it never needs to know which it's on. The
        // grid takes the leftover height and shares it between rows, so
        // spare room becomes a bigger target instead of a gap.
        <div
          className="grid flex-1 gap-2"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
            gridAutoRows: 'minmax(0, 1fr)',
          }}
        >
          {gauges.map((counter) => (
            <GaugeTile key={counter.id} counter={counter} big={big} onChange={update} />
          ))}
        </div>
      )}
      {tallies.length > 0 && (
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}
        >
          {tallies.map((counter) => (
            <TallyRow key={counter.id} counter={counter} big={big} onChange={update} />
          ))}
        </div>
      )}
    </div>
  );
}

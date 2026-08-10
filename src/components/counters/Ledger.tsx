import type { Counter } from '../../../worker/types';
import {
  bumped,
  fill,
  isGauge,
  isLow,
  Name,
  Refill,
  Step,
  Value,
  type CounterViewProps,
} from './shared';

// Ledger — everything, at once, quietly.
//
// The opposite bet from Dials: no hierarchy, no tiles, no decoration.
// One line per counter, columns aligned, in the order the sheet stores
// them. A player who wants to see their whole character without
// scrolling gets it; a rail panel fits a dozen lines with room to spare.
//
// It's also the honest control for the beta test. If Ledger wins, the
// tiles and rings were decoration and the real problem was just that the
// old rows were too tall.
//
// The only ink spent on meaning is a thin rule under each gauge showing
// how full it is — cheap enough to keep the line height, useful enough
// that you don't have to divide.

function Row({
  counter,
  big,
  onChange,
}: {
  counter: Counter;
  big?: boolean;
  onChange: (next: Counter) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-stone-800/70 px-1 py-1 last:border-0">
      <div className="min-w-0 flex-1">
        <Name counter={counter} className="block text-sm text-stone-300" />
        {isGauge(counter) && (
          <div className="mt-1 h-px w-full bg-stone-800">
            <div
              className={`h-px ${isLow(counter) ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${fill(counter) * 100}%` }}
            />
          </div>
        )}
      </div>
      <Value counter={counter} className={big ? 'text-lg' : 'text-sm'} />
      <Refill counter={counter} onChange={onChange} big={big} />
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

export function Ledger({ counters, onChange, big }: CounterViewProps) {
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));

  return (
    // 22rem, not 16: a name plus a value plus three controls needs the
    // room, and below it every label truncated to "Prestig…" twice over.
    // Stored order, deliberately — Ledger's whole claim is that it
    // doesn't rearrange anything on your behalf. Columns instead of
    // rows once there's width for them.
    <div
      className="grid min-h-0 flex-1 content-start gap-x-6"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))' }}
    >
      {counters.map((counter) => (
        <Row key={counter.id} counter={counter} big={big} onChange={update} />
      ))}
    </div>
  );
}

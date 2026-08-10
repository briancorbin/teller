import { useState } from 'react';
import type { Counter } from '../../../worker/types';
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

// Focus — the fight, and nothing else.
//
// During a fight a player touches two numbers. Everything else on the
// sheet is true but irrelevant until the fight ends, and on a phone it's
// what you scroll past to reach the thing you needed.
//
// So the spendable resources take the whole card, at a size you can hit
// without looking, and the tallies collapse behind one control. Not
// hidden — a fold, one tap, and it remembers nothing because between
// sessions you want it open and mid-fight you don't.
//
// The risk this layout is testing: does a player resent being told what
// matters? Ledger is the same data with that decision refused.

function BigGauge({
  counter,
  onChange,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 rounded-2xl border border-stone-800 bg-stone-900/70 p-4">
      <div className="flex items-baseline gap-2">
        <Name
          counter={counter}
          className="min-w-0 flex-1 text-xs font-medium uppercase tracking-widest text-stone-400"
        />
        <Refill counter={counter} onChange={onChange} big />
      </div>
      {/* Sized in viewport units so it's genuinely big on a rail strip and
          still sane on a phone, without a breakpoint deciding for it. */}
      <Value counter={counter} className="text-[clamp(2.5rem,9vh,5rem)] leading-none" />
      <Bar counter={counter} thick />
      <div className="flex gap-2">
        <Step
          sign="−"
          big
          className="h-16 flex-1 text-3xl"
          label={`decrease ${counter.name}`}
          onClick={() => onChange(bumped(counter, -1))}
        />
        <Step
          sign="+"
          big
          className="h-16 flex-1 text-3xl"
          label={`increase ${counter.name}`}
          onClick={() => onChange(bumped(counter, 1))}
        />
      </div>
    </div>
  );
}

export function Focus({ counters, onChange, big }: CounterViewProps) {
  const { gauges, tallies } = split(counters);
  const [showRest, setShowRest] = useState(false);
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        className="grid flex-1 gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gridAutoRows: 'minmax(0, 1fr)',
        }}
      >
        {gauges.map((counter) => (
          <BigGauge key={counter.id} counter={counter} onChange={update} />
        ))}
      </div>

      {tallies.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowRest(!showRest)}
            aria-expanded={showRest}
            className="w-full rounded-lg bg-stone-900/70 px-3 py-2 text-left text-xs uppercase tracking-widest text-stone-500 transition-colors hover:text-stone-300"
          >
            {showRest ? '▾' : '▸'} everything else ({tallies.length})
          </button>
          {showRest && (
            <div
              className="mt-1.5 grid gap-1.5"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}
            >
              {tallies.map((counter) => (
                <div
                  key={counter.id}
                  className="flex items-center gap-2 rounded-lg bg-stone-900/70 px-2.5 py-1.5"
                >
                  <Name counter={counter} className="min-w-0 flex-1 text-sm text-stone-400" />
                  <Value counter={counter} className="text-base" />
                  <Step
                    sign="−"
                    big={big}
                    label={`decrease ${counter.name}`}
                    onClick={() => update(bumped(counter, -1))}
                  />
                  <Step
                    sign="+"
                    big={big}
                    label={`increase ${counter.name}`}
                    onClick={() => update(bumped(counter, 1))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

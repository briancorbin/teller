import type { Counter } from '../../../worker/types';
import { ClockFace } from '../ClockFace';
import { bigBtn, iconBtn } from '../../lib/ui';
import { bumped, isBlank, isLow, Refill, type CounterViewProps } from './shared';

// Classic — what teller shipped first, kept verbatim as the control.
//
// A beta test with nothing to beat measures enthusiasm for redesign. So
// this is the old row, unchanged: − and + pushed to the outer edges by a
// flex-1 middle, one full-width row per counter, no hierarchy.
//
// Its flaws are the reason the others exist — seven rows overflow a
// phone, and on a 1920px rail the two buttons end up a foot apart — but
// it is also the simplest thing that works, and simple sometimes wins.
// If it does, that's a finding, not an embarrassment.

function ClassicRow({
  counter,
  big,
  onChange,
}: {
  counter: Counter;
  big?: boolean;
  onChange: (next: Counter) => void;
}) {
  const clock = counter.display === 'clock' && counter.max !== null && counter.max > 0;

  return (
    <div className="flex items-center gap-3">
      <button
        className={big ? bigBtn : iconBtn}
        onClick={() => onChange(bumped(counter, -1))}
        aria-label={`decrease ${counter.name}`}
      >
        −
      </button>
      <div className="min-w-0 flex-1 text-center">
        {clock ? (
          <div className="flex flex-col items-center">
            <ClockFace
              current={counter.current}
              max={counter.max!}
              size={big ? 72 : 52}
              onClick={() => onChange(bumped(counter, 1))}
              label={`${counter.name}: ${counter.current} of ${counter.max} — tap to advance`}
            />
          </div>
        ) : (
          <div
            className={`font-mono tabular-nums ${big ? 'text-3xl' : 'text-xl'} ${
              isLow(counter)
                ? 'text-red-400'
                : isBlank(counter)
                  ? 'text-stone-600'
                  : 'text-stone-100'
            }`}
          >
            {counter.current}
            <span className="text-stone-600">/{counter.max ?? '—'}</span>
          </div>
        )}
        <div className="truncate text-xs text-stone-400">
          {counter.name}
          {counter.hidden && <span className="ml-1 text-stone-600">· hidden</span>}
        </div>
      </div>
      <button
        className={big ? bigBtn : iconBtn}
        onClick={() => onChange(bumped(counter, 1))}
        aria-label={`increase ${counter.name}`}
      >
        +
      </button>
      <Refill counter={counter} onChange={onChange} big={big} />
    </div>
  );
}

export function Classic({ counters, onChange, big }: CounterViewProps) {
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));
  return (
    <div className="space-y-2">
      {counters.map((counter) => (
        <ClassicRow key={counter.id} counter={counter} big={big} onChange={update} />
      ))}
    </div>
  );
}

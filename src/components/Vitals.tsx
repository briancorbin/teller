import type { Counter } from '../../worker/types';

// A counter you can read across a table, and one you can change.
//
// The BAR is the glance and the NUMBER is the truth: 34 and 10 aren't
// comparable at speed, but two bars are. Nothing here derives anything
// — the stored value is what's drawn, and the steppers write straight
// back to it (rule 1). A counter with no max has no bar, because a
// bar would have to invent a ceiling to draw one.

/** How full, as a fraction, or null when the counter is unbounded. */
function fill(counter: Counter): number | null {
  if (counter.max === null || counter.max <= 0) return null;
  return Math.max(0, Math.min(1, counter.current / counter.max));
}

/**
 * Colour carries SEVERITY, not identity — which side someone is on is
 * already the row's left edge, and saying it twice just makes a
 * healthy party shout. A full bar is deliberately near-silent; the
 * eye should only be pulled to the ones in trouble.
 */
function tone(ratio: number): string {
  if (ratio <= 0) return 'bg-stone-800';
  if (ratio <= 0.3) return 'bg-red-600';
  if (ratio <= 0.6) return 'bg-amber-600';
  return 'bg-stone-600';
}

export function VitalBar({
  counter,
  className = '',
}: {
  counter: Counter;
  className?: string;
}) {
  const ratio = fill(counter);
  if (ratio === null) return null;
  return (
    <div className={`h-1 overflow-hidden rounded-full bg-stone-900 ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${tone(ratio)}`}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function CounterStepper({
  counter,
  onBump,
  big = false,
}: {
  counter: Counter;
  onBump: (delta: number) => void;
  big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className={`truncate ${big ? 'text-xs' : 'text-[11px]'} text-stone-400`}>
          {counter.name}
        </span>
        <span
          className={`ml-auto font-mono ${big ? 'text-base' : 'text-xs'} text-stone-100`}
        >
          {counter.current}
          {counter.max !== null && <span className="text-stone-600">/{counter.max}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            className="rounded px-1.5 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
            onClick={() => onBump(-1)}
            aria-label={`${counter.name} down`}
          >
            −
          </button>
          <button
            className="rounded px-1.5 text-sm text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
            onClick={() => onBump(1)}
            aria-label={`${counter.name} up`}
          >
            +
          </button>
        </span>
      </div>
      <VitalBar counter={counter} className="mt-1" />
    </div>
  );
}

import { useState } from 'react';
import type { Counter } from '../../../worker/types';
import { bumped, isGauge, Step, Value } from '../counters/shared';
import { SheetPanel } from './SheetPanel';

// A counter drawn as the printed sheet's tick boxes — WiW's
// Ace-in-the-Hole tally: six squares under the ability, one ticked per
// Ace rolled, all cleared when the ability fires or the posse rests.
//
// Generic on purpose (rule 2): this knows "a counter with a smallish
// max, shown as boxes", not the word "Ace". Which counter appears on
// which screen is the template's declaration (`screens[].counters`).
//
// Tapping a box proposes a value — tap the fourth box to set 4, tap the
// last filled box to untick it — and the steppers do what steppers do.
// All ordinary counter arithmetic: event-logged, undoable, and the
// console can type over it (rule 1).

/** Past this many boxes a row stops being readable; fall back to a number. */
const BOXES_LIMIT = 12;

/**
 * Would this counter draw as tick boxes here? Exported so the spare
 * screen can route a slot-shaped gauge (Supplies at 2/3) to this panel
 * and keep a big bar gauge (34/50) on the bar it wants.
 */
export function boxable(counter: Counter): boolean {
  return isGauge(counter) && (counter.max ?? 0) <= BOXES_LIMIT;
}

export function TallyPanel({
  counter,
  note,
  onChange,
  fill = false,
}: {
  counter: Counter;
  note?: string;
  onChange: (next: Counter) => void;
  fill?: boolean;
}) {
  const max = counter.max ?? 0;
  const boxes = isGauge(counter) && max <= BOXES_LIMIT;
  // Tap the number, type the number. Steppers are fine for spending a
  // Supply; they are misery for a $37 shop run. The input proposes into
  // the same slot everything else does — clamped, event-logged,
  // console-overridable (rule 1). Boxes don't need this: tapping a box
  // already IS naming a value.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Math.floor(Number(draft));
    setDraft(null);
    if (!Number.isFinite(n) || draft.trim() === '') return;
    const capped = counter.max !== null ? Math.min(n, counter.max) : n;
    const next = Math.max(0, capped);
    if (next !== counter.current) onChange({ ...counter, current: next });
  };

  return (
    <SheetPanel title={counter.name} note={note} fill={fill}>
      <div className="flex min-h-0 flex-1 flex-wrap content-center items-center justify-center gap-2">
        <Step
          sign="−"
          label={`decrease ${counter.name}`}
          onClick={() => onChange(bumped(counter, -1))}
        />
        {boxes ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {Array.from({ length: max }, (_, i) => {
              const filled = i < counter.current;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`set ${counter.name} to ${
                    filled && i === counter.current - 1 ? i : i + 1
                  }`}
                  onClick={() =>
                    onChange({
                      ...counter,
                      // Tapping the last filled box unticks it; any other
                      // box means "this many".
                      current: filled && i === counter.current - 1 ? i : i + 1,
                    })
                  }
                  className="h-8 w-8 rounded-[3px] border-2 transition-colors"
                  style={
                    filled
                      ? {
                          background: 'var(--sheet-accent, #f59e0b)',
                          borderColor: 'var(--sheet-accent, #f59e0b)',
                        }
                      : { borderColor: '#a8a29e' }
                  }
                />
              );
            })}
          </div>
        ) : draft !== null ? (
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            className="w-24 rounded-md border border-stone-600 bg-stone-950 px-2 py-1 text-center font-mono text-2xl text-stone-100 outline-none focus:border-amber-500"
            aria-label={`type a value for ${counter.name}`}
            defaultValue={counter.current}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
        ) : (
          <button
            type="button"
            aria-label={`edit ${counter.name}`}
            className="rounded-md px-1 transition-colors hover:bg-stone-800"
            onClick={() => setDraft(String(counter.current))}
          >
            <Value counter={counter} className="text-2xl" />
          </button>
        )}
        <Step
          sign="+"
          label={`increase ${counter.name}`}
          onClick={() => onChange(bumped(counter, 1))}
        />
      </div>
    </SheetPanel>
  );
}

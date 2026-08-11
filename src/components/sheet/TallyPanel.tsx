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
        ) : (
          <Value counter={counter} className="text-2xl" />
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

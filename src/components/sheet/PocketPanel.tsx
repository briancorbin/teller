import type { Counter } from '../../../worker/types';
import { bumped, Step, TypeableValue } from '../counters/shared';
import { boxable } from './TallyPanel';
import { Glyph } from './glyphs';

// The pocket: the counters a system dresses with icons, grouped into
// one slim tile of compact chips instead of full panels — Wallet,
// Scrap and Supplies at Inventory's left edge, in WiW's case, though
// nothing here knows those words (rule 2: `icons` declares membership,
// the glyph set is teller's).
//
// Each chip is the whole counter in one row: glyph, name, and either
// tick boxes (a slot-shaped gauge — spend a Supply by tapping it out)
// or a typeable number (money wants "$37", not thirty-seven taps).

function Chip({
  counter,
  icon,
  onChange,
}: {
  counter: Counter;
  icon: string;
  onChange: (next: Counter) => void;
}) {
  const max = counter.max ?? 0;
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5">
      <Glyph name={icon} className="h-5 w-5 shrink-0 text-stone-400" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[9px] uppercase tracking-widest text-stone-500">
          {counter.name}
        </span>
        {boxable(counter) ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
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
                      current:
                        filled && i === counter.current - 1 ? i : i + 1,
                    })
                  }
                  className="h-4 w-4 rounded-[2px] border-2 transition-colors"
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
          // Bare: 65, not 65/— — a wallet has no ceiling and the chip's
          // glyph already says what shape this is.
          <TypeableValue
            counter={counter}
            onChange={onChange}
            bare
            className="text-base"
            inputClassName="w-14 text-base"
          />
        )}
      </div>
      {/* Boxes are their own steppers; only the numbers need a pair. */}
      {!boxable(counter) && (
        <div className="flex shrink-0 gap-1">
          <Step
            sign="−"
            label={`decrease ${counter.name}`}
            onClick={() => onChange(bumped(counter, -1))}
          />
          <Step
            sign="+"
            label={`increase ${counter.name}`}
            onClick={() => onChange(bumped(counter, 1))}
          />
        </div>
      )}
    </div>
  );
}

export function PocketPanel({
  counters,
  icons,
  onChange,
  fill = false,
}: {
  counters: Counter[];
  icons: Record<string, string>;
  onChange: (next: Counter) => void;
  /** Stretch to the tile's height (the strip); natural height held. */
  fill?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1.5 ${
        fill ? 'min-h-0 flex-1 justify-center' : ''
      }`}
    >
      {counters.map((counter) => (
        <Chip
          key={counter.id}
          counter={counter}
          icon={icons[counter.name] ?? ''}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

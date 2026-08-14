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
  compact = false,
}: {
  counter: Counter;
  icon: string;
  onChange: (next: Counter) => void;
  /**
   * Side by side rather than stacked, and no name printed.
   *
   * Three chips across a phone have no room for "WALLET ($)" over the
   * number, and don't need it (Brian, 2026-08-14): the glyph is what
   * the counter IS, and a system that gave a counter a mark already
   * said the mark carries it. The word stays in `title` and
   * `aria-label`, so it's a press away and a screen reader still reads
   * the full thing.
   */
  compact?: boolean;
}) {
  const max = counter.max ?? 0;
  return (
    <div
      title={compact ? counter.name : undefined}
      className={`flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5 ${
        // An equal share of the row each, so three pockets read as one
        // band rather than three differently-sized boxes.
        compact ? 'min-w-0 flex-1' : ''
      }`}
    >
      <Glyph name={icon} className="h-5 w-5 shrink-0 text-stone-400" />
      <div className="flex min-w-0 flex-1 flex-col">
        {!compact && (
          <span className="text-[9px] uppercase tracking-widest text-stone-500">
            {counter.name}
          </span>
        )}
        {boxable(counter) ? (
          <div
            className={`flex flex-wrap items-center gap-1 ${
              compact ? '' : 'mt-0.5'
            }`}
          >
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
  row = false,
}: {
  counters: Counter[];
  icons: Record<string, string>;
  onChange: (next: Counter) => void;
  /** Stretch to the tile's height (the strip); natural height held. */
  fill?: boolean;
  /**
   * Shoulder to shoulder on one line, instead of a stack.
   *
   * What a character carries in loose change is three facts, and three
   * facts should cost one row of a sheet — not three, which is what a
   * phone was spending on them before the items even started.
   */
  row?: boolean;
}) {
  return (
    <div
      className={`flex gap-1.5 ${row ? 'flex-wrap' : 'flex-col'} ${
        fill ? 'min-h-0 flex-1 justify-center' : ''
      }`}
    >
      {counters.map((counter) => (
        <Chip
          key={counter.id}
          counter={counter}
          icon={icons[counter.name] ?? ''}
          onChange={onChange}
          compact={row}
        />
      ))}
    </div>
  );
}

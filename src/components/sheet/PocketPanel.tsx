import { useState } from 'react';
import type { Counter, SystemTemplate } from '../../../worker/types';
import { formatPrice, purseOf, purseTotal } from '../../../worker/items';
import { bumped, Step, stepOf, TypeableValue } from '../counters/shared';
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
        // Three equal shares of one row was too mean: a number and its
        // two steppers in 101px put the buttons over the top of the
        // figure they change. So the SHAPE decides how much room it
        // gets, not the name — a counter you step needs the width for
        // a number and two buttons, and one you tap out in boxes wants
        // a line of its own for the boxes.
        compact
          ? boxable(counter)
            ? 'w-full'
            : 'min-w-[9.5rem] flex-1'
          : ''
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
            onClick={() => onChange(bumped(counter, -stepOf(counter)))}
          />
          <Step
            sign="+"
            label={`increase ${counter.name}`}
            onClick={() => onChange(bumped(counter, stepOf(counter)))}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The purse: every denomination in one chip — the total at a glance,
 * the actual coins a tap away.
 *
 * The counts are the STORED facts (each denomination is an ordinary
 * counter, rule 2); the total is derived from the declared values and
 * never stored, so it can never disagree with the coins. Steppers move
 * whole coins; the odd figure is typed per denomination (rule 1).
 */
function Purse({
  counters,
  currency,
  icon,
  onChange,
  compact = false,
}: {
  counters: Counter[];
  currency: NonNullable<SystemTemplate['currency']>;
  icon: string;
  onChange: (next: Counter) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const purse = purseOf(counters, currency);
  if (!purse.length) return null;
  const total = purseTotal(counters, currency);
  const symbol = currency.symbol ?? '$';

  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5 ${
        compact ? 'min-w-[9.5rem] flex-1' : ''
      }`}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`purse, ${formatPrice(total, symbol)} — ${
          open ? 'close' : 'open'
        } the coin counts`}
      >
        <Glyph name={icon} className="h-5 w-5 shrink-0 text-stone-400" />
        {!compact && (
          <span className="text-[9px] uppercase tracking-widest text-stone-500">
            Purse
          </span>
        )}
        <span className="font-mono text-base tabular-nums text-stone-100">
          {formatPrice(total, symbol)}
        </span>
        <span className="ml-auto text-[10px] text-stone-600">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-1">
          {purse.map(({ counter }) => (
            <div key={counter.id} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 break-words text-[11px] text-stone-400">
                {counter.name}
              </span>
              <TypeableValue
                counter={counter}
                onChange={onChange}
                bare
                className="text-sm"
                inputClassName="w-12 text-sm"
              />
              <Step
                sign="−"
                label={`fewer ${counter.name}`}
                onClick={() => onChange(bumped(counter, -1))}
              />
              <Step
                sign="+"
                label={`more ${counter.name}`}
                onClick={() => onChange(bumped(counter, 1))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PocketPanel({
  counters,
  icons,
  currency,
  onChange,
  fill = false,
  row = false,
}: {
  counters: Counter[];
  icons: Record<string, string>;
  /** Declared money — the matching counters band into one purse chip. */
  currency?: SystemTemplate['currency'];
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
  const denomNames = new Set(
    (currency?.denominations ?? []).map((d) => d.counter),
  );
  const coins = counters.filter((c) => denomNames.has(c.name));
  const loose = counters.filter((c) => !denomNames.has(c.name));
  return (
    <div
      className={`flex gap-1.5 ${row ? 'flex-wrap' : 'flex-col'} ${
        fill ? 'min-h-0 flex-1 justify-center' : ''
      }`}
    >
      {currency && coins.length > 0 && (
        <Purse
          counters={coins}
          currency={currency}
          icon={icons.Purse ?? 'coin'}
          onChange={onChange}
          compact={row}
        />
      )}
      {loose.map((counter) => (
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

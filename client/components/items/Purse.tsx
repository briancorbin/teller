// The pocket: counters the system dresses with icons, banded into one
// slim tile — ported from the old app's `src/components/sheet/PocketPanel.tsx`.
// The denominations named in the `currency` record collapse into one
// Purse chip (a total, coins a tap away); every other iconed counter
// (Scrap, Supplies) gets its own compact chip beside it.

import { useState } from 'react';
import type { Entry } from '../../../core/entity.ts';
import { Glyph } from '../sheet/glyphs.tsx';
import type { CurrencyRecord } from './types.ts';

const BOXES_LIMIT = 12;

function isGauge(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0;
}

function boxable(entry: Entry): boolean {
  return isGauge(entry) && (entry.max ?? 0) <= BOXES_LIMIT;
}

function numberOf(entry: Entry): number {
  return typeof entry.value === 'number' ? entry.value : 0;
}

function formatPrice(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

function Chip({
  entry,
  icon,
  onWrite,
}: {
  entry: Entry;
  icon: string;
  onWrite: (value: number) => void;
}) {
  return (
    <div
      title={entry.name}
      className={`flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5 ${
        boxable(entry) ? 'w-full' : 'min-w-[9.5rem] flex-1'
      }`}
    >
      <Glyph name={icon} className="h-5 w-5 shrink-0 text-stone-400" />
      {boxable(entry) ? (
        <div className="flex flex-wrap items-center gap-1">
          {Array.from({ length: entry.max ?? 0 }, (_, i) => {
            const filled = i < numberOf(entry);
            return (
              <button
                key={i}
                type="button"
                aria-label={`set ${entry.name} to ${filled && i === numberOf(entry) - 1 ? i : i + 1}`}
                onClick={() => onWrite(filled && i === numberOf(entry) - 1 ? i : i + 1)}
                className="h-4 w-4 shrink-0 rounded-[2px] border-2 transition-colors"
                style={
                  filled
                    ? { background: 'var(--sheet-accent, #f59e0b)', borderColor: 'var(--sheet-accent, #f59e0b)' }
                    : { borderColor: '#a8a29e' }
                }
              />
            );
          })}
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-base tabular-nums text-stone-100">
          {numberOf(entry)}
        </span>
      )}
      {!boxable(entry) && (
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={`decrease ${entry.name}`}
            onClick={() => onWrite(Math.max(0, numberOf(entry) - 1))}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-800 text-stone-200 hover:bg-stone-700"
          >
            −
          </button>
          <button
            type="button"
            aria-label={`increase ${entry.name}`}
            onClick={() => onWrite(numberOf(entry) + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-800 text-stone-200 hover:bg-stone-700"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function PurseChip({
  entries,
  currency,
  icon,
  onWrite,
}: {
  entries: Entry[];
  currency: CurrencyRecord;
  icon: string;
  onWrite: (name: string, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const denoms = currency.denominations ?? [];
  const held = denoms
    .map((d) => ({ d, entry: entries.find((e) => e.name === d.counter) }))
    .filter((x): x is { d: (typeof denoms)[number]; entry: Entry } => Boolean(x.entry));
  if (!held.length) return null;
  const total = held.reduce((sum, { d, entry }) => sum + numberOf(entry) * d.value, 0);
  const symbol = currency.symbol ?? '$';

  return (
    <div className="flex min-w-[9.5rem] flex-1 flex-col gap-1 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`purse, ${formatPrice(total, symbol)} — ${open ? 'close' : 'open'} the coin counts`}
      >
        <Glyph name={icon} className="h-5 w-5 shrink-0 text-stone-400" />
        <span className="font-mono text-base tabular-nums text-stone-100">{formatPrice(total, symbol)}</span>
        <span className="ml-auto text-[10px] text-stone-600">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-stone-800 pt-1">
          {held.map(({ entry }) => (
            <div key={entry.name} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 break-words text-[11px] text-stone-400">{entry.name}</span>
              <span className="font-mono text-sm tabular-nums text-stone-100">{numberOf(entry)}</span>
              <button
                type="button"
                aria-label={`fewer ${entry.name}`}
                onClick={() => onWrite(entry.name, Math.max(0, numberOf(entry) - 1))}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-stone-800 text-sm text-stone-200 hover:bg-stone-700"
              >
                −
              </button>
              <button
                type="button"
                aria-label={`more ${entry.name}`}
                onClick={() => onWrite(entry.name, numberOf(entry) + 1)}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-stone-800 text-sm text-stone-200 hover:bg-stone-700"
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The pocket: the purse chip (when the character has any denomination) plus every other iconed counter, banded together at the left of Inventory. */
export function Pocket({
  entries,
  icons,
  currency,
  onWrite,
}: {
  entries: Entry[];
  icons: Record<string, string>;
  currency?: CurrencyRecord;
  onWrite: (name: string, value: number) => void;
}) {
  const denomNames = new Set((currency?.denominations ?? []).map((d) => d.counter));
  const coins = entries.filter((e) => denomNames.has(e.name));
  const loose = entries.filter((e) => !denomNames.has(e.name));
  if (!coins.length && !loose.length) return null;
  return (
    <div className="flex w-full flex-wrap gap-1.5">
      {currency && coins.length > 0 && (
        <PurseChip entries={coins} currency={currency} icon={icons.Purse ?? 'coin'} onWrite={onWrite} />
      )}
      {loose.map((entry) => (
        <Chip key={entry.name} entry={entry} icon={icons[entry.name] ?? ''} onWrite={(v) => onWrite(entry.name, v)} />
      ))}
    </div>
  );
}

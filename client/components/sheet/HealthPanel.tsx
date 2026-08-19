import type { Entry } from '../../../core/entity.ts';
import { SheetPanel } from './SheetPanel.tsx';

// The HEALTH block: the resource, flanked by the two numbers that bound
// it — the ceiling on one side, Defense (or whatever the system pins)
// on the other.
//
// Ported from the old app (src/components/sheet/HealthPanel.tsx). The
// seam: the old `Counter` had its own `max`/`current`; the new `Entry`
// has `value?`/`max?` and its pinned fields arrive as plain `Entry[]`
// resolved by the caller (`pins` record → stats/meta list lookup)
// rather than `Field[]` looked up here.
//
// Nothing here is game-specific (rule 2). "A gauge with some fields
// pinned beside it" is a shape; the system's `pins` record says which.

const BOX_H = '3rem';

function numberOf(entry: Entry): number {
  return typeof entry.value === 'number' ? entry.value : 0;
}

function fraction(entry: Entry): number {
  if (typeof entry.max !== 'number' || entry.max <= 0) return 0;
  return Math.max(0, Math.min(1, numberOf(entry) / entry.max));
}

function isLow(entry: Entry): boolean {
  return typeof entry.max === 'number' && entry.max > 0 && fraction(entry) <= 0.25;
}

/** One of the small flanking boxes: value big, label under it. */
function StatBox({
  value,
  label,
  accented,
}: {
  value: string;
  label: string;
  accented?: boolean;
}) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-center gap-0.5">
      <div
        className="flex min-w-[2.8rem] items-center justify-center rounded-[3px] border-2 px-1.5"
        style={{
          height: BOX_H,
          borderColor: accented ? 'var(--sheet-accent, #f59e0b)' : '#a8a29e',
        }}
      >
        <span className="whitespace-nowrap font-mono text-[1.1rem] tabular-nums text-stone-100">
          {value}
        </span>
      </div>
      <span className="max-w-[4.5rem] break-words text-center text-[9px] uppercase leading-tight tracking-[0.18em] text-stone-500">
        {label}
      </span>
    </div>
  );
}

function Bump({
  sign,
  label,
  onClick,
  grow,
}: {
  sign: '−' | '+';
  label: string;
  onClick: () => void;
  grow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={grow ? { height: BOX_H } : { height: BOX_H, width: BOX_H }}
      className={`flex select-none items-center justify-center rounded-md border border-stone-600 bg-stone-800 text-2xl leading-none text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-600 active:text-stone-950 ${
        grow ? 'min-w-0 flex-1' : 'shrink-0'
      }`}
    >
      {sign}
    </button>
  );
}

function Refill({
  entry,
  onSet,
}: {
  entry: Entry;
  onSet: (next: number) => void;
}) {
  const canRefill = typeof entry.max === 'number' && numberOf(entry) < entry.max;
  return (
    <button
      type="button"
      disabled={!canRefill}
      onClick={() => onSet(entry.max!)}
      aria-label={`refill ${entry.name}`}
      title="refill to max"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-amber-300 disabled:pointer-events-none disabled:opacity-0"
    >
      ↻
    </button>
  );
}

export function HealthPanel({
  entry,
  pinned,
  onSet,
  title,
  note,
  vertical = false,
  fill = false,
}: {
  entry: Entry;
  /** Entries the system pinned to this counter — Defense, for WiW. */
  pinned: Entry[];
  onSet: (next: number) => void;
  title?: string;
  note?: string;
  /** Stack the row instead of laying it out across (short-and-wide loses the width for this). */
  vertical?: boolean;
  /** Grow to fill the column — see `SheetPanel`. */
  fill?: boolean;
}) {
  const low = isLow(entry);
  const value = numberOf(entry);
  const step = (delta: number) => onSet(Math.max(0, Math.min(entry.max ?? Infinity, value + delta)));

  return (
    <SheetPanel title={title ?? entry.name} note={note} fill={fill}>
      <div
        className={`flex justify-center gap-2 ${
          vertical ? 'flex-col items-stretch' : 'items-start'
        }`}
      >
        {typeof entry.max === 'number' && (
          <StatBox value={String(entry.max)} label="max" accented />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className={`flex gap-1.5 ${
              vertical ? 'flex-col items-stretch' : 'items-center'
            }`}
          >
            {!vertical && (
              <Bump sign="−" label={`decrease ${entry.name}`} onClick={() => step(-1)} />
            )}
            <div
              className="flex min-w-0 flex-1 items-center justify-center rounded-[3px] border-2 border-stone-400 px-2"
              style={{ height: BOX_H }}
            >
              <span
                className={`whitespace-nowrap font-mono tabular-nums leading-[1.15] ${
                  low ? 'text-red-400' : 'text-stone-100'
                }`}
                style={{ fontSize: '2rem' }}
              >
                {value}
              </span>
            </div>
            {vertical ? (
              <div className="flex gap-1.5">
                <Bump sign="−" label={`decrease ${entry.name}`} onClick={() => step(-1)} grow />
                <Bump sign="+" label={`increase ${entry.name}`} onClick={() => step(1)} grow />
              </div>
            ) : (
              <Bump sign="+" label={`increase ${entry.name}`} onClick={() => step(1)} />
            )}
          </div>

          {typeof entry.max === 'number' && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: `${fraction(entry) * 100}%`,
                    background: low ? '#ef4444' : 'var(--sheet-accent, #f59e0b)',
                  }}
                />
              </div>
              <Refill entry={entry} onSet={onSet} />
            </div>
          )}
        </div>

        {pinned.map((field) => (
          <StatBox
            key={field.name}
            value={field.value !== undefined && field.value !== '' ? String(field.value) : '—'}
            label={field.name}
          />
        ))}
      </div>
    </SheetPanel>
  );
}

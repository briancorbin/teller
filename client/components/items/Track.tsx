// A die pool, drawn as the track of boxes the printed sheet prints —
// ported from the old app's `src/components/sheet/Track.tsx`, trimmed
// to what an item's stat row needs: no starburst, no Talent bonus slot
// (those are `Skills`' own furniture — a weapon's Arm's Reach/Short
// Range/Long Range are plain runs of boxes on the printed page). The
// value itself decides whether it's a pool at all (`isPool`), so this
// draws a weapon's "1B", a skill-shaped value, or a plain word
// ("Premium", "$60.00") without being told which it has.

import { expandPool, isPool } from '../../lib/dice.ts';

function Slot({ die }: { die?: string }) {
  return (
    <span
      className={`flex h-[1.35rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border font-serif text-[0.8rem] italic leading-none ${
        die
          ? 'border-stone-200 bg-stone-200 text-stone-900'
          : 'border-stone-400 bg-transparent text-transparent'
      }`}
      title={die ?? 'empty'}
    >
      {die ?? '·'}
    </span>
  );
}

/** A single stat's value: a track of dice if it parses as a pool, a box if it's short, a line if it's prose. */
export function PoolValue({ value }: { value: string }) {
  if (isPool(value)) {
    const owned = expandPool(value);
    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {owned.map((die, i) => (
          <Slot key={i} die={die} />
        ))}
      </div>
    );
  }
  if (value.length > 0 && value.length <= 6) {
    return (
      <span className="flex h-7 min-w-8 items-center justify-center rounded-[3px] border-2 border-stone-400 px-1.5 font-mono text-sm text-stone-100">
        {value}
      </span>
    );
  }
  return <span className="break-words font-mono text-sm text-stone-200">{value || '—'}</span>;
}

/** One row of a stat block — the label at a fixed width, the value shaped by `PoolValue`. Long prose drops the label onto its own line above the text, same as the old `StatRow`. */
export function StatRow({ label, value }: { label: string; value: string }) {
  const prose = !isPool(value) && value.length > 22;
  const Label = (
    <span
      className={`break-words text-[0.7rem] uppercase leading-tight tracking-[0.1em] ${
        prose ? '' : 'w-[6rem] shrink-0'
      }`}
      style={{ color: 'var(--sheet-accent, #f59e0b)' }}
    >
      {label}
    </span>
  );
  if (prose) {
    return (
      <div className="flex flex-col gap-0.5 py-1">
        {Label}
        <span className="break-words text-[0.8rem] leading-snug text-stone-300">{value}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 py-0.5">
      {Label}
      <PoolValue value={value} />
    </div>
  );
}

import type { SystemTemplate } from '../../../worker/types';
import { looksLikePool, Track } from './Track';

// One line of a stat block, shaped by what the value IS.
//
// Lifted out of `ItemPanel` when the store grew a detail view (Brian,
// 2026-08-14): the shop and the sheet are two moments of the same
// object, and a rifle's Short Range should draw itself identically at
// the gunsmith's and in your hands. Two renderers would have drifted
// within a week.
//
// Three shapes, all DERIVED rather than declared, which is what lets one
// renderer draw a weapon's Grit cost, its ranges and its upgrades
// without being told which is which:
//
//   * **a pool** → the track, exactly as a Skill draws it
//   * **something short** → a box, like the printed Grit square
//   * **prose** → the label on its own line with the text beneath, which
//     is how the sheet prints upgrades: a name, then what it does.
//     Forcing those through a label column crushed "Kickback Stabilizer"
//     into a two-line sliver beside its own effect.

/** Past this a value is a word on a line, not a number in a box. */
export const BOXY = 4;
/** Past this it is prose, and prose does not belong in a label column. */
export const PROSE = 22;

export function StatRow({
  label,
  value,
  dice,
  overridden,
  derived,
}: {
  label: string;
  value: string;
  dice?: SystemTemplate['dice'];
  /** A person typed this and the derivation stepped aside (rule 1). */
  overridden?: boolean;
  derived?: string;
}) {
  const pool = looksLikePool(value, dice);
  const boxy = !pool && value.length > 0 && value.length <= BOXY;
  const prose = !pool && !boxy && value.length > PROSE;

  const Label = (
    <span
      className={`break-words text-[0.7rem] uppercase leading-tight tracking-[0.1em] ${
        prose ? '' : 'w-[6.5rem] shrink-0 text-right'
      }`}
      style={{ color: 'var(--sheet-accent, #f59e0b)' }}
    >
      {label}
    </span>
  );

  if (prose) {
    return (
      <div className="flex flex-col gap-0.5 border-l-2 border-stone-700 py-1 pl-2">
        {Label}
        <span className="break-words text-[0.8rem] leading-snug text-stone-300">
          {value}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      {Label}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {boxy ? (
          <span className="flex h-7 min-w-8 items-center justify-center rounded-[3px] border-2 border-stone-400 px-1.5 font-mono text-sm text-stone-100">
            {value}
          </span>
        ) : (
          <Track value={value} dice={dice} bonus={0} />
        )}
        {/* Marked, not hidden. A number somebody typed over the book's
            beats it (rule 1) — and the player should be able to see
            that it was overridden, and what it was. */}
        {overridden && (
          <span
            className="whitespace-nowrap text-[0.6rem] uppercase tracking-wider text-stone-500"
            title={derived ? `the book and its upgrades say ${derived}` : undefined}
          >
            · set by hand{derived ? ` (was ${derived})` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

import type { SystemTemplate } from '../../../worker/types';
import { parsePool } from '../../../worker/dice';

// A die pool, drawn as the track of boxes the sheet prints.
//
// Extracted because the printed page uses it in two places and they must
// not drift: once per Skill, and three times per Weapon — Arm's Reach,
// Short Range, Long Range are the same six boxes with the same starburst
// and the same bonus slot. Two copies of this would have become two
// slightly different tracks within a week.
//
// **Whether a value IS a pool is derived, never declared.** `parsePool`
// reads it against the faces the system says it has, so "3B1G" becomes
// three boxes, a star and one box, while "Normal" and "Marshal" stay
// words. That single test is what lets the same row renderer handle a
// skill, a weapon's range and anything else a system writes as dice.

/**
 * The sheet's mark between one kind of die and the next.
 *
 * Drawn here rather than lifted out of the PDF. The book's own glyph is
 * their artwork; a starburst is a starburst, and this one costs nothing
 * to ship in a public repo (rule 4). If Boylei ever wants their actual
 * mark, that arrives in a pack as the skin.
 */
export function Starburst({ size = 14 }: { size?: number }) {
  const points = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return `${50 + 48 * Math.cos(a)},${50 + 48 * Math.sin(a)}`;
  });
  const inner = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    return `${50 + 18 * Math.cos(a)},${50 + 18 * Math.sin(a)}`;
  });
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p} L ${inner[i]}`)
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={`${d} Z`} fill="var(--sheet-accent, #f59e0b)" />
    </svg>
  );
}

/**
 * One slot on the track.
 *
 * The printed sheet draws the WHOLE track and you write the die's letter
 * into each slot you own. That distinction is the whole point: an empty
 * slot and a slot that doesn't exist have to look different, and a
 * player should see "three of a possible six" without counting anything.
 */
function Slot({ die, bonus }: { die?: string; bonus?: boolean }) {
  return (
    <span
      className={`flex h-[1.35rem] w-[1.15rem] shrink-0 items-center justify-center rounded-[2px] border font-serif text-[0.8rem] italic leading-none ${
        die
          ? 'border-stone-200 bg-stone-200 text-stone-900'
          : bonus
            ? 'border-stone-500 bg-stone-800/40 text-transparent'
            : 'border-stone-400 bg-transparent text-transparent'
      }`}
      title={die ? die : 'empty'}
    >
      {die ?? '·'}
    </span>
  );
}

/**
 * Does this value read as dice at all?
 *
 * Exported because a caller sometimes needs to know BEFORE rendering —
 * `ItemPanel` puts a short plain value in a box and a pool on a track,
 * and it has to choose the container first.
 */
export function looksLikePool(
  value: string,
  dice?: SystemTemplate['dice'],
): boolean {
  if (!dice) return false;
  return parsePool(value ?? '', dice.faces).length > 0;
}

/**
 * The value as a track when it parses as dice, and as words when it
 * doesn't. Callers don't have to know which they have.
 */
export function Track({
  value,
  dice,
  bonus: bonusOverride,
}: {
  value: string;
  dice?: SystemTemplate['dice'];
  /**
   * Slots past the starburst, when this track has any.
   *
   * The system declares one for SKILLS, and the printed sheet draws it
   * there — but a weapon's range tracks are plain six-box runs, and the
   * starburst on that block sits once beside the Model rather than on
   * each range. Applying the declared bonus everywhere put a spurious
   * extra box on all three ranges of every weapon.
   */
  bonus?: number;
}) {
  const pool = dice ? parsePool(value ?? '', dice.faces) : [];
  // The dice this one owns, spread out one per slot, in the order the
  // value was written: "3B1G" → B B B G.
  const owned = pool.flatMap(({ die, count }) =>
    Array.from({ length: count }, () => die),
  );
  const declared = dice?.track ?? 0;
  // A track only for things that ARE pools. A declared track was drawing
  // six empty boxes for "Marshal" and throwing the word away.
  const slots = owned.length ? Math.max(declared, owned.length) : 0;
  const bonus = bonusOverride ?? dice?.trackBonus ?? 0;

  if (!slots) {
    return (
      <span className="break-words font-mono text-sm text-stone-200">
        {value || '—'}
      </span>
    );
  }

  return (
    <>
      {Array.from({ length: slots }, (_, i) => (
        <Slot key={i} die={owned[i]} />
      ))}
      {bonus > 0 && (
        <>
          <Starburst />
          {Array.from({ length: bonus }, (_, i) => (
            <Slot key={`b${i}`} die={owned[slots + i]} bonus />
          ))}
        </>
      )}
    </>
  );
}

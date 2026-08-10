import { useState } from 'react';
import type { Field, PackEntry, SystemTemplate } from '../../../worker/types';
import { parsePool } from '../../../worker/dice';
import { InfoDot, InfoPopover } from './InfoPopover';
import { SheetPanel } from './SheetPanel';

// The skills block, arranged like the printed sheet.
//
// On paper it is: the skill's name in orange, right-aligned against a
// vertical rule, and to the right of that rule a TRACK OF BOXES — one
// per die in the pool — with a starburst separating the two kinds. So
// "3B1G" isn't notation you decode, it's three boxes, a star, one box.
// That's the bit worth copying: the sheet shows a pool as a quantity you
// can see rather than a code you parse.
//
// **No publisher text.** The sheet also prints a descriptor under each
// skill ("convince, barter, intimidate, calm") and a quick-build hint.
// Both are the publisher's prose, so neither is in here — that's the
// skin layer, and it belongs in a pack (TEL-63). The panel leaves room
// for them and renders nothing when nobody supplies them.
//
// **No game knowledge either** (rule 2). The letters are not hardcoded:
// `parsePool` reads the value against the faces the SYSTEM declares, so
// a system with d6s and d10s gets its own track for free, and one with
// no dice declared falls back to showing the value as written.

/**
 * The sheet's mark between one kind of die and the next.
 *
 * Drawn here rather than lifted out of the PDF. The book's own glyph is
 * their artwork; a starburst is a starburst, and this one costs nothing
 * to ship in a public repo (rule 4). If Boylei ever wants their actual
 * mark on this panel, that arrives in a pack as the skin.
 */
function Starburst({ size = 14 }: { size?: number }) {
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
 * player should be able to see "three of a possible six" without
 * counting anything.
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

function SkillRow({
  field,
  dice,
  entry,
  open,
  onToggleInfo,
}: {
  field: Field;
  dice?: SystemTemplate['dice'];
  /** The pack's entry for this skill, when it has one. */
  entry?: PackEntry & { section?: string };
  open: boolean;
  onToggleInfo: () => void;
}) {
  const pool = dice ? parsePool(field.value ?? '', dice.faces) : [];
  // The dice this character owns, spread out one per slot, in the order
  // the value was written: "3B1G" → B B B G.
  const owned = pool.flatMap(({ die, count }) => Array.from({ length: count }, () => die));
  const track = dice?.track ?? 0;
  // A track only for things that ARE pools. "Marshal" and "Normal" live
  // in these rows too, and a declared track was drawing them six empty
  // boxes and throwing the word away.
  const slots = owned.length ? Math.max(track, owned.length) : 0;
  const bonus = dice?.trackBonus ?? 0;

  return (
    <div className="flex items-center gap-2.5 py-1">
      {/* Name right-aligned against the rule, as printed. */}
      <div className="w-[6.5rem] shrink-0 text-right">
        <div
          className="text-[clamp(0.8rem,4cqw,1.15rem)] font-bold uppercase leading-tight tracking-wide"
          style={{ color: 'var(--sheet-accent, #f59e0b)' }}
        >
          {field.label}
        </div>
      </div>

      <div className="w-px self-stretch bg-stone-600" />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {slots > 0 ? (
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
        ) : (
          // Not every stat is a pool — Trade says "Marshal", Speed says
          // "Normal". Those get their words, not an empty track.
          <span className="break-words font-mono text-sm text-stone-200">
            {field.value || '—'}
          </span>
        )}
      </div>

      {/* The sheet prints "convince, barter, intimidate, calm" under each
          skill. That's the publisher's prose, so it can only come from a
          pack — and when one supplies it, it arrives on tap rather than
          on the card, which is what keeps the panel the same height on a
          phone as on a rail. No entry, no dot. */}
      {entry?.text ? (
        <InfoDot onClick={onToggleInfo} open={open} label={field.label} />
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}

export function SkillPanel({
  fields,
  dice,
  title = 'Skills',
  lookup,
}: {
  fields: Field[];
  dice?: SystemTemplate['dice'];
  /** The sheet's own heading for this block, when a pack supplies one. */
  title?: string;
  /** Finds a skill's pack entry, so its description can open on tap. */
  lookup?: (name: string) => (PackEntry & { section: string }) | undefined;
}) {
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  if (!fields.length) return null;

  const shown = openInfo ? lookup?.(openInfo) : undefined;

  return (
    // Full width of whatever column it's in; hugging the CONTENT is the
    // parent's job. `self-start` here meant align-self on the cross axis,
    // which in a flex column is horizontal — the panel collapsed to a
    // sliver and every die box wrapped onto its own line.
    //
    // The frame, corner ticks and heading now come from `SheetPanel`,
    // which every block on the page shares.
    <SheetPanel title={title} className="relative w-full">
      <div className="divide-y divide-stone-800/80">
        {fields.map((field) => (
          <SkillRow
            key={field.key}
            field={field}
            dice={dice}
            entry={lookup?.(field.label)}
            open={openInfo === field.label}
            onToggleInfo={() =>
              setOpenInfo(openInfo === field.label ? null : field.label)
            }
          />
        ))}
      </div>

      {shown && <InfoPopover entry={shown} onClose={() => setOpenInfo(null)} />}
    </SheetPanel>
  );
}

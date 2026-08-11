import { useState } from 'react';
import type { Field, PackEntry, SystemTemplate } from '../../../worker/types';
import { InfoPopover } from './InfoPopover';
import { SheetPanel } from './SheetPanel';
import { Track } from './Track';

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
  return (
    <div className="flex items-center gap-2.5 py-1">
      {/* Name right-aligned against the rule, as printed — and it IS the
          disclosure. The sheet prints "convince, barter, intimidate,
          calm" under each skill; that's the publisher's prose, so it can
          only come from a pack, and when one supplies it the words
          arrive on tap rather than on the card. That keeps the panel the
          same height on a phone as on a rail.

          The name rather than a separate ⓘ: the dot cost a column and
          made the smallest target in the row the one carrying the text.
          No entry, no target — the name just stops being a button. */}
      <button
        type="button"
        disabled={!entry?.text}
        onClick={onToggleInfo}
        aria-expanded={open}
        aria-label={entry?.text ? `what does ${field.label} do` : field.label}
        className="w-[7.5rem] shrink-0 rounded px-1 py-0.5 text-right transition-colors enabled:hover:bg-stone-800/60 disabled:cursor-default"
      >
        <span
          // Capped at 1rem, and the column widened to match. At 1.15rem
          // "INTUITION" was wider than the 6.5rem column and broke onto
          // two lines — the label wraps rather than clipping, which is
          // correct, but a skill name on two lines is still wrong.
          className="block break-words text-[1rem] font-bold uppercase leading-tight tracking-wide"
          style={{ color: 'var(--sheet-accent, #f59e0b)' }}
        >
          {field.label}
        </span>
      </button>

      <div className="w-px self-stretch bg-stone-600" />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <Track value={field.value} dice={dice} />
      </div>
    </div>
  );
}

export function SkillPanel({
  fields,
  dice,
  title = 'Skills',
  lookup,
  note,
  fill = false,
}: {
  fields: Field[];
  dice?: SystemTemplate['dice'];
  /** The sheet's own heading for this block, when a pack supplies one. */
  title?: string;
  /** The line the sheet sets under that heading. Pack-supplied only. */
  note?: string;
  /** Grow to fill the column — see `SheetPanel`. */
  fill?: boolean;
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
    <SheetPanel title={title} note={note} fill={fill} className="relative w-full">
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

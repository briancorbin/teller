import type { Field } from '../../../worker/types';

// The plate at the top of the sheet.
//
// On paper the first thing on the page is the character's ROLE, set in
// the display face inside its own ruled box — "THE DOCTOR" — with the
// player's own name in a second box beside it. It's the loudest thing
// there, and it's what tells you at a glance whose sheet you picked up.
//
// It also carries the theme. Each trade's sheet is printed in its own
// colour, which is why this component and the accent arrive together:
// the plate is where the colour is most obviously the point.

export function TradePlate({
  field,
  accent,
}: {
  field?: Field;
  /** Already resolved by the card; here only to tint the rules. */
  accent?: string;
}) {
  const value = field?.value?.trim();
  if (!value) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-3 rounded-md border px-3 py-2"
      style={{ borderColor: `${accent ?? '#f59e0b'}66` }}
    >
      <span className="h-px flex-1" style={{ background: `${accent ?? '#f59e0b'}55` }} />
      <div className="text-center">
        {/* The sheet says "THE DOCTOR" — the article is part of the
            printed plate, not part of the value, so it's added here
            rather than stored on anybody's character. */}
        <div
          // `leading-none` clips the line box for uppercase display type
          // — the cap heights and the tracking need a little more room
          // than the font's own em box gives them.
          className="font-serif text-[1.6rem] font-bold uppercase leading-[1.15] tracking-[0.12em]"
          style={{ color: accent ?? '#f59e0b' }}
        >
          {value}
        </div>
        {field?.label && (
          <div className="mt-0.5 text-[9px] uppercase tracking-[0.3em] text-stone-500">
            {field.label}
          </div>
        )}
      </div>
      <span className="h-px flex-1" style={{ background: `${accent ?? '#f59e0b'}55` }} />
    </div>
  );
}

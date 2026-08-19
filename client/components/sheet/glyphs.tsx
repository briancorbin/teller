// The seat chrome's tab glyphs — ported from the old app
// (src/components/sheet/glyphs.tsx), trimmed to the marks the new
// stack's declared screens actually use (`icons`/screen names: sheet,
// sixgun, star, satchel, more, coin). Line drawings in the card's own
// style, one stroke weight, no fills, currentColor so they take the
// text's tone.
//
// The set is teller's own; the ASSIGNMENT is the system's (`icons` in
// the template, or a screen's own `icon` — rule 2). A glyph name
// nothing here knows draws nothing, and the tab wearing it still works
// (see `Screens.tsx`'s bare-word fallback, ported into `SeatChrome`).

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const GLYPHS: Record<string, React.ReactNode> = {
  // A coin on its edge-lines: two circles and a stamped center.
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 9.5v5" />
    </>
  ),
  // A satchel: flap over body, strap stub below the buckle.
  satchel: (
    <>
      <path d="M4.5 9.5h15v9a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-9z" />
      <path d="M4.5 9.5 7 5h10l2.5 4.5" />
      <path d="M12 13v3" />
    </>
  ),
  // The sheet: a sheet of paper with a fold, ruled twice.
  sheet: (
    <>
      <path d="M6 3.2h8.5L18 6.7v14.1H6z" />
      <path d="M14.5 3.2v3.5H18" />
      <path d="M8.8 11.5h6.4M8.8 15h6.4" />
    </>
  ),
  // A revolver: barrel, cylinder, grip, trigger guard.
  sixgun: (
    <>
      <path d="M3.4 8.6h13.9v3.6H3.4z" />
      <circle cx="8.4" cy="10.4" r="1.5" />
      <path d="M17.3 9.4h3.3" />
      <path d="M11.6 12.2l-2.3 7.4a1 1 0 0 1-1 .7H6.6" />
      <path d="M5.2 12.2c.6 1.7 1.9 2.6 3.6 2.7" />
    </>
  ),
  // A star, five points — the sheriff's, and what an ability is worth.
  star: (
    <path d="M12 3.1l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L3.4 9.3l6.1-.6z" />
  ),
  // The junk drawer: three chevrons, the universal "and the rest".
  more: (
    <>
      <circle cx="5.6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.4" cy="12" r="1.3" />
    </>
  ),
};

export function Glyph({
  name,
  className = '',
}: {
  name: string;
  className?: string;
}) {
  const art = GLYPHS[name];
  if (!art) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE}>
      {art}
    </svg>
  );
}

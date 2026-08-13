// The sheet's glyph set — line drawings in the card's own style, one
// stroke weight, no fills, currentColor so they take the text's tone.
//
// The set is teller's; the ASSIGNMENT is the system's (`icons` in the
// template — counter name → glyph name, rule 2). A glyph name nothing
// here knows draws nothing, and the chip wearing it still works.

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
  // A cog: hub, ring, and eight teeth.
  cog: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18" />
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

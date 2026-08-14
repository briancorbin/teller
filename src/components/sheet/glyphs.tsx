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

  // The four skills get marks of their own. The Guidebook prints none,
  // so these are drawn from what the book says each skill DOES rather
  // than copied from anything: the tipped hat you greet somebody with,
  // the ace the book itself names as the example of a careful hand, the
  // track you read off the ground, the shoe you'd hang for grit.

  // A hat, tipped: creased crown over a lens-shaped brim.
  hat: (
    <>
      <path d="M7 15.2C6.2 10.6 7.1 5.6 12 5.6s5.8 5 5 9.6" />
      <path d="M9 7.8q3 1.7 6 0" />
      <path d="M3 15.4c4 2.7 14 2.7 18 0" />
      <path d="M3 15.4c3.5-1.8 14.5-1.8 18 0" />
    </>
  ),
  // A card with a pip, and the corner of the one hidden behind it.
  card: (
    <>
      <rect x="8.6" y="3.4" width="10.8" height="17.2" rx="1.6" />
      <path d="M14 8.4l2.3 2.9-2.3 2.9-2.3-2.9z" />
      <path d="M6.4 6.2l-1.5.6a1.6 1.6 0 0 0-.9 2l3.1 9.5" />
    </>
  ),
  // A track in the dirt: pad and three toes.
  track: (
    <>
      <path d="M8 14.8c0-2.3 1.9-3.6 4-3.6s4 1.3 4 3.6-1.8 4.1-4 4.1-4-1.7-4-4.1z" />
      <ellipse cx="7.5" cy="8.9" rx="1.5" ry="1.9" />
      <ellipse cx="12" cy="7.3" rx="1.6" ry="2" />
      <ellipse cx="16.5" cy="8.9" rx="1.5" ry="1.9" />
    </>
  ),
  // One die from the pool — a cube face with three pips.
  die: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.4" />
      <path d="M8.4 8.4h.01M12 12h.01M15.6 15.6h.01" />
    </>
  ),
  // The die faces. WiW's Black die shows Hits, Aces, Blanks and Spurs,
  // and the book prints its own symbols for them — these are teller's
  // drawings of the same four ideas, in the set's one stroke weight.

  // A hit: struck dead centre, and the strike radiating out of it.
  hit: (
    <>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <path d="M12 3.2v3.4M12 17.4v3.4M3.2 12h3.4M17.4 12h3.4" />
      <path d="M6.2 6.2l2.4 2.4M15.4 15.4l2.4 2.4M17.8 6.2l-2.4 2.4M8.6 15.4l-2.4 2.4" />
    </>
  ),
  // An ace: the pip alone, which is how a card shows its rank at a
  // glance across a table.
  ace: (
    <>
      <path
        d="M12 3.4c2.4 3.4 7 6 7 9.4a3.4 3.4 0 0 1-5.9 2.3c.2 2 .7 3.4 1.5 4.5H9.4c.8-1.1 1.3-2.5 1.5-4.5A3.4 3.4 0 0 1 5 12.8c0-3.4 4.6-6 7-9.4z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  // A blank: the face that came up with nothing on it.
  blank: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 12h6.8" />
    </>
  ),
  // A spur: the rowel and the heel band it turns on.
  spur: (
    <>
      <circle cx="14.6" cy="12" r="3.4" />
      <path d="M14.6 5.6v2.2M14.6 16.2v2.2M8.2 12h2.2M18.8 12h2.2M10.4 7.8l1.6 1.6M17.2 14.6l1.6 1.6M18.8 7.8l-1.6 1.6M12 14.6l-1.6 1.6" />
      <path d="M7.4 6.2a7.6 7.6 0 0 0 0 11.6" />
    </>
  ),

  // The kit marks. Each equipment pack is told apart by the one thing
  // only it carries, so the mark is that thing rather than four
  // variations on a rucksack.

  // A compass: rose ring and a needle pointing off true north.
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.2 8.8l-2 4.4-4.4 2 2-4.4z" />
      <path d="M12 2.6v1.4M12 20v1.4M2.6 12H4M20 12h1.4" />
    </>
  ),
  // A lantern: bail handle, glass, and the flame inside it.
  lantern: (
    <>
      <path d="M9.4 3.6a2.6 2.6 0 0 1 5.2 0" />
      <path d="M7.6 6h8.8l-1 3.2v8.4H8.6V9.2z" />
      <path d="M6.8 20.4h10.4" />
      <path d="M12 11.4c1.4 1.2 1.8 2.4 1.2 3.4-.5.8-1.9.8-2.4 0-.6-1-.2-2.2 1.2-3.4z" />
    </>
  ),
  // A coil of rope: three turns and the working end hanging free.
  rope: (
    <>
      <ellipse cx="12" cy="8" rx="6.4" ry="3.2" />
      <path d="M5.6 8v3.4c0 1.8 2.9 3.2 6.4 3.2s6.4-1.4 6.4-3.2V8" />
      <path d="M5.6 11.6V15c0 1.8 2.9 3.2 6.4 3.2" />
      <path d="M12 18.2c1 1.4 2.4 2 4.2 1.8" />
    </>
  ),
  // A harmonica: the comb, its cover plate, and the reed slots.
  harmonica: (
    <>
      <rect x="2.8" y="8.2" width="18.4" height="7.6" rx="1.4" />
      <path d="M2.8 11.4h18.4" />
      <path d="M7 13.2v2.2M10.3 13.2v2.2M13.7 13.2v2.2M17 13.2v2.2" />
    </>
  ),
  // A cartridge stood on its base — what a pool of dice looks like on
  // this table. SOLID, unlike every other glyph here: this one is read
  // as a row that fills, and an outline doesn't carry a bar. The case
  // rim is cut out of the silhouette rather than drawn over it, so it
  // survives whatever colour the row is wearing.
  bullet: (
    <>
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2.4c2.1 0 3.6 3.3 3.6 7.4v1.1H8.4V9.8C8.4 5.7 9.9 2.4 12 2.4z"
      />
      <path
        fill="currentColor"
        stroke="none"
        d="M8.4 12.4h7.2v8.2a1 1 0 0 1-1 1H9.4a1 1 0 0 1-1-1z"
      />
    </>
  ),
  // A horseshoe, ends down, four nail holes.
  horseshoe: (
    <>
      <path d="M7.4 19.8v-7.2a4.6 4.6 0 0 1 9.2 0v7.2" />
      <path d="M8.5 13.1h.01M8.1 16.4h.01M15.5 13.1h.01M15.9 16.4h.01" />
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

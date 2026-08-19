// Ported from the old app (src/lib/dice.ts) — a system's dice, as the
// table uses them: a printed pool, the faces it can land on, and what
// those faces are worth.
//
// The pool-parsing half (`expandPool`/`isPool`) needed nothing from the
// system and shipped first. `rollPool`/`tallyFaces` needed a system's
// die-face declaration, which now exists as the `dice` stack record
// (docs/CORE-NEXT.md §J) — `GET /api/stack/record/dice`, shallow-merged
// like every other record. None of this knows what a die MEANS: the
// faces map and the values map both arrive as record data, so a system
// with different dice is a row, not a code change (rule 4).

/** The `dice` stack record — one system's die declaration. */
export type DiceRecord = {
  /** Pool letter → the faces that die can show, in printed order. */
  faces: Record<string, string[]>;
  /** Face name → what it's worth in the record's `unit`. */
  values: Record<string, number>;
  /** What a tally is counted IN — "Hits", etc. */
  unit?: string;
  /** Slots drawn on a skill's track before the starburst. */
  track?: number;
  /** Slots drawn after the starburst — the Talent bonus dice. */
  trackBonus?: number;
  /** A face that also bumps a named counter when it lands — Ace → Aces. */
  banks?: { face: string; counter: string }[];
};

/** "3B2G" → ['B','B','B','G','G'] — a printed pool as individual dice. */
export function expandPool(pool: string): string[] {
  const out: string[] = [];
  for (const [, n, letter] of pool.matchAll(/(\d+)([A-Za-z])/g)) {
    for (let i = 0; i < Number(n); i++) out.push(letter.toUpperCase());
  }
  return out;
}

/** Whether a string is a pool at all — "2B1G" yes, "Normal" no. */
export function isPool(text: string): boolean {
  return /^(?:\d+[A-Za-z])+$/.test(text.replace(/\s+/g, ''));
}

/**
 * Roll a pool digitally — for FOES only, and the result lands in the
 * same tappable chips a human can retype (rule 1). Rolling for monsters
 * is settled ground (rule 5, as amended): the players' dice stay
 * physical; a handful of monster dice is exactly the bookkeeping teller
 * may take. Uniform pick over the faces array IS the die — a face
 * listed twice in the array is twice as likely, so the weights ride in
 * for free without a separate probability table.
 *
 * Not a secure context on a LAN host (rule 6) — `crypto.getRandomValues`
 * only, never `crypto.subtle` or `randomUUID`.
 */
export function rollPool(pool: string, dice: DiceRecord): string[] {
  const letters = expandPool(pool);
  const picks = new Uint32Array(letters.length);
  crypto.getRandomValues(picks);
  return letters.map((letter, i) => {
    const faces = dice.faces[letter] ?? [];
    return faces.length ? faces[picks[i] % faces.length] : 'blank';
  });
}

/** What the tapped/rolled dice add up to, in the record's own unit. */
export function tallyFaces(
  faces: (string | null | undefined)[],
  dice: DiceRecord | undefined,
): { set: number; total: number } {
  let set = 0;
  let total = 0;
  for (const face of faces) {
    if (!face) continue;
    set++;
    total += dice?.values[face] ?? 0;
  }
  return { set, total };
}

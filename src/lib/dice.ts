// A system's dice, as the table uses them: a printed pool, the faces
// it can land on, and what those faces are worth.
//
// This lived inside the encounter panel until three surfaces needed it
// at once (the turn stage, the resolve step, and the seat's roller).
// None of it knows what a die MEANS — the faces array and the values
// map both arrive as pack data, so a system with different dice is a
// row, not a code change (rule 4).

import type { SystemTemplate } from '../../worker/types';

type Dice = SystemTemplate['dice'];

/** "3B2G" → ['B','B','B','G','G'] — a printed pool as individual dice. */
export function expandPool(pool: string): string[] {
  const out: string[] = [];
  for (const [, n, letter] of pool.matchAll(/(\d+)([A-Za-z])/g)) {
    for (let i = 0; i < Number(n); i++) out.push(letter.toUpperCase());
  }
  return out;
}

/**
 * Add pools together — "1B" + "2B" → "3B", "1G" + "1B" → "1B1G".
 *
 * Defense is additive in this system (Dodge and Cover and armour all
 * count at once), so the sources a Warden ticks have to become one
 * throw. Letters come out sorted so the same set always prints the
 * same way.
 */
export function combinePools(pools: string[]): string {
  const counts = new Map<string, number>();
  for (const pool of pools) {
    for (const letter of expandPool(pool)) {
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, n]) => `${n}${letter}`)
    .join('');
}

/** Whether a string is a pool at all — "2B1G" yes, "Normal" no. */
export function isPool(text: string): boolean {
  return /^(?:\d+[A-Za-z])+$/.test(text.replace(/\s+/g, ''));
}

/**
 * Roll a pool digitally — for FOES only, and the result lands in the
 * same tappable chips, so any die is one tap from overruled (rule 1).
 * Rolling for monsters is settled ground (rule 5, as amended): the
 * players' dice stay physical; a handful of monster dice is exactly
 * the bookkeeping teller may take. Uniform pick over the faces array
 * IS the die — B lists hit twice and blank twice, so the weights ride
 * in for free.
 */
export function rollPool(pool: string, dice: Dice): string[] {
  const letters = expandPool(pool);
  const picks = new Uint32Array(letters.length);
  crypto.getRandomValues(picks);
  return letters.map((letter, i) => {
    const faces = dice?.faces[letter] ?? [];
    return faces.length ? faces[picks[i] % faces.length] : 'blank';
  });
}

/** What the tapped dice add up to, in the system's own unit. */
export function tallyFaces(
  faces: (string | null)[],
  dice: Dice,
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

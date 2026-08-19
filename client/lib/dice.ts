// Trimmed from the old app (src/lib/dice.ts) — only the pure pool-parsing
// half. `rollPool`/`tallyFaces` needed a system's die-face declaration
// (`SystemTemplate.dice`), which has no equivalent in the stack yet
// (`core/kind.ts` declares a list's shape, not its dice); wiring those
// back in is future work, not a visual-reckoning concern. `expandPool` is
// enough to draw a skill's pool as a track of boxes (`SkillRow`).

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

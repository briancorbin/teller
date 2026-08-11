import type { SystemTemplate } from './types';

// Rolling, for the bookkeeping nobody enjoys.
//
// teller ships this evaluator and NOTHING about any particular game:
// the faces, what they're worth and what a total is called all arrive
// from the system's row (rule 4, amended 2026-08-10). A d20 system and a
// symbol-dice system describe themselves the same way, and adding one is
// a row rather than a code change.
//
// Every result lands in a list the DM can drag (rule 1). This proposes
// an order; it never decides one.

/** A pool as written on a sheet: "2B", "4G", "2B1G". */
export type Pool = { die: string; count: number }[];

/**
 * Parse a pool. Unknown letters are DROPPED rather than guessed at:
 * a stat reading "Normal" (Speed) or "—" is not a pool, and inventing
 * dice for it would put a fictional number in the turn order.
 */
/**
 * Is this value pool NOTATION — "2B1G", "3 B", "+1G" — as opposed to a
 * sentence that happens to mention dice?
 *
 * `parsePool` deliberately scavenges tokens from anywhere in a string,
 * which is right for reading a pool and wrong for deciding whether a
 * value IS one: Knockback's effect text ("…+1G if it hits something
 * behind it") contains a die and is not a pool, and classifying it as
 * one replaced the prose with a one-die track. Classification demands
 * the WHOLE string be notation; only then does parsePool get a say.
 */
export function isPool(text: string, faces: Record<string, string[]>): boolean {
  const compact = (text ?? '').replace(/[\s+]/g, '');
  if (!/^(\d+[A-Za-z])+$/.test(compact)) return false;
  return parsePool(compact, faces).length > 0;
}

export function parsePool(text: string, faces: Record<string, string[]>): Pool {
  const pool: Pool = [];
  for (const [, n, die] of text.matchAll(/(\d+)\s*([A-Za-z])/g)) {
    const key = Object.keys(faces).find((k) => k.toLowerCase() === die.toLowerCase());
    if (!key) continue;
    const count = Number(n);
    if (count > 0 && count <= 50) pool.push({ die: key, count });
  }
  return pool;
}

export type Roll = {
  /** What each die showed, in order — so a result can be shown, not just asserted. */
  faces: string[];
  total: number;
};

/**
 * Roll a pool against a system's dice.
 *
 * `crypto.getRandomValues` rather than Math.random: it's present in both
 * runtimes and on a plain-HTTP origin, unlike most of crypto (rule 6).
 */
export function rollPool(
  pool: Pool,
  dice: NonNullable<SystemTemplate['dice']>,
): Roll {
  const rolled: string[] = [];
  const reroll = new Set(dice.reroll ?? []);

  for (const { die, count } of pool) {
    const sides = dice.faces[die];
    if (!sides?.length) continue;
    for (let i = 0; i < count; i++) {
      let face = pick(sides);
      // A rerolled face is rolled again until it becomes something else.
      // Bounded, because a die whose every side rerolls would spin here.
      for (let guard = 0; reroll.has(face) && guard < 20; guard++) {
        const next = pick(sides);
        if (next === face) continue;
        face = next;
      }
      rolled.push(face);
    }
  }

  return {
    faces: rolled,
    total: rolled.reduce((n, f) => n + (dice.values[f] ?? 0), 0),
  };
}

function pick<T>(from: T[]): T {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return from[buf[0] % from.length];
}

/**
 * Roll whatever decides turn order for one combatant, or null when it
 * can't be worked out — no system dice, no initiative field, or a stat
 * that isn't a pool. Null means "nobody rolled this", and the console
 * asks a human rather than inventing a number.
 */
export function rollInitiative(
  template: SystemTemplate | undefined,
  fields: { key: string; value: string }[],
): Roll | null {
  const dice = template?.dice;
  const field = template?.initiative?.field;
  if (!dice || !field) return null;
  const value = fields.find((f) => f.key === field)?.value ?? '';
  const pool = parsePool(value, dice.faces);
  if (!pool.length) return null;
  return rollPool(pool, dice);
}

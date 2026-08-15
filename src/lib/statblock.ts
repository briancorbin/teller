// Reading what a pack PRINTED about a creature.
//
// A bestiary entry's `attacks` is one field of text, exactly as the
// book set it — teller stores it that way on purpose (rule 2: fields
// are key/label/value and nothing here earns a column). But a Warden
// mid-fight wants the pool and the status out of that line without
// reading it, so this parses the shape the WiW pack writes:
//
//   Melee — Strangle (4 Grit): 2G damage + Trapped [4] · Peck (2 Grit): 2B damage
//   Long — Screech (AOE) (4 Grit): Dazed [2B]
//
// It is PRESENTATION over pack data, never a data model, and it is
// built to fail softly: anything it can't read stays visible as the
// text it always was. A pack that phrases attacks differently loses
// the chips and keeps its words — never the other way round.

import { isPool } from './dice';

export type StatStatus = {
  name: string;
  /** A printed number is fixed Severity ("Trapped [4]" is always 4). */
  severity: number | null;
  /** A printed POOL is rolled for Severity ("Dazed [2B]"). */
  dice: string | null;
};

export type StatAttack = {
  /** Melee, Short, Long, Distant — the band it's usable at. */
  band: string;
  name: string;
  grit: number;
  /** The printed remainder, verbatim, for anything parsing missed. */
  effect: string;
  /** The damage pool, when the line names one. */
  dice: string | null;
  statuses: StatStatus[];
};

const BAND = /^(.+?)\s+—\s+(.+)$/;
const ENTRY = /^(.+?)\s+\((\d+)\s+Grit\):\s*(.+)$/;
const STATUS = /\b([A-Z][A-Za-z'’-]*(?: [A-Z][A-Za-z'’-]*)*)\s*\[(\d+)([BG])?\]/g;
const POOL = /(?:\d+[BG])+/;

/** Statuses an effect line inflicts, and the line with them removed. */
function pullStatuses(effect: string): { statuses: StatStatus[]; rest: string } {
  const statuses: StatStatus[] = [];
  const rest = effect.replace(STATUS, (_, name: string, n: string, die?: string) => {
    statuses.push({
      name: name.trim(),
      severity: die ? null : Number(n),
      dice: die ? `${n}${die}` : null,
    });
    return '';
  });
  return { statuses, rest };
}

/** Every attack a printed `attacks` field lists, band by band. */
export function parseAttacks(field: string): StatAttack[] {
  const out: StatAttack[] = [];
  for (const line of field.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const band = BAND.exec(trimmed);
    // No band prefix? Read the whole line as unbanded rather than drop it.
    const [label, body] = band ? [band[1].trim(), band[2]] : ['', trimmed];
    for (const part of body.split(' · ')) {
      const entry = ENTRY.exec(part.trim());
      if (!entry) continue;
      const effect = entry[3].trim();
      const { statuses, rest } = pullStatuses(effect);
      out.push({
        band: label,
        name: entry[1].trim(),
        grit: Number(entry[2]),
        effect,
        dice: POOL.exec(rest)?.[0] ?? null,
        statuses,
      });
    }
  }
  return out;
}

/**
 * The pool a creature rolls to defend, if it prints one.
 *
 * Defense is ROLLED in this system — the book calls it a bundle of
 * Dodge, Cover and defence-improving items, and a creature's printed
 * value ("1B") is the pool it throws. People have no innate Defense
 * at all, which is why a PC's side of this is always earned on the
 * turn rather than read off the sheet.
 */
export function parseDefense(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text && isPool(text) ? text.replace(/\s+/g, '') : null;
}

/** How a status reads once applied — the tag teller offers to hang. */
export function statusTag(status: StatStatus, rolled?: number): string {
  const severity = status.severity ?? rolled ?? null;
  return severity === null ? status.name : `${status.name} ${severity}`;
}

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
  /** What it costs to use, and the COUNTER that pays — read off the
   *  printed line ("(4 Grit)"), never assumed, so a system that spends
   *  something else spends it (rule 2). */
  cost: number;
  costUnit: string;
  /** The printed remainder, verbatim, for anything parsing missed. */
  effect: string;
  /** The damage pool, when the line names one. */
  dice: string | null;
  statuses: StatStatus[];
};

const BAND = /^(.+?)\s+—\s+(.+)$/;
const ENTRY = /^(.+?)\s+\((\d+)\s+([A-Za-z]+)\):\s*(.+)$/;
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
      const effect = entry[4].trim();
      const { statuses, rest } = pullStatuses(effect);
      out.push({
        band: label,
        name: entry[1].trim(),
        cost: Number(entry[2]),
        costUnit: entry[3].trim(),
        effect,
        dice: POOL.exec(rest)?.[0] ?? null,
        statuses,
      });
    }
  }
  return out;
}

/**
 * A printed field that is really a LIST of named things — features,
 * trophies, a frenzy — split back into its parts.
 *
 * The pack stores each on its own line and names it with a leading
 * "Perfect Camouflage. …", which reads fine in a book and terribly in
 * a column, where it collapses into one grey wall. A block that
 * doesn't announce a name keeps its text and loses nothing.
 */
export type NamedBlock = { name?: string; text: string };

const NAMED = /^([A-Z][^.]{0,60})\.\s+(\S.*)$/s;

export function namedBlocks(field: string): NamedBlock[] {
  const out: NamedBlock[] = [];
  for (const line of (field ?? '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    const m = NAMED.exec(text);
    out.push(m ? { name: m[1].trim(), text: m[2].trim() } : { text });
  }
  return out;
}

/**
 * The bands a weapon prints its dice under, in reach order.
 *
 * A foe's attacks are one text field; a person's are their GEAR, and
 * the pool lives per band on the catalogue entry ("Arm's Reach 1B,
 * Short Range 2B"). Same shape once read, which is what lets the
 * posse use the exact resolve step the monsters do.
 */
const BANDS: [string, string][] = [
  ['arms', "Arm's Reach"],
  ['short', 'Short'],
  ['long', 'Long'],
  ['distant', 'Distant'],
];

type Fielded = {
  name: string;
  kind?: string;
  from?: string;
  fields?: { key: string; label?: string; value: string }[];
};

/**
 * What a person can swing, from what they're carrying.
 *
 * A character's copy of an item is a thin reference — `from` names the
 * catalogue entry and the fields are usually empty — so the stats come
 * from the pack. When the carried copy DOES have its own fields they
 * win, because someone edited them and stored values are authoritative
 * (rule 1).
 */
export function weaponAttacks(
  items: Fielded[],
  catalog: Map<string, Fielded>,
): StatAttack[] {
  const out: StatAttack[] = [];
  for (const item of items) {
    if (item.kind !== 'weapon') continue;
    const source = item.fields?.length ? item : (item.from && catalog.get(item.from)) || item;
    const fields = source.fields ?? [];
    const at = (key: string) =>
      fields.find((f) => f.key.toLowerCase() === key)?.value?.trim() ?? '';
    const costField = fields.find((f) => /^grit$|^cost$/i.test(f.key) && !/\$/.test(f.value));
    const cost = Number(costField?.value) || 0;
    const costUnit = (costField as { label?: string } | undefined)?.label ?? 'Grit';
    for (const [key, label] of BANDS) {
      const dice = at(key).replace(/\s+/g, '');
      if (!dice || !isPool(dice)) continue;
      out.push({
        band: label,
        name: item.name,
        cost,
        costUnit,
        effect: `${label} ${dice}`,
        dice,
        statuses: [],
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

/**
 * A named ability that COSTS something — a frenzy, a special, anything
 * the book prints as prose rather than on the attack line.
 *
 * The console's attack chips read `parseAttacks`, which only ever sees
 * the `attacks` field. So the Pondweed Peril's Lake Sludge — its
 * signature move, the thing it does when it's wounded — was in the
 * statblock, in the creature sheet, and in the assistant's prompt, and
 * was the one action the Warden could not tap (Brian, 2026-08-15: "in
 * the 'what it does' section, I don't see a frenzy action anywhere").
 *
 * Nothing here knows what a Frenzy is (rule 2). It reads the author's
 * own notation and picks up three things when they're written down:
 *
 *   - a THRESHOLD in the block's name — "Lake Sludge (18 Health)"
 *   - a COST anywhere in the prose — "Spending 4 Grit, the Peril dives"
 *   - the dice and conditions it hangs, the same way an attack line does
 *
 * A block with none of those is a passive trait and stays out: a chip
 * you can press should do something.
 */
export type StatAbility = {
  name: string;
  /** The number its name gates it behind, and which counter watches it. */
  gate?: { at: number; counter: string };
  cost?: { amount: number; unit: string };
  dice: string | null;
  statuses: StatStatus[];
  /** The block's own words, for the tooltip and the sheet. */
  text: string;
};

const GATE = /^(.*?)\s*\((\d+)\s+([A-Za-z][A-Za-z ]*)\)\s*$/;
const SPEND = /\bspend(?:ing)?\s+(\d+)\s+([A-Za-z]+)/i;
/**
 * A pool in PROSE is only a pool if the prose says to roll it.
 *
 * An attack line is all business — strip the statuses and what's left
 * is the damage. A paragraph is not: Lake Sludge mentions "+1B" for a
 * defence bonus and "-1B" for a relief penalty, and taking any pool
 * that appears handed the Warden a 1B chip to roll for an ability
 * whose only roll is its status severity. Rolling a number nobody
 * asked for is worse than offering none.
 */
const ROLLED = /(?:\broll\s+|\bfor\s+)((?:\d+[BG])+)|((?:\d+[BG])+)\s+damage/i;

export function parseAbilities(field: string): StatAbility[] {
  const out: StatAbility[] = [];
  for (const block of namedBlocks(field ?? '')) {
    if (!block.name) continue;
    const gated = GATE.exec(block.name);
    const spend = SPEND.exec(block.text);
    if (!gated && !spend) continue;
    const { statuses, rest } = pullStatuses(block.text);
    out.push({
      name: (gated ? gated[1] : block.name).trim(),
      ...(gated ? { gate: { at: Number(gated[2]), counter: gated[3].trim() } } : {}),
      ...(spend ? { cost: { amount: Number(spend[1]), unit: spend[2] } } : {}),
      dice: (() => {
        const m = ROLLED.exec(rest);
        return m ? (m[1] ?? m[2]) : null;
      })(),
      statuses,
      text: block.text,
    });
  }
  return out;
}

/** Whether a gated ability's number has been reached. Absent gate = always. */
export function gateMet(
  ability: StatAbility,
  counters: { name: string; current: number }[],
): boolean {
  if (!ability.gate) return true;
  const counter = counters.find(
    (c) => c.name.toLowerCase() === ability.gate!.counter.toLowerCase(),
  );
  return counter ? counter.current <= ability.gate.at : true;
}

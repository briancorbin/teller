// What a gated child DOES, once somebody crosses its line.
//
// `gate.ts` reads the number a frenzy waits on. This reads the other
// half: the mechanical common core of what happens after — a price, an
// attack rewritten, a stat moved, a status hung on everyone in range.
// It sits beside the gate for the same reason the gate sits beside the
// declaration: the arithmetic belongs next to the thing that declares
// it, not copied into whichever surface happens to ask.
//
// FIVE OPTIONAL LISTS on the child, and nothing more, because a survey
// of a real book's worth of them found exactly five things they keep
// doing (plus a long tail that they each do once — and that tail stays
// PROSE, run by the person at the table). The prose is kept on every
// one of them and stays authoritative (rule 1): structure here is
// convenience — it rewrites a chip so the Warden doesn't do the sum in
// their head — and never a replacement for the words.
//
//   cost      what arming it costs        [{ name: 'Grit', value: 4 }]
//   profile   the frenzy AS an action     [{ name: 'Band', value: 'Short' }, { name: 'Damage', … }]
//   inflicts  what that action hangs      [{ name: 'Trapped', value: '4B' }]
//   set       an ABSOLUTE stat/tolerance  [{ name: 'Defense', value: '2G' }]
//   add       a DELTA on one              [{ name: 'Defense', value: '1B' }]
//   immune    what it stops taking        [{ name: 'Afraid' }]
//   duration  how long, in words          [{ name: 'Duration', value: 'for two rounds' }]
//
// `set` and `add` are two lists rather than one list with a sign,
// deliberately: both spellings occur in a real book ("Defense becomes
// 2G" beside "+2B to Defense") and a value that has to be read twice to
// know which it is, is the exact bug this model exists to end
// (`entity.ts`: a discriminator belongs on the declaration, never
// inside the value).
//
// An attack REWRITE is richer than a leaf, so it is a CHILD of the
// frenzy — `type: 'modifies'` — carrying a REF to the sibling attack it
// rewrites and the same `set`/`add`/`inflicts` lists. The ref is what
// makes name drift a non-problem: a book that says "its Iron Jaw
// attack" beside an attack printed "Iron Jaws" is resolved once, at the
// boundary, and the prose is never edited to match (§K — containment
// and pointing are always refs).
//
// A modification with NO `refs.attack` applies to EVERY attack; one
// carrying `profile: [{ name: 'Band', value: 'Melee' }]` narrows that to
// a band. Absence is the marker on purpose: "all" is not the name of an
// attack, and inventing an id for it would be a ref that resolves to
// nothing.
//
// A GRANTED action is the frenzy's own `profile` — a frenzy already
// draws as a chip and arming one already opens the exchange, so an
// action it grants needs no new rendering at all, just the numbers on
// the thing you were going to tap anyway. A frenzy that grants a
// SEPARATE second attack carries it as an `attack` CHILD, which appears
// as its own chip only while the frenzy is running.
//
// ACTIVE is stored, never derived: a met gate PROPOSES a frenzy and the
// Warden turns it on — early, late, or off again (rule 1). The mark is
// an ordinary entry in a list named for the child type, so it goes
// through the ordinary entry door, appends to the log like everything
// else, and survives a refetch.

import { findEntry, numberOf, sameName, type Entity, type Entry, type Ref } from './entity.ts';
import { combinePools, isPool, subtractPools } from './pool.ts';

/** The type a gated child wears, and the list its active marks live in. */
export const FRENZY = 'frenzy';

/** One attack rewrite, read off a `modifies` child. */
export type Modification = {
  /** The attack it rewrites. ABSENT means every attack. */
  attack?: Ref;
  /** Narrows an all-attacks rewrite to one band. */
  band?: string;
  /** Absolute profile values — Damage, Cost, Band. */
  set: Entry[];
  /** Deltas on the same. */
  add: Entry[];
  /** Statuses this rewrite adds to what the attack already hangs. */
  inflicts: Entry[];
  /** Riders it gains — Piercing, and whatever else a system prints. */
  properties: Entry[];
  /** Which frenzy asked for it — for saying WHY a chip reads differently. */
  from: { id: string; name: string };
};

const list = (e: { lists?: Record<string, Entry[]> } | undefined, name: string): Entry[] =>
  e?.lists?.[name] ?? [];

// ---------------------------------------------------------------- reading

/** The gated children of a sheet, in printed order. */
export function frenziesOf(entity: { children?: Entity[] } | undefined): Entity[] {
  return (entity?.children ?? []).filter((c) => c.type === FRENZY);
}

/** Is this one running? A stored mark, matched by the child's own name. */
export function isActive(
  entity: { lists?: Record<string, Entry[]> } | undefined,
  frenzy: { name: string },
): boolean {
  return list(entity, FRENZY).some((e) => sameName(e, frenzy.name));
}

/** Every gated child currently running. */
export function activeFrenzies(entity: Entity | undefined): Entity[] {
  return frenziesOf(entity).filter((f) => isActive(entity, f));
}

/** What arming it costs, if the printing gave a number. */
export function costOf(frenzy: { lists?: Record<string, Entry[]> }): Entry | undefined {
  return list(frenzy, 'cost')[0];
}

/** How long it lasts, in the book's own words — never enumerated. */
export function durationOf(frenzy: { lists?: Record<string, Entry[]> }): string | undefined {
  const value = list(frenzy, 'duration')[0]?.value;
  return typeof value === 'string' ? value : undefined;
}

/** A separate attack this frenzy grants, armable only while it runs. */
export function grantsOf(frenzy: Entity): Entity[] {
  return (frenzy.children ?? []).filter((c) => c.type === 'attack');
}

/** The rewrites one frenzy declares. */
export function modificationsOf(frenzy: Entity): Modification[] {
  return (frenzy.children ?? [])
    .filter((c) => c.type === 'modifies')
    .map((c) => {
      const held = c.refs?.attack;
      const attack = Array.isArray(held) ? held[0] : held;
      const band = findEntry(list(c, 'profile'), 'Band')?.value;
      return {
        ...(attack ? { attack } : {}),
        ...(typeof band === 'string' ? { band } : {}),
        set: list(c, 'set'),
        add: list(c, 'add'),
        inflicts: list(c, 'inflicts'),
        properties: list(c, 'properties'),
        from: { id: frenzy.id, name: frenzy.name },
      };
    });
}

/** Every rewrite that a RUNNING frenzy aims at this attack. */
export function modificationsFor(entity: Entity | undefined, attack: Entity): Modification[] {
  const band = findEntry(list(attack, 'profile'), 'Band')?.value;
  return activeFrenzies(entity)
    .flatMap(modificationsOf)
    .filter((m) => {
      if (m.attack) return m.attack.id === attack.id;
      // No ref means every attack — narrowed to a band when it says one.
      return !m.band || (typeof band === 'string' && sameName(m.band, band));
    });
}

// ------------------------------------------------------------ arithmetic

/**
 * A base value moved by a DELTA — the one place that math happens.
 *
 * **An absent base is ZERO.** System-wide (Brian, 2026-08-19): a delta
 * on a stat or tolerance nobody printed treats what's missing as
 * nothing, for foes and for characters alike. The alternative — refusing
 * to apply it — loses the mechanic entirely, and a book that says
 * "Sweep Tolerance increases by 2" against a creature with no printed
 * Sweep means 2, not silence.
 *
 * A number moves a number. A POOL moves a pool, per letter, floored at
 * nothing; a leading minus subtracts. Anything else (a named rung —
 * "Fast") has no arithmetic and is left alone: that's what `set` is for.
 */
export function applyDelta(
  base: number | string | undefined,
  delta: number | string,
): number | string {
  if (typeof delta === 'number') {
    const from = typeof base === 'number' ? base : 0; // absent is zero
    return from + delta;
  }
  const raw = String(delta).trim();
  const negative = raw.startsWith('-');
  const pool = raw.replace(/^[+-]/, '').replace(/\s+/g, '');
  if (!isPool(pool)) return base ?? delta;
  const from = typeof base === 'string' && isPool(base) ? base : ''; // absent is zero
  return negative ? subtractPools(from, pool) : combinePools([from, pool]);
}

/** One entry with a delta applied — the name and ceiling kept as they were. */
function bumped(entry: Entry | undefined, name: string, delta: number | string): Entry {
  const value = applyDelta(entry?.value, delta);
  return { name: entry?.name ?? name, value, ...(entry?.max !== undefined ? { max: entry.max } : {}) };
}

/**
 * A list as the RUNNING frenzies leave it — stats, tolerances, whatever
 * the caller hands in. Absolutes land first, then deltas on top; a name
 * nobody printed arrives as a new entry (absent is zero, again).
 *
 * Nothing is written: this is the READ every surface does, so the sheet
 * and the exchange can never disagree about what a tolerance is worth
 * mid-frenzy. What's stored stays the printed value, so turning a
 * frenzy off restores it without an undo.
 */
export function effectiveList(entity: Entity | undefined, name: string): Entry[] {
  const running = activeFrenzies(entity);
  if (!running.length) return list(entity, name);
  const printed = list(entity, name);
  const mine = new Set(printed.map((e) => e.name.trim().toLowerCase()));
  let out = printed.slice();
  const touch = (target: string, apply: (prior: Entry | undefined) => Entry) => {
    const prior = findEntry(out, target);
    // Only a name this list already holds, or one no OTHER list holds —
    // an override names a stat, and which list files it is the system's
    // business, not the override's.
    const next = apply(prior);
    out = prior ? out.map((e) => (sameName(e, target) ? next : e)) : [...out, next];
  };
  for (const frenzy of running) {
    for (const entry of list(frenzy, 'set')) {
      if (!belongs(entity, name, entry.name, mine)) continue;
      touch(entry.name, (prior) => ({
        name: prior?.name ?? entry.name,
        ...(entry.value !== undefined ? { value: entry.value } : {}),
        ...(prior?.max !== undefined ? { max: prior.max } : {}),
      }));
    }
    for (const entry of list(frenzy, 'add')) {
      if (entry.value === undefined) continue;
      if (!belongs(entity, name, entry.name, mine)) continue;
      touch(entry.name, (prior) => bumped(prior, entry.name, entry.value!));
    }
  }
  return out;
}

/**
 * Does an override aimed at `target` belong in THIS list? Yes if the
 * list already holds that name; yes if no other list on the sheet does
 * (absent is zero — it has to land somewhere, and the caller asked).
 * No if some other list owns it, so a Defense override doesn't also
 * sprout a Defense tolerance.
 */
function belongs(
  entity: Entity | undefined,
  name: string,
  target: string,
  mine: Set<string>,
): boolean {
  if (mine.has(target.trim().toLowerCase())) return true;
  for (const [key, entries] of Object.entries(entity?.lists ?? {})) {
    if (key === name) continue;
    if (entries.some((e) => sameName(e, target))) return false;
  }
  return true;
}

/** What the running frenzies say it no longer takes. */
export function immunities(entity: Entity | undefined): Entry[] {
  return activeFrenzies(entity).flatMap((f) => list(f, 'immune'));
}

/**
 * An attack's lists as the running frenzies leave them — the same
 * `profile`/`inflicts` shape it already had, so every surface that draws
 * an attack draws a modified one with no new code and no branch.
 */
export function modifiedAttack(
  attack: Entity,
  mods: Modification[],
): { profile: Entry[]; inflicts: Entry[]; changed: boolean } {
  const profile = list(attack, 'profile').slice();
  const inflicts = list(attack, 'inflicts').slice();
  if (!mods.length) return { profile, inflicts, changed: false };
  let changed = false;
  const put = (into: Entry[], entry: Entry) => {
    const prior = findEntry(into, entry.name);
    if (prior) {
      const at = into.indexOf(prior);
      into[at] = { ...prior, ...entry };
    } else into.push(entry);
    changed = true;
  };
  for (const mod of mods) {
    for (const entry of mod.set) put(profile, entry);
    for (const entry of mod.add) {
      if (entry.value === undefined) continue;
      put(profile, bumped(findEntry(profile, entry.name), entry.name, entry.value));
    }
    for (const entry of mod.properties) put(profile, entry);
    for (const entry of mod.inflicts) put(inflicts, entry);
  }
  return { profile, inflicts, changed };
}

/** A cost after the rewrites — floored at nothing, since nobody pays backwards. */
export function costAfter(profile: Entry[]): number | undefined {
  const cost = numberOf(findEntry(profile, 'Cost'));
  return cost === undefined ? undefined : Math.max(0, cost);
}

// The exchange — the arithmetic one turn does, and nothing else.
//
// Ported from the old app's runner (src/components/TurnStage.tsx plus
// the `/resolve` route in worker/index.ts), which is the behavioural
// spec. Everything it did in two places is one place here, because the
// old split is exactly what let the panel and the route disagree about
// what a hit was worth.
//
// The rules it carries are the old ones, unchanged:
//
//   * damage is HITS minus BLOCKED, floored at zero;
//   * damage comes off the first BOUNDED counter, as everywhere;
//   * a status already held takes the HIGHER severity (the old route's
//     default stacking mode);
//   * a declared cap is PRESENTED, never enforced (core/kind.ts's own
//     word) — a status the system declared uncapped ignores it, and a
//     human types past either.
//
// Nothing here writes anything or decides anything. Every number it
// works out is handed to a surface that shows it BEFORE it lands, and
// the person reading it can type over any of it (rule 1). The writes
// themselves go through the ordinary entry door, so the event log
// carries them for free (rule 3) and a stepper can move every one of
// them back.
//
// One thing here is NOT a port, and it is flagged where it lives:
// `toleration` (below). The old app never read a tolerance at all.

import { numberOf, sameName, type Entry } from './entity.ts';

/** An entry and the list it was found in — a write needs both. */
export type Located = { list: string; entry: Entry };

/** An entry by name, wherever it lives — lists are the system's filing, not ours. */
export function locate(
  lists: Record<string, Entry[]> | undefined,
  name: string,
): Located | undefined {
  for (const [list, entries] of Object.entries(lists ?? {})) {
    const entry = entries.find((e) => sameName(e, name));
    if (entry) return { list, entry };
  }
  return undefined;
}

/**
 * The counter a hit comes off — the first BOUNDED one, as everywhere.
 * `resources` is looked at first because that's where this system files
 * them; any other list is the floor under a sheet that doesn't (rule 2 —
 * teller never learns a counter's name).
 */
export function vitalIn(lists: Record<string, Entry[]> | undefined): Located | undefined {
  const keys = Object.keys(lists ?? {});
  const ordered = [
    ...keys.filter((k) => k.toLowerCase() === 'resources'),
    ...keys.filter((k) => k.toLowerCase() !== 'resources'),
  ];
  for (const list of ordered) {
    const entry = (lists?.[list] ?? []).find((e) => typeof e.max === 'number' && e.max > 0);
    if (entry) return { list, entry };
  }
  return undefined;
}

/**
 * What the target brought to stop it.
 *
 * Not a list teller knows: the system's `pins` record already says which
 * entries belong beside a counter (`{ Health: ['defense'] }` — the same
 * declaration the sheet's health panel draws from), so "the defenses"
 * are the entries pinned to the VITAL. A system that pins nothing offers
 * nothing, and the Warden types the number the table rolled.
 */
export function defensesOf(
  lists: Record<string, Entry[]> | undefined,
  pins: Record<string, string[]> | undefined,
  vital: Entry | undefined,
): Entry[] {
  if (!vital) return [];
  const names =
    Object.entries(pins ?? {}).find(([counter]) => sameName(counter, vital.name))?.[1] ?? [];
  return names
    .map((name) => locate(lists, name)?.entry)
    .filter((e): e is Entry => e !== undefined);
}

/** The old app's line, exactly: `Math.max(0, hits - blocked)`. */
export function damageFrom(hits: number, blocked: number): number {
  return Math.max(0, Math.round(hits) - Math.round(blocked));
}

/** A counter after a hit lands — floored at zero, ceiling kept. */
export function afterDamage(entry: Entry, damage: number): number {
  return Math.max(0, (numberOf(entry) ?? 0) - Math.max(0, Math.round(damage)));
}

/**
 * A tolerance, read.
 *
 * THE ONE THING HERE THAT IS NOT A PORT. The old app never read a
 * tolerance — it printed the line as prose and the Warden did the
 * arithmetic in their head. The data is structured now (a `tolerances`
 * list, `{name, value}`), so the number can at least be OFFERED, and
 * this is the smallest reading that offers it:
 *
 *   * a NUMBER is a flat reduction;
 *   * a STRING is a pool the target rolls, its total the reduction;
 *   * a LEADING MINUS reverses it — the pool makes the status worse
 *     rather than better.
 *
 * The sign convention is an inference from the notation and nothing
 * else, which is why every number it produces lands in an editable
 * stepper with the arithmetic printed beside it. If the table rules
 * otherwise, the table wins, as it must. The honest home for this is
 * system data once somebody writes down what a tolerance means.
 */
export type Toleration = {
  name: string;
  /** The pool to roll, sign stripped. Absent when the tolerance is flat. */
  pool?: string;
  /** A flat reduction, when the tolerance carries a plain number. */
  flat?: number;
  /** A negative tolerance makes it worse — it ADDS to severity. */
  worsens: boolean;
};

export function toleration(entry: Entry | undefined): Toleration | undefined {
  if (!entry) return undefined;
  if (typeof entry.value === 'number') {
    return { name: entry.name, flat: Math.abs(entry.value), worsens: entry.value < 0 };
  }
  const raw = String(entry.value ?? '').trim();
  if (!raw) return undefined;
  const worsens = raw.startsWith('-');
  const pool = raw.replace(/^[+-]/, '').replace(/\s+/g, '');
  return pool ? { name: entry.name, pool, worsens } : undefined;
}

/** The tolerance a target has against one named status, if any. */
export function toleranceFor(tolerances: Entry[] | undefined, status: string): Toleration | undefined {
  return toleration((tolerances ?? []).find((e) => sameName(e, status)));
}

export type SeverityInput = {
  /** What the attack inflicts — already rolled, if it printed a pool. */
  printed?: number;
  /** What the tolerance came to — rolled, or its flat number. */
  relief?: number;
  /** A negative tolerance: the relief adds instead of subtracting. */
  worsens?: boolean;
  /** What the target already carries of this one. */
  held?: number;
  /** The declared ceiling for this list. Presented, never enforced. */
  cap?: number;
  /** A status the system declared exempt from the cap. */
  uncapped?: boolean;
};

/**
 * What to PROPOSE for one status, and the arithmetic in words.
 *
 * The words are half the point: a number nobody can check is a number
 * nobody should press, so the caller prints `note` beside the stepper.
 */
export function proposeSeverity(input: SeverityInput): { value: number; note?: string } {
  const printed = Math.max(0, Math.round(input.printed ?? 0));
  const parts: string[] = [];
  let value = printed;

  const relief = Math.round(input.relief ?? 0);
  if (relief > 0) {
    value = input.worsens ? value + relief : value - relief;
    parts.push(`${printed} ${input.worsens ? '+' : '−'} ${relief} tolerance = ${Math.max(0, value)}`);
  }
  value = Math.max(0, value);

  const held = Math.max(0, Math.round(input.held ?? 0));
  if (held > 0 && held >= value) {
    parts.push(`already ${held}`);
    value = held;
  } else if (held > 0) {
    parts.push(`${held} → ${value}`);
  }

  if (input.cap !== undefined && !input.uncapped && value > input.cap) {
    parts.push(`cap ${input.cap}`);
    value = input.cap;
  }

  return { value, ...(parts.length ? { note: parts.join(' · ') } : {}) };
}

// ---------------------------------------------------------------------
// The record half — what the log keeps.
//
// A roll that nobody wrote down is a fight nobody can replay, and the
// log is read by people AND by whatever the table has plugged in. Both
// of these are RECORDS: they never write a value, they say what
// happened to the values the entry door already moved.

export type RollRecord = {
  /** Who threw them. */
  by?: string;
  byName?: string;
  /** The pool as printed — '2G'. */
  pool: string;
  /** What the dice showed, in order, as the system's own face names. */
  faces: string[];
  total: number;
  /** What the total is counted in — the `dice` record's word. */
  unit?: string;
  /** What it was for — 'Strangle damage', 'Bark Watcher 1 defense'. */
  for?: string;
  round?: number;
};

export type ExchangeRecord = {
  by: string;
  byName?: string;
  target?: string;
  targetName?: string;
  action: string;
  hits: number;
  blocked: number;
  damage: number;
  /** The transition, recorded at the press — never re-derived later. */
  vital?: { name: string; from: number; to: number };
  statuses: { name: string; severity: number }[];
  spend: { counter: string; amount: number; on?: string }[];
  round?: number;
};

const str = (raw: unknown): string | undefined => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s || undefined;
};
const num = (raw: unknown): number => (typeof raw === 'number' && Number.isFinite(raw) ? raw : 0);

/** Forgiving read, strict write — the same posture as `toEntity`. */
export function toRollRecord(raw: unknown): RollRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const pool = str(r.pool);
  if (!pool) return undefined;
  const faces = Array.isArray(r.faces) ? r.faces.map((f) => String(f)) : [];
  return {
    pool,
    faces,
    total: Math.round(num(r.total)),
    ...(str(r.by) ? { by: str(r.by)! } : {}),
    ...(str(r.byName) ? { byName: str(r.byName)! } : {}),
    ...(str(r.unit) ? { unit: str(r.unit)! } : {}),
    ...(str(r.for) ? { for: str(r.for)! } : {}),
    ...(num(r.round) > 0 ? { round: Math.round(num(r.round)) } : {}),
  };
}

export function toExchangeRecord(raw: unknown): ExchangeRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const by = str(r.by);
  if (!by) return undefined;
  const vital = r.vital && typeof r.vital === 'object' ? (r.vital as Record<string, unknown>) : undefined;
  const vitalName = vital ? str(vital.name) : undefined;
  return {
    by,
    ...(str(r.byName) ? { byName: str(r.byName)! } : {}),
    ...(str(r.target) ? { target: str(r.target)! } : {}),
    ...(str(r.targetName) ? { targetName: str(r.targetName)! } : {}),
    action: str(r.action) ?? (str(r.target) ? 'an attack' : 'a turn'),
    hits: Math.max(0, Math.round(num(r.hits))),
    blocked: Math.max(0, Math.round(num(r.blocked))),
    damage: Math.max(0, Math.round(num(r.damage))),
    ...(vitalName
      ? { vital: { name: vitalName, from: Math.round(num(vital!.from)), to: Math.round(num(vital!.to)) } }
      : {}),
    statuses: (Array.isArray(r.statuses) ? r.statuses : [])
      .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
      .filter((s) => str(s.name))
      .map((s) => ({ name: str(s.name)!, severity: Math.round(num(s.severity)) })),
    // A line worth ZERO is kept when it says what it bought — that a
    // feature cost nothing is the most useful fact in the log, and its
    // absence is what once taught a reader to price a free one.
    spend: (Array.isArray(r.spend) ? r.spend : [])
      .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
      .filter((s) => str(s.counter) && (num(s.amount) > 0 || str(s.on)))
      .map((s) => ({
        counter: str(s.counter)!,
        amount: Math.max(0, Math.round(num(s.amount))),
        ...(str(s.on) ? { on: str(s.on)! } : {}),
      })),
    ...(num(r.round) > 0 ? { round: Math.round(num(r.round)) } : {}),
  };
}

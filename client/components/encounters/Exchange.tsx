// THE EXCHANGE — the four earned steps the old app's ✦ card ran, ported
// against structured data (src/components/TurnStage.tsx, steps 1–3, and
// the arithmetic its `/resolve` route did on the other end).
//
// Roll · target · defense · resolve. Each step appears only once the one
// above it has something to hand down, and NOTHING in it applies itself:
// the resolve row does the arithmetic the system's own numbers ask for
// and then waits to be told (rule 1). Every number in it is a stepper
// before it is a fact.
//
// What changed from the old one, and only this: the old app read all of
// it out of prose with a regex — the pool, the cost, the inflicted
// status, the target's defense — and this reads it off entries, because
// attacks are child entities now (§I). The flow is the same flow. The
// two chips the old app invented in CODE (light/heavy cover, and dodge
// at one die per point spent) are gone rather than reproduced: those are
// one system's rules living in a component, and what replaces them is
// the honest thing the old app also offered — a number the Warden types,
// because the table just rolled it in front of them.
//
// The writes go through the ordinary entry door, one at a time, in the
// plan's own order — the same posture as `client/lib/spend.ts`, and for
// the same reason. Not atomic, and better for saying so: a half-applied
// exchange leaves ordinary values a stepper can fix.

import { useRef, useState } from 'react';
import { findEntry, numberOf, type Entity, type Entry } from '../../../core/entity.ts';
import {
  afterDamage,
  damageFrom,
  defensesOf,
  locate,
  proposeSeverity,
  toleranceFor,
  vitalIn,
  type ExchangeRecord,
  type RollRecord,
} from '../../../core/exchange.ts';
import { api } from '../../lib/api.ts';
import { combinePools, isPool, rollPool, tallyFaces, type DiceRecord } from '../../lib/dice.ts';
import { btn, btnPrimary } from '../../lib/ui.ts';
import { DicePool } from '../DicePool.tsx';

/** One touched entry — everything a surface may say about a list. */
export type EntryWrite = {
  list: string;
  name: string;
  value?: number | string;
  remove?: boolean;
};

/** The system's own declared statuses — a host with none renders no row. */
export type StatusDecl = {
  name: string;
  relief?: string;
  effect?: string;
  /** Exempt from the declared ceiling, where the system says so. */
  uncapped?: boolean;
};

/**
 * The action somebody armed — an attack child, or a frenzy that got its
 * gate crossed. Assembled by the stage off the printed profile, so this
 * file never learns which list a cost lives in.
 */
export type Armed = {
  id: string;
  name: string;
  /** A frenzy pays in prose, and is treated differently below. */
  frenzy?: boolean;
  /** The pool the damage rolls, when the printing gives one. */
  damage?: string;
  /** What the printed line costs, when it's a number and not a sentence. */
  cost?: number;
  inflicts: Entry[];
  /** The printed line in words — handed to whatever the table has plugged in. */
  note?: string;
};

export type Combatant = { id: string; label: string };

/**
 * The list a printed sheet keeps its resistances in. Named here because
 * the shared statblock already names it (`TemplateSheet.tsx` draws the
 * same list as chips) — one word, one meaning, in both places.
 */
const TOLERANCES = 'tolerances';

/** One list off a sheet, by the system's word for it, however it's cased. */
function listOf(entity: Entity | undefined, list: string): Entry[] {
  const key = Object.keys(entity?.lists ?? {}).find((k) => k.toLowerCase() === list.toLowerCase());
  return key ? entity!.lists[key] : [];
}

const stepPip = (n: number, label: string) => (
  <div className="flex items-center gap-2">
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-700 font-mono text-[9px] text-stone-950">
      {n}
    </span>
    <span className="text-[11px] text-stone-400">{label}</span>
  </div>
);

function Stepper({
  label,
  value,
  unit,
  onSet,
}: {
  label: string;
  value: number;
  unit?: string;
  onSet: (n: number) => void;
}) {
  return (
    <span className="flex items-center gap-1 font-mono text-[11px] text-stone-400">
      <span className="text-stone-600">{label}</span>
      <button
        className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
        aria-label={`${label} less`}
        onClick={() => onSet(Math.max(0, value - 1))}
      >
        −
      </button>
      <span className={value > 0 ? 'text-amber-200' : 'text-stone-600'}>{value}</span>
      <button
        className="rounded px-1 text-sm text-stone-500 hover:bg-stone-800 hover:text-stone-100"
        aria-label={`${label} more`}
        onClick={() => onSet(value + 1)}
      >
        +
      </button>
      {unit && <span className="text-stone-600">{unit}</span>}
    </span>
  );
}

export function Exchange({
  actor,
  armed,
  order,
  sheetOf,
  dice,
  icons,
  pins,
  statuses,
  conditionsList,
  conditionCap,
  costCounter,
  round,
  onWrite,
  onDisarm,
}: {
  /** The acting entity, resolved. */
  actor: Entity;
  armed: Armed;
  /** Everyone else in the order, in order. */
  order: Combatant[];
  sheetOf: (id: string) => Entity | undefined;
  dice: DiceRecord | undefined;
  icons?: Record<string, string>;
  /** The system's `pins` record — which entries stand beside which counter. */
  pins?: Record<string, string[]>;
  statuses: StatusDecl[];
  /** Which list a hung condition is written to — the system's word. */
  conditionsList: string;
  /** The declared ceiling for that list. Presented, never enforced. */
  conditionCap?: number;
  /** The counter an action's cost comes out of — the `use` record's word. */
  costCounter?: string;
  round: number;
  onWrite: (entityId: string, edit: EntryWrite) => Promise<unknown>;
  onDisarm: () => void;
}) {
  const [targetId, setTargetId] = useState<string | undefined>(undefined);
  const [faces, setFaces] = useState<(string | null)[] | undefined>(undefined);
  const [defenses, setDefenses] = useState<string[]>([]);
  const [defFaces, setDefFaces] = useState<(string | null)[] | undefined>(undefined);
  /** What the table rolled with its own hands, typed in. */
  const [typed, setTyped] = useState('');
  const [tolFaces, setTolFaces] = useState<Record<string, (string | null)[]>>({});
  const [sevSet, setSevSet] = useState<Record<string, number | null>>({});
  const [spend, setSpend] = useState<number | undefined>(undefined);
  const [moved, setMoved] = useState(0);
  const [applied, setApplied] = useState(false);
  /** The transition that landed, recorded at the press. */
  const [landed, setLanded] = useState<{ name: string; from: number; to: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** Pools already filed as rolls, so applying doesn't file them twice. */
  const filed = useRef(new Set<string>());

  const foe = actor.type === 'foe';
  const target = targetId ? sheetOf(targetId) : undefined;
  const targetFoe = target?.type === 'foe';
  const targetVital = vitalIn(target?.lists);
  const offered = defensesOf(target?.lists, pins, targetVital?.entry);

  /** Anything changed after a press means the press no longer describes it. */
  const touched = () => {
    setApplied(false);
    setLanded(null);
  };

  const file = async (record: RollRecord, key: string) => {
    filed.current.add(key);
    await api('/api/rolls', { body: record }).catch(() => undefined);
  };

  const throwPool = async (pool: string, key: string, forWhat: string, on?: Entity) => {
    if (!dice) return;
    const rolled = rollPool(pool, dice);
    const { total } = tallyFaces(rolled, dice);
    const who = on ?? actor;
    if (key === 'attack') setFaces(rolled);
    else if (key === 'defense') setDefFaces(rolled);
    else setTolFaces((prior) => ({ ...prior, [key]: rolled }));
    await file(
      {
        by: who.id,
        byName: who.name,
        pool,
        faces: rolled.filter((f): f is string => Boolean(f)),
        total,
        ...(dice.unit ? { unit: dice.unit } : {}),
        for: forWhat,
        round,
      },
      key,
    );
  };

  const hits = tallyFaces(faces ?? [], dice).total;
  const rolledDefense = tallyFaces(defFaces ?? [], dice).total;
  const typedNumber = typed.trim() === '' ? undefined : Number(typed.trim());
  const blocked =
    typedNumber !== undefined && Number.isFinite(typedNumber)
      ? Math.max(0, Math.round(typedNumber))
      : rolledDefense;
  const damage = damageFrom(hits, blocked);
  const rolled = (faces ?? []).some(Boolean) || !armed.damage;

  const defPool = combinePools(
    offered.filter((o) => defenses.includes(o.name) && typeof o.value === 'string' && isPool(o.value)).map((o) => String(o.value)),
  );

  /** What one inflicted status proposes right now — arithmetic and words. */
  const severityOf = (inflict: Entry) => {
    if (inflict.name in sevSet) {
      const set = sevSet[inflict.name];
      return { value: set, note: undefined as string | undefined };
    }
    const printed =
      typeof inflict.value === 'number'
        ? inflict.value
        : typeof inflict.value === 'string' && isPool(inflict.value)
          ? tallyFaces(tolFaces[`printed:${inflict.name}`] ?? [], dice).total
          : 0;
    const tol = toleranceFor(listOf(target, TOLERANCES), inflict.name);
    const relief =
      tol?.flat !== undefined
        ? tol.flat
        : tol?.pool
          ? tallyFaces(tolFaces[`tolerance:${inflict.name}`] ?? [], dice).total
          : 0;
    const held = numberOf(findEntry(listOf(target, conditionsList), inflict.name));
    const decl = statuses.find((s) => s.name.toLowerCase() === inflict.name.trim().toLowerCase());
    const out = proposeSeverity({
      printed,
      relief,
      ...(tol?.worsens ? { worsens: true } : {}),
      ...(held !== undefined ? { held } : {}),
      ...(conditionCap !== undefined ? { cap: conditionCap } : {}),
      ...(decl?.uncapped ? { uncapped: true } : {}),
    });
    return { value: out.value, note: out.note };
  };

  const setSeverity = (name: string, value: number | null) =>
    setSevSet((prior) => ({ ...prior, [name]: value }));

  /**
   * Land it. One press writes the damage, every status that still has a
   * severity, and what the turn spent — which is the only automation
   * here, and it happens after a human has read the arithmetic and
   * chosen to press.
   */
  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Anything hand-tapped and never thrown by teller still belongs in
      // the log — a die the Warden read off the table is the same fact.
      if (armed.damage && (faces ?? []).some(Boolean) && !filed.current.has('attack')) {
        await file(
          {
            by: actor.id,
            byName: actor.name,
            pool: armed.damage,
            faces: (faces ?? []).filter((f): f is string => Boolean(f)),
            total: hits,
            ...(dice?.unit ? { unit: dice.unit } : {}),
            for: `${armed.name} damage`,
            round,
          },
          'attack',
        );
      }

      const hung: { name: string; severity: number }[] = [];
      let vitalMove: ExchangeRecord['vital'] | undefined;

      if (target && targetVital && damage > 0) {
        const to = afterDamage(targetVital.entry, damage);
        vitalMove = {
          name: targetVital.entry.name,
          from: numberOf(targetVital.entry) ?? 0,
          to,
        };
        await onWrite(target.id, {
          list: targetVital.list,
          name: targetVital.entry.name,
          value: to,
        });
      }

      if (target) {
        for (const inflict of armed.inflicts) {
          const { value } = severityOf(inflict);
          if (value === null || value <= 0) continue;
          await onWrite(target.id, {
            list: conditionsList,
            name: inflict.name,
            value,
          });
          hung.push({ name: inflict.name, severity: value });
        }
      }

      const lines: ExchangeRecord['spend'] = [];
      if (costCounter) {
        const paid = spend ?? armed.cost ?? 0;
        // A line worth zero is kept when it says what it bought — that a
        // frenzy or a feature cost nothing is a fact the log should hold.
        if (paid > 0 || !armed.frenzy) lines.push({ counter: costCounter, amount: paid, on: armed.name });
        if (moved > 0) lines.push({ counter: costCounter, amount: moved, on: 'moving' });
        // Two lines out of the same counter come off it once.
        const owed = lines.reduce((sum, l) => sum + l.amount, 0);
        const purse = locate(actor.lists, costCounter);
        if (owed > 0 && purse) {
          await onWrite(actor.id, {
            list: purse.list,
            name: purse.entry.name,
            value: Math.max(0, (numberOf(purse.entry) ?? 0) - owed),
          });
        }
      }

      await api('/api/exchange', {
        body: {
          by: actor.id,
          byName: actor.name,
          ...(target ? { target: target.id, targetName: target.name } : {}),
          action: armed.name,
          hits: target ? hits : 0,
          blocked: target ? blocked : 0,
          damage: target ? damage : 0,
          ...(vitalMove ? { vital: vitalMove } : {}),
          statuses: hung,
          spend: lines,
          round,
        } satisfies ExchangeRecord,
      });
      // What actually happened, kept — so the row goes on saying it
      // rather than re-deriving off a counter that is now the AFTER
      // (the old app's `appliedFrom`, and its lesson).
      setApplied(true);
      setLanded(vitalMove ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-amber-800/60 bg-stone-900/70 p-3.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-amber-200">{armed.name}</span>
        {/* One line of it. A frenzy's note is a whole paragraph, and it
            is already printed in full further down the stage — here it
            only has to say WHICH thing is armed. */}
        {armed.note && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10px] text-stone-600"
            title={armed.note}
          >
            {armed.note}
          </span>
        )}
        <button
          className="ml-auto rounded-md px-1.5 py-1 text-[11px] text-stone-500 transition-colors hover:text-red-300"
          title="put it back"
          onClick={onDisarm}
        >
          ✕
        </button>
      </div>

      {/* 1 — the dice the action calls for */}
      {armed.damage && dice && (
        <div className="mt-3 border-t border-stone-800 pt-2.5">
          {stepPip(1, `roll ${armed.damage} — ${armed.name}`)}
          <div className="mt-2">
            <DicePool
              pool={armed.damage}
              faces={faces}
              onFaces={setFaces}
              dice={dice}
              icons={icons}
              // teller throws for foes and nobody else. A player's attack
              // is theirs to throw; this records what the plastic said.
              onRoll={
                foe ? () => throwPool(armed.damage!, 'attack', `${armed.name} damage`) : undefined
              }
            />
          </div>
        </div>
      )}

      {/* 2 — who it lands on, and what they had to stop it */}
      {rolled && (
        <div className="mt-3 border-t border-stone-800 pt-2.5">
          {stepPip(2, 'who it lands on, and what stops it')}
          <div className="mt-2 flex flex-wrap gap-1">
            {order
              .filter((e) => e.id !== actor.id)
              .map((e) => (
                <button
                  key={e.id}
                  className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                    targetId === e.id
                      ? 'bg-amber-800 text-amber-50'
                      : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                  }`}
                  onClick={() => {
                    setTargetId(targetId === e.id ? undefined : e.id);
                    setDefenses([]);
                    setDefFaces(undefined);
                    setTyped('');
                    setSevSet({});
                    touched();
                  }}
                >
                  {e.label}
                </button>
              ))}
          </div>

          {target && (
            <div className="mt-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-1">
                {offered.map((o) => {
                  const on = defenses.includes(o.name);
                  const pool = typeof o.value === 'string' && isPool(o.value);
                  return (
                    <button
                      key={o.name}
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        on ? 'bg-sky-900 text-sky-100' : 'bg-stone-800 text-stone-500 hover:bg-stone-700'
                      } ${pool ? '' : 'opacity-50'}`}
                      title={pool ? 'roll this alongside anything else it brought' : 'nothing printed — type what the table rolled'}
                      disabled={!pool}
                      onClick={() => {
                        setDefenses(on ? defenses.filter((d) => d !== o.name) : [...defenses, o.name]);
                        setDefFaces(undefined);
                        touched();
                      }}
                    >
                      {o.name} {o.value !== undefined ? String(o.value) : '—'}
                    </button>
                  );
                })}
                {/* The table's own hands. A player rolls their own
                    defense at the table and reads the number out; every
                    surface here is a recording instrument first. */}
                <span className="flex items-center gap-1 font-mono text-[10px] text-stone-500">
                  or they rolled
                  <input
                    className="w-12 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-[11px] text-stone-100 focus:outline-none"
                    inputMode="numeric"
                    placeholder="—"
                    aria-label="what the target rolled"
                    value={typed}
                    onChange={(e) => {
                      setTyped(e.target.value);
                      touched();
                    }}
                  />
                </span>
              </div>

              {defPool && dice && typedNumber === undefined && (
                <DicePool
                  pool={defPool}
                  faces={defFaces}
                  onFaces={setDefFaces}
                  dice={dice}
                  icons={icons}
                  size="sm"
                  // Same line as everywhere: teller throws for foes only.
                  onRoll={
                    targetFoe
                      ? () => throwPool(defPool, 'defense', `${target.name} defense`, target)
                      : undefined
                  }
                />
              )}

              {/* 3 — what it hangs on them, against what they tolerate */}
              {armed.inflicts.length > 0 && (
                <div className="space-y-1.5 border-t border-stone-800/70 pt-2">
                  {stepPip(3, 'what it hangs on them')}
                  {armed.inflicts.map((inflict) => {
                    const printedPool =
                      typeof inflict.value === 'string' && isPool(inflict.value)
                        ? inflict.value
                        : undefined;
                    const tol = toleranceFor(listOf(target, TOLERANCES), inflict.name);
                    const { value, note } = severityOf(inflict);
                    return (
                      <div key={inflict.name} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-stone-400">
                          {inflict.name}
                          {inflict.value !== undefined && ` [${inflict.value}]`}
                        </span>
                        {printedPool && dice && (
                          <DicePool
                            pool={printedPool}
                            faces={tolFaces[`printed:${inflict.name}`]}
                            onFaces={(f) =>
                              setTolFaces((prior) => ({ ...prior, [`printed:${inflict.name}`]: f }))
                            }
                            dice={dice}
                            icons={icons}
                            size="sm"
                            onRoll={() =>
                              throwPool(
                                printedPool,
                                `printed:${inflict.name}`,
                                `${inflict.name} severity`,
                              )
                            }
                          />
                        )}
                        {tol?.pool && dice && (
                          <>
                            <span
                              className="font-mono text-[10px] text-sky-300"
                              title={
                                tol.worsens
                                  ? 'a negative tolerance — it makes this worse'
                                  : 'what they tolerate of this'
                              }
                            >
                              tolerates {tol.worsens ? '−' : ''}
                              {tol.pool}
                            </span>
                            <DicePool
                              pool={tol.pool}
                              faces={tolFaces[`tolerance:${inflict.name}`]}
                              onFaces={(f) =>
                                setTolFaces((prior) => ({
                                  ...prior,
                                  [`tolerance:${inflict.name}`]: f,
                                }))
                              }
                              dice={dice}
                              icons={icons}
                              size="sm"
                              onRoll={() =>
                                throwPool(
                                  tol.pool!,
                                  `tolerance:${inflict.name}`,
                                  `${target.name} tolerance — ${inflict.name}`,
                                  target,
                                )
                              }
                            />
                          </>
                        )}
                        {tol?.flat !== undefined && (
                          <span className="font-mono text-[10px] text-sky-300">
                            tolerates {tol.worsens ? '+' : '−'}
                            {tol.flat}
                          </span>
                        )}
                        {/* Nudge it, or drop it entirely. A blocked hit
                            that still hangs a status is teller ruling on
                            the table's behalf. */}
                        <span className="flex items-center gap-0.5">
                          <button
                            className="rounded px-1 text-xs text-stone-500 hover:bg-stone-800 hover:text-stone-200"
                            aria-label={`${inflict.name} severity down`}
                            onClick={() => setSeverity(inflict.name, Math.max(0, (value ?? 0) - 1))}
                          >
                            −
                          </button>
                          <button
                            className="rounded px-1 text-xs text-stone-500 hover:bg-stone-800 hover:text-stone-200"
                            aria-label={`${inflict.name} severity up`}
                            onClick={() => setSeverity(inflict.name, (value ?? 0) + 1)}
                          >
                            +
                          </button>
                          <button
                            className={`ml-1 rounded px-1.5 font-mono text-[10px] transition-colors ${
                              value === null
                                ? 'bg-stone-800 text-stone-600'
                                : 'text-stone-500 hover:text-red-300'
                            }`}
                            title={value === null ? 'put it back' : "don't hang this one"}
                            onClick={() =>
                              setSeverity(
                                inflict.name,
                                value === null
                                  ? typeof inflict.value === 'number'
                                    ? inflict.value
                                    : 1
                                  : null,
                              )
                            }
                          >
                            {value === null ? 'dropped' : '✕'}
                          </button>
                        </span>
                        {value !== null && (
                          <span className="font-mono text-[11px] text-sky-300">
                            → {inflict.name} {value}
                          </span>
                        )}
                        {note && value !== null && (
                          <span className="font-mono text-[10px] text-stone-600">{note}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* The ledger — outside the target block on purpose. A turn
              aimed at nobody still costs its actor and still belongs in
              the log; gating this row on a target is what once left
              hiding, repositioning and readying unrecorded. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-lg bg-stone-950/60 px-3 py-2">
            {target ? (
              <span className="font-mono text-[11px] text-stone-400">
                {hits} − {blocked} = <span className="text-base text-amber-200">{damage}</span>{' '}
                {targetVital ? targetVital.entry.name.toLowerCase() : 'damage'}
                {(landed ?? targetVital) && (
                  <span className="ml-1.5 text-stone-600">
                    {landed
                      ? `${landed.from} → ${landed.to}`
                      : `${numberOf(targetVital!.entry) ?? 0} → ${afterDamage(targetVital!.entry, damage)}`}
                  </span>
                )}
              </span>
            ) : (
              <span className="font-mono text-[11px] text-stone-500">nobody is hit</span>
            )}

            {costCounter && (
              <>
                <Stepper
                  label="action"
                  value={spend ?? armed.cost ?? 0}
                  unit={costCounter}
                  onSet={(n) => {
                    setSpend(n);
                    touched();
                  }}
                />
                <Stepper
                  label="moving"
                  value={moved}
                  unit={costCounter}
                  onSet={(n) => {
                    setMoved(n);
                    touched();
                  }}
                />
              </>
            )}

            <button
              className={`ml-auto ${applied ? btn : btnPrimary} text-xs ${busy ? 'animate-pulse' : ''}`}
              disabled={busy}
              onClick={apply}
            >
              {applied ? 'recorded ✓' : target ? `apply to ${target.name}` : 'record this turn'}
            </button>
          </div>

          {/* A frenzy prints its price in a sentence, and teller does not
              read sentences (§I). The stepper above starts at nothing and
              the counter is right there on the stage — say so once rather
              than guessing a number nobody printed. */}
          {armed.frenzy && armed.cost === undefined && costCounter && (
            <p className="mt-1.5 px-1 text-[10px] italic text-stone-600">
              what a frenzy costs is written in its own words — set {costCounter} above, or on the
              bars.
            </p>
          )}

          {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}

// THE STAGE — whoever's turn it is, at full size.
//
// Ported from the old app (src/components/TurnStage.tsx, and its header
// grammar verbatim): the roster answers "who's up and who's hurt", this
// answers "what do they do", and it only ever shows ONE combatant — the
// one acting. That is the whole reason it can afford to be generous.
// Anything you do to somebody ELSE happens over in the order, so there
// is no selection to get lost in and no way to be looking at the wrong
// sheet.
//
// What the old one had and this doesn't: the ✦ propose/roll/resolve/
// narrate flow. The proposal half now lives in `ProviderSlot` — the
// runner asks for a POINT and never learns what answers it — and the
// dice/target/resolve half is WiW's own machinery, not yet ported. Both
// are deliberate, both noted in the runner.
//
// Everything printed is drawn by the SHARED statblock (`TemplateSheet`):
// one statblock, rendered the same in both places, which is the law this
// tool would otherwise be the third violation of. What's added here is
// only what a TURN needs and a printing doesn't — the bars you push, the
// statuses you hang, and the gate that has opened.

import { numberOf, type Entry } from '../../../core/entity.ts';
import { readGate } from '../../../core/gate.ts';
import type { Template } from '../../../core/stamp.ts';
import { sectionLabel } from '../../lib/ui.ts';
import { CounterStepper } from '../Vitals.tsx';
import { StatPools, StatblockProse, StatusChip, attackProfile } from './TemplateSheet.tsx';

/** The system's own declared statuses — a host with none renders no row. */
export type StatusDecl = { name: string; relief?: string; effect?: string };

export type EntryWrite = {
  list: string;
  name: string;
  value?: number | string;
  remove?: boolean;
};

/** Clamp a bump the way every stepper in teller does: floor at 0, ceiling if declared. */
function bumped(entry: Entry, delta: number): number {
  const value = numberOf(entry) ?? 0;
  const next = value + delta;
  return Math.max(0, typeof entry.max === 'number' ? Math.min(entry.max, next) : next);
}

/**
 * What it can do, as chips — the pool and what it inflicts one glance
 * away rather than one dialog away (Brian, 2026-08-15: "I don't wanna
 * have to click into the info popup every time I have a question").
 *
 * A FRENZY is the same chip wearing its gate. An unmet gate DIMS and
 * never disables: teller shows the Warden where the line is and lets
 * them cross it (rule 1). Reaching one is the interesting moment of a
 * fight, and it lights up on its own.
 */
function DoesRow({ acting }: { acting: Template }) {
  const attacks = (acting.children ?? []).filter((c) => c.type === 'attack');
  const frenzies = (acting.children ?? []).filter((c) => c.type === 'frenzy');
  if (!attacks.length && !frenzies.length) return null;
  return (
    <div className="mt-3 border-t border-stone-800 pt-2.5">
      <span className="text-[10px] uppercase tracking-widest text-stone-600">What it does</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {attacks.map((attack) => {
          const p = attackProfile(attack);
          return (
            <span
              key={attack.id}
              className="rounded-md bg-stone-800 px-2 py-1 text-left font-mono text-[11px] text-stone-300"
            >
              {attack.name}
              {/* The band, because one weapon prints a pool per reach and
                  two identical chips are otherwise indistinguishable. */}
              {p.band && <span className="ml-1.5 text-[10px] text-stone-500">{p.band}</span>}
              {p.aoe && <span className="ml-1.5 text-[10px] text-stone-500">AOE</span>}
              {p.damage && <span className="ml-1.5 text-amber-300">{p.damage.value}</span>}
              {p.cost !== undefined && (
                <span className="ml-1.5 text-[10px] text-stone-500">{p.cost.value} grit</span>
              )}
              {p.inflicts.map((s) => (
                <span key={s.name} className="ml-1.5">
                  <StatusChip entry={s} />
                </span>
              ))}
            </span>
          );
        })}
        {frenzies.map((frenzy) => {
          const gate = readGate(frenzy, acting.lists);
          const open = gate?.met ?? false;
          return (
            <span
              key={frenzy.id}
              className={`rounded-md px-2 py-1 text-left font-mono text-[11px] ${
                open ? 'bg-rose-950/70 text-rose-200' : 'bg-stone-900 text-stone-600'
              }`}
              title={frenzy.notes ?? undefined}
            >
              {frenzy.name}
              {gate && (
                <span className={`ml-1.5 text-[10px] ${open ? 'text-rose-300' : 'text-stone-600'}`}>
                  {open ? 'ready' : `at ${gate.at} ${gate.counter.toLowerCase()}`}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TurnStage({
  acting,
  index,
  total,
  round,
  statuses,
  accent,
  onWrite,
}: {
  /** The acting entity, RESOLVED — a thin stamp's template values are facts. */
  acting: Template;
  index: number;
  total: number;
  round: number;
  statuses: StatusDecl[];
  /** The party accent for this trade, if the system declared one. Foes get red. */
  accent?: string;
  onWrite: (edit: EntryWrite) => void;
}) {
  const foe = acting.type === 'foe';
  const conditions = acting.lists?.conditions ?? [];
  // Bounded first: mid-fight you want Health and Grit, not a running
  // Prestige total that has no ceiling to draw.
  const resources = [...(acting.lists?.resources ?? [])].sort(
    (a, b) => Number(b.max !== undefined) - Number(a.max !== undefined),
  );
  const held = (name: string) =>
    conditions.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  // Conditions the system never declared — someone typed them, so they
  // stay visible and stay removable rather than vanishing off the stage.
  const loose = conditions.filter(
    (c) => !statuses.some((s) => s.name.trim().toLowerCase() === c.name.trim().toLowerCase()),
  );

  return (
    <div className="@container space-y-2.5">
      <div className="rounded-xl border border-stone-800 bg-stone-900/70 p-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-serif text-xl text-amber-50">{acting.name}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              foe ? 'bg-red-950 text-red-300' : 'bg-stone-800 text-stone-400'
            }`}
            style={!foe && accent ? { color: accent } : undefined}
          >
            {acting.type ?? 'unlisted'}
          </span>
          <span className="ml-auto font-mono text-[10px] text-stone-600">
            {index + 1} of {total} · round {round}
          </span>
        </div>

        {resources.length > 0 && (
          <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-2">
            {resources.slice(0, 4).map((entry) => (
              <CounterStepper
                key={entry.name}
                entry={entry}
                big
                onBump={(delta) =>
                  onWrite({ list: 'resources', name: entry.name, value: bumped(entry, delta) })
                }
              />
            ))}
          </div>
        )}

        {/* The statuses, as toggles. Tap hangs one, tap takes it off —
            the severity rides the lit chip, which is the only place a
            number for it is visible on the stage. */}
        {(statuses.length > 0 || loose.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1">
            {statuses.map((status) => {
              const on = held(status.name);
              return (
                <button
                  key={status.name}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    on
                      ? 'bg-amber-700 text-stone-950'
                      : 'bg-stone-900 text-stone-500 hover:bg-stone-800'
                  }`}
                  title={status.relief ? `relieved by ${status.relief}` : status.name}
                  onClick={() =>
                    onWrite(
                      on
                        ? { list: 'conditions', name: status.name, remove: true }
                        : { list: 'conditions', name: status.name },
                    )
                  }
                >
                  {status.name}
                  {on?.value !== undefined && ` ${on.value}`}
                </button>
              );
            })}
            {loose.map((entry) => (
              <button
                key={entry.name}
                className="rounded-full bg-sky-950 px-2 py-0.5 font-mono text-[11px] text-sky-300 transition-colors hover:bg-red-950 hover:text-red-300"
                title="remove"
                onClick={() => onWrite({ list: 'conditions', name: entry.name, remove: true })}
              >
                {entry.name}
                {entry.value !== undefined && ` ${entry.value}`} ✕
              </button>
            ))}
          </div>
        )}

        <DoesRow acting={acting} />

        {/* And what it IS, right here. Same renderer the bestiary dialog
            uses — one statblock, two places, no chance of them drifting
            apart. `resources` is skipped: it's the bars above. */}
        <div className="mt-3 space-y-4 border-t border-stone-800 pt-3">
          <StatPools template={acting} skip={['resources', 'conditions']} />
          <StatblockProse template={acting} />
        </div>

        {acting.notes && (
          <div className="mt-4">
            <span className={sectionLabel}>Notes</span>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-300">
              {acting.notes}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

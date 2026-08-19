// The 'runner' tool — the turn order, running. Ported grammar from the
// old app's EncounterPanel (src/components/EncounterPanel.tsx) + the
// TurnStage header (src/components/TurnStage.tsx, ~510-551): a round
// badge, a divided roster list with the acting row picked out, and a
// stage below it showing who's up at full size. Trimmed to what this
// tool owns — no targeting, no assistant, no per-row HP bump; that
// belonged to a game (WiW's advice/dice/statblock machinery) this
// generic runner doesn't know about. Reorder is up/down buttons, not
// drag — noted as a gap below.
//
// Also owns the 'turn' BLOCK (entity panels' slice of the same state):
// a seat's own sheet can show "you're up" without importing this whole
// tool.

import { useState } from 'react';
import type { Entity } from '../../core/entity.ts';
import { api } from '../lib/api.ts';
import { rollPool, tallyFaces, type DiceRecord } from '../lib/dice.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { registerBlock, type BlockCtx } from '../panels/render.tsx';
import { EntityCard, usePanelRecords, useSheetPanel } from '../components/roster/EntityCard.tsx';
import { registerTool } from './index.ts';

// The `initiative` stack record (docs/CORE-NEXT.md §J, same shallow-merge
// slot as `dice`/`marks`): which skill decides order, and which way it
// reads. Ported straight off the old app's template row — Guidebook,
// Turn Order: "the Warden will ask the players to roll with Finesse to
// determine turn order. The player with the highest number of Hits will
// go first" — `{ field: 'finesse', highWins: true }`. Fetching it live
// rather than hardcoding "finesse" is what makes this generic: a
// different system's row changes the record, not this file.
type InitiativeRecord = { field?: string; highWins?: boolean };

// ---- the shape of /api/turn (server/turn.ts) — mirrored, not imported:
// the server module isn't otherwise part of the client's dependency
// graph, and this is the whole of what the tool needs from it. ----

type TurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

type TurnState = {
  order: TurnEntry[];
  turn: number | null;
  round: number;
  rolling?: boolean;
};

type TurnOp =
  | { op: 'set'; order: TurnEntry[] }
  | { op: 'add'; entityId?: string; label?: string }
  | { op: 'remove'; entryId: string }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'end' }
  | { op: 'rolling'; on: boolean }
  | { op: 'score'; entryId: string; score: number | null };

type RosterEntry = { id: string; name: string; type: string | null };

function move(order: TurnEntry[], from: number, to: number): TurnEntry[] {
  if (to < 0 || to >= order.length) return order;
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function RunnerTool() {
  const turn = useLive(() => api<TurnState>('/api/turn'), []);
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), []);
  const dice = useLive(() => api<DiceRecord>('/api/stack/record/dice'), []);
  const initiative = useLive(() => api<InitiativeRecord>('/api/stack/record/initiative'), []);
  const panel = useSheetPanel();
  const records = usePanelRecords();
  const [draft, setDraft] = useState('');
  const [rollingFoes, setRollingFoes] = useState(false);

  const order = turn.data?.order ?? [];
  const running = turn.data?.turn !== null && turn.data !== undefined;
  const rolling = turn.data?.rolling ?? false;

  const op = (o: TurnOp) => api('/api/turn', { body: o }).then(turn.reload);

  const names = new Map((roster.data ?? []).map((e) => [e.id, e.name]));
  const seated = new Set(order.map((e) => e.entityId).filter(Boolean));
  const unlisted = (roster.data ?? []).filter(
    (e) => e.type === 'pc' && !seated.has(e.id),
  );

  const addEntry = (label: string, entityId: string | null) => {
    const trimmed = label.trim();
    if (!trimmed && !entityId) return;
    op({ op: 'add', entityId: entityId ?? undefined, label: trimmed || undefined });
    setDraft('');
  };

  const roles = new Map((roster.data ?? []).map((e) => [e.id, e.type]));
  // Foes with a seat in the order and nothing rolled yet — a re-run
  // after someone's hand-typed a score leaves that entry alone.
  const unrolledFoes = order.filter(
    (e) => e.entityId && roles.get(e.entityId) === 'foe' && e.score == null,
  );

  /**
   * Roll initiative for the foes only (rule 5, as amended — teller may
   * roll for monsters; the players' dice stay physical). Reads the
   * `initiative` record for which skill decides it, rolls that skill's
   * printed pool off the `dice` record, tallies it in the record's own
   * unit, and writes the total the same way a hand-typed score would —
   * a proposal into `POST /api/turn {op:'score'}`, one drag or retype
   * from being overruled (rule 1).
   *
   * Deliberately does NOT touch `dice.banks` (Ace → Aces): banking an
   * Ace onto a counter is a player-facing beat at the table, and a foe
   * rolled by teller has nobody to hand that beat to. Left for a caller
   * that rolls FOR a player to wire, not assumed here.
   */
  const rollFoes = async () => {
    if (!dice.data || !initiative.data?.field || unrolledFoes.length === 0) return;
    setRollingFoes(true);
    try {
      const field = initiative.data.field.toLowerCase();
      for (const entry of unrolledFoes) {
        const foe = await api<Entity>(`/api/entities/${entry.entityId}?resolved=1`);
        const skills = foe.lists?.skills ?? [];
        const skill = skills.find((s) => s.name.toLowerCase() === field);
        if (!skill || typeof skill.value !== 'string') continue;
        const faces = rollPool(skill.value, dice.data);
        const { total } = tallyFaces(faces, dice.data);
        await api('/api/turn', { body: { op: 'score', entryId: entry.id, score: total } });
      }
      turn.reload();
    } finally {
      setRollingFoes(false);
    }
  };

  const acting = turn.data?.turn !== null && turn.data ? order[turn.data.turn!] : undefined;

  return (
    <div className="@container space-y-3">
      <div className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Runner</span>
          {running && (
            <span className="rounded bg-amber-950 px-2 py-0.5 font-mono text-xs text-amber-300">
              round {turn.data!.round}
            </span>
          )}
        </div>

        {order.length === 0 && (
          <p className="text-sm text-stone-600">
            add combatants, arrange to match the table, then start
          </p>
        )}

        {order.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
            {rolling ? (
              <>
                <span className="font-mono text-xs text-amber-300">taking rolls</span>
                <button
                  className={`${btn} ml-auto text-xs`}
                  onClick={() => op({ op: 'rolling', on: false })}
                >
                  done
                </button>
              </>
            ) : (
              <>
                <span className="font-mono text-[11px] text-stone-600">
                  seats can enter their own initiative
                </span>
                <button
                  className={`${btn} text-xs`}
                  onClick={() => op({ op: 'rolling', on: true })}
                >
                  take rolls
                </button>
              </>
            )}
            {unrolledFoes.length > 0 && (
              <button
                className={`${btn} ${rolling ? '' : 'ml-auto'} text-xs`}
                disabled={rollingFoes || !dice.data || !initiative.data?.field}
                title={`roll ${initiative.data?.field ?? 'initiative'} for ${unrolledFoes.length} foe${unrolledFoes.length === 1 ? '' : 's'} — teller rolls, you can still overrule any of it`}
                onClick={rollFoes}
              >
                {rollingFoes ? 'rolling…' : `roll ${unrolledFoes.length} foe${unrolledFoes.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        )}

        <div className="grid items-start gap-4 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            {order.length > 0 ? (
              <ol className="divide-y divide-stone-800/60 overflow-hidden rounded-lg">
                {order.map((entry, i) => {
                  const isTurn = turn.data?.turn === i;
                  const label = entry.label ?? (entry.entityId && names.get(entry.entityId)) ?? '?';
                  return (
                    <li
                      key={entry.id}
                      className={`group border-l-2 px-2 py-1.5 ${
                        isTurn
                          ? 'border-l-amber-600 bg-amber-950/40'
                          : 'border-l-stone-700 bg-stone-900/40 hover:bg-stone-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-4 shrink-0 text-right font-mono text-[10px] ${
                            isTurn ? 'text-amber-300' : 'text-stone-600'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-[13px] ${
                            isTurn ? 'text-amber-100' : 'text-stone-300'
                          }`}
                        >
                          {label}
                        </span>
                        {rolling ? (
                          <input
                            className="w-10 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-[11px] text-stone-100 focus:outline-none"
                            inputMode="numeric"
                            placeholder="—"
                            defaultValue={entry.score ?? ''}
                            aria-label={`${label} rolled`}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              const n = Number(e.currentTarget.value.trim());
                              if (!Number.isFinite(n)) return;
                              op({ op: 'score', entryId: entry.id, score: n });
                            }}
                          />
                        ) : (
                          typeof entry.score === 'number' && (
                            <span className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[10px] text-amber-300">
                              {entry.score}
                            </span>
                          )
                        )}
                        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-30"
                            disabled={i === 0}
                            title="move up"
                            onClick={() => op({ op: 'set', order: move(order, i, i - 1) })}
                          >
                            ▲
                          </button>
                          <button
                            className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-30"
                            disabled={i === order.length - 1}
                            title="move down"
                            onClick={() => op({ op: 'set', order: move(order, i, i + 1) })}
                          >
                            ▼
                          </button>
                          <button
                            className="rounded px-1 text-xs text-stone-500 hover:bg-red-950 hover:text-red-300"
                            title="remove from the order"
                            onClick={() => op({ op: 'remove', entryId: entry.id })}
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-stone-800 px-3 py-6 text-center text-[11px] text-stone-600">
                the turn order builds here
              </p>
            )}

            <div className="space-y-2">
              {unlisted.length > 0 && (
                <div className="space-y-1.5 rounded-lg bg-stone-900/60 px-2 py-2">
                  <span className={sectionLabel}>Not in the order yet</span>
                  <div className="flex flex-wrap gap-1.5">
                    {unlisted.map((c) => (
                      <button
                        key={c.id}
                        className={btnGhost}
                        onClick={() => addEntry(c.name, c.id)}
                        title={`put ${c.name} in the turn order`}
                      >
                        + {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className={`${input} min-w-0 flex-1`}
                  placeholder="ad-hoc: 3 prairie wolves…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addEntry(draft, null)}
                />
                <button className={btn} onClick={() => addEntry(draft, null)}>
                  add
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {running && acting ? (
              acting.entityId && panel ? (
                <EntityCard id={acting.entityId} panel={panel} records={records.data ?? {}} />
              ) : (
                <p className="text-sm text-stone-600">
                  {acting.label ?? 'unlabeled'} is up — an ad-hoc entry, so there's no sheet to
                  show.
                </p>
              )
            ) : running ? (
              <p className="text-sm text-stone-600">no one is up</p>
            ) : (
              <p className="text-sm text-stone-600">not running — start combat to open the stage</p>
            )}

            <div className="flex items-center gap-2">
              <button className={btn} disabled={!running} onClick={() => op({ op: 'prev' })}>
                ◂ back
              </button>
              <button
                className={`${btnPrimary} px-6`}
                disabled={order.length === 0}
                onClick={() => op({ op: 'next' })}
              >
                {running ? 'next turn ▸' : 'start combat'}
              </button>
              <button
                className={`${btn} ml-auto hover:bg-red-950`}
                disabled={!running}
                onClick={() => op({ op: 'end' })}
              >
                end
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

registerTool('runner', () => <RunnerTool />);

// ---- the 'turn' block — one entity's own slice of the same state -----

function TurnBlock({ ctx }: { ctx: BlockCtx }) {
  const e = ctx.entity as Entity | undefined;
  const turn = useLive(() => api<TurnState>('/api/turn'), []);
  if (!e || !turn.data) return null;
  const idx = turn.data.order.findIndex((entry) => entry.entityId === e.id);
  if (idx === -1) return null;
  const entry = turn.data.order[idx];
  const isActing = turn.data.turn === idx;
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 font-mono text-xs ${
        isActing ? 'bg-amber-950/60 text-amber-300' : 'bg-stone-900 text-stone-500'
      }`}
    >
      <span>{isActing ? 'acting now' : `#${idx + 1} in the order`}</span>
      {typeof entry.score === 'number' && (
        <span className="ml-auto text-stone-400">score {entry.score}</span>
      )}
    </div>
  );
}

registerBlock('turn', (_block, ctx) => <TurnBlock ctx={ctx} />);

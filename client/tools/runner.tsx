// The 'runner' tool — the turn order, running. Rebuilt against the old
// app's shape (src/components/EncounterPanel.tsx + TurnStage.tsx), which
// is the visual and behavioural spec:
//
//   * the ORDER on the left, a thing you SCAN — a number, a name, a bar,
//     a dot — with the acting row picked out and the health steppers on
//     the row you're hovering. The edit you make most often is to
//     somebody ELSE'S health, on the turn of the thing that just hit
//     them, so it lives there and never costs you the stage;
//   * the STAGE on the right, one combatant at full size (`TurnStage`);
//   * the controls under it: back, next turn, end;
//   * and setup folded to one line the moment a fight is running.
//
// One thing the old panel had is deliberately elsewhere: the ✦ box is a
// `ProviderSlot` — this file names a POINT ('propose.turn') and cannot
// learn what provides it, so a host with no plugin renders no box at
// all. The target/dice/resolve flow that used to live inside that box
// does NOT depend on it: arming an action is a tap on the stage, and the
// exchange runs identically with every plugin turned off. What the
// runner hands down is what the fight needs and this file doesn't know —
// the order, the sheets, and the system's own records (dice, pins, use).
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
import { ProviderSlot } from '../components/ProviderSlot.tsx';
import { VitalBar } from '../components/Vitals.tsx';
import {
  TurnStage,
  type Armed,
  type EntryWrite,
  type StatusDecl,
} from '../components/encounters/TurnStage.tsx';
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

/**
 * The `use` record — what an action is paid out of. Already declared for
 * the carried screens' fire button; the runner needs the same counter,
 * which is what keeps a cost from being a word spelled in this file.
 */
type UseRecord = { costCounter?: string };

/** Enough of a kind declaration to read a list's ceiling off it. */
type KindDecl = { name: string; domain?: { kind?: string; cap?: number } };

/**
 * Which list a hung condition is written to — the same word the stage
 * already draws its status chips from, and the one the system declares a
 * kind for (its label and its ceiling ride that declaration, so the
 * VOCABULARY is the pack's; only the slot is spelled here).
 */
const CONDITIONS = 'conditions';

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

/** Mirrors `Display` (core/store.ts) — same reasoning as `TurnState`. */
type Display = {
  id: string;
  role: string;
  color?: string;
  params: Record<string, unknown>;
  lastSeenAt?: string;
};

/** A screen is "live" if it has spoken to us lately (ported from `screens.tsx`). */
function isLive(display: Display): boolean {
  if (!display.lastSeenAt) return false;
  const raw = display.lastSeenAt;
  const seen = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isFinite(seen) && Date.now() - seen < 60_000;
}

function move(order: TurnEntry[], from: number, to: number): TurnEntry[] {
  if (to < 0 || to >= order.length) return order;
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The counter a hit comes off — the first BOUNDED one, as everywhere.
 * `resources` first because that's where the system files them; any
 * other list is the floor under a sheet that doesn't (rule 2 — teller
 * never learns a counter's name).
 */
function vitalOf(entity: Entity | undefined) {
  if (!entity) return undefined;
  const ordered = [
    ...(entity.lists.resources ?? []),
    ...Object.entries(entity.lists)
      .filter(([key]) => key !== 'resources')
      .flatMap(([, entries]) => entries),
  ];
  return ordered.find((e) => typeof e.max === 'number' && e.max > 0);
}

function RunnerTool() {
  const turn = useLive(() => api<TurnState>('/api/turn'), []);
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), []);
  const dice = useLive(() => api<DiceRecord>('/api/stack/record/dice'), []);
  const initiative = useLive(() => api<InitiativeRecord>('/api/stack/record/initiative'), []);
  const statuses = useLive(() => api<StatusDecl[]>('/api/stack/declarations/statuses'), []);
  const accents = useLive(() => api<Record<string, string>>('/api/stack/record/accents'), []);
  const icons = useLive(() => api<Record<string, string>>('/api/stack/record/icons'), []);
  const pins = useLive(() => api<Record<string, string[]>>('/api/stack/record/pins'), []);
  const use = useLive(() => api<UseRecord>('/api/stack/record/use'), []);
  const kinds = useLive(() => api<KindDecl[]>('/api/stack/declarations/kinds'), []);
  const displays = useLive(() => api<Display[]>('/api/displays'), []);
  const [draft, setDraft] = useState('');
  /** What the acting thing is about to do. Cleared when the turn moves. */
  const [armed, setArmed] = useState<Armed | undefined>(undefined);
  const [rollingFoes, setRollingFoes] = useState(false);
  /** Setup, while a fight is running — closed by default, on purpose. */
  const [setupOpen, setSetupOpen] = useState(false);

  const order = turn.data?.order ?? [];
  const running = turn.data?.turn !== null && turn.data !== undefined;
  const rolling = turn.data?.rolling ?? false;

  // Every sheet in the order, resolved, in ONE go — the bars, the
  // steppers and the stage all read the same fetch, so a row and the
  // stage can never disagree about a number. Keyed on the ids so adding
  // somebody refetches and nothing else does.
  const ids = order.map((e) => e.entityId).filter((id): id is string => Boolean(id));
  const sheets = useLive(
    async () =>
      Object.fromEntries(
        await Promise.all(
          ids.map(async (id) => [id, await api<Entity>(`/api/entities/${id}?resolved=1`)] as const),
        ),
      ) as Record<string, Entity>,
    [ids.join(',')],
  );
  const sheetOf = (id: string | undefined) => (id ? sheets.data?.[id] : undefined);

  /** The declared ceiling for hung conditions, presented and never enforced. */
  const conditionCap = (kinds.data ?? []).find((k) => k.name.toLowerCase() === CONDITIONS)?.domain
    ?.cap;

  const op = (o: TurnOp) => {
    // Walking the order puts down whatever was armed: an action belongs
    // to the turn that armed it, and carrying one forward is how a
    // creature ends up swinging somebody else's attack.
    if (o.op === 'next' || o.op === 'prev' || o.op === 'end') setArmed(undefined);
    return api('/api/turn', { body: o }).then(turn.reload);
  };

  const writeEntry = (entityId: string, edit: EntryWrite) =>
    api(`/api/entities/${entityId}/entry`, { body: edit }).then(sheets.reload);

  const names = new Map((roster.data ?? []).map((e) => [e.id, e.name]));
  const roles = new Map((roster.data ?? []).map((e) => [e.id, e.type]));
  const seated = new Set(order.map((e) => e.entityId).filter(Boolean));
  const unlisted = (roster.data ?? []).filter((e) => e.type && e.type !== 'foe' && !seated.has(e.id));

  /** Which entities somebody is sitting in front of, and whether they're live. */
  const seats = new Map(
    (displays.data ?? [])
      .filter((d) => d.role === 'seat' && typeof d.params?.entityId === 'string')
      .map((d) => [String(d.params.entityId), d]),
  );

  const addEntry = (label: string, entityId: string | null) => {
    const trimmed = label.trim();
    if (!trimmed && !entityId) return;
    op({ op: 'add', entityId: entityId ?? undefined, label: trimmed || undefined });
    setDraft('');
  };

  // Foes with a seat in the order and nothing rolled yet — a re-run
  // after someone's hand-typed a score leaves that entry alone.
  const unrolledFoes = order.filter(
    (e) => e.entityId && roles.get(e.entityId) === 'foe' && e.score == null,
  );

  /**
   * Roll initiative (rule 5, as amended — teller may roll for monsters;
   * the players' dice stay physical). One press does what the old app's
   * did: opens the rolling phase, clearing every score so a stale number
   * can't silently sort somebody wrong, then throws for the foes and
   * writes each total the same way a hand-typed score would — a proposal
   * into `POST /api/turn {op:'score'}`, one drag from being overruled.
   *
   * It reads the `initiative` record for which skill decides it and the
   * `dice` record for how this system's dice read, so a different system
   * changes a row, not this file.
   *
   * Deliberately does NOT touch `dice.banks` (Ace → Aces): banking an
   * Ace onto a counter is a player-facing beat at the table, and a foe
   * rolled by teller has nobody to hand that beat to.
   */
  const rollInitiative = async () => {
    setRollingFoes(true);
    try {
      const fresh = await api<TurnState>('/api/turn', { body: { op: 'rolling', on: true } });
      const field = initiative.data?.field?.toLowerCase();
      if (dice.data && field) {
        for (const entry of fresh.order) {
          if (!entry.entityId || roles.get(entry.entityId) !== 'foe') continue;
          const foe = sheetOf(entry.entityId) ?? (await api<Entity>(`/api/entities/${entry.entityId}?resolved=1`));
          const skill = (foe.lists?.skills ?? []).find((s) => s.name.toLowerCase() === field);
          if (!skill || typeof skill.value !== 'string') continue;
          const faces = rollPool(skill.value, dice.data);
          const { total } = tallyFaces(faces, dice.data);
          await api('/api/turn', { body: { op: 'score', entryId: entry.id, score: total } });
        }
      }
      turn.reload();
    } finally {
      setRollingFoes(false);
    }
  };

  const acting = turn.data?.turn !== null && turn.data ? order[turn.data.turn!] : undefined;
  const actingSheet = sheetOf(acting?.entityId);

  // ------------------------------------------------------------- the order

  const rosterRow = (entry: TurnEntry, i: number) => {
    const sheet = sheetOf(entry.entityId);
    const vital = vitalOf(sheet);
    const isTurn = turn.data?.turn === i;
    const foe = entry.entityId ? roles.get(entry.entityId) === 'foe' : false;
    const label = entry.label ?? (entry.entityId && names.get(entry.entityId)) ?? '?';
    // Mid-roll, the LIST is the status board: a row still owed a number
    // says so on the row, not in a sentence above it.
    const owed = rolling && entry.score == null;
    const seat = entry.entityId ? seats.get(entry.entityId) : undefined;
    const accent = sheet?.type ? accents.data?.[sheet.type] : undefined;

    return (
      <li
        key={entry.id}
        className={`group border-l-2 py-1.5 pl-2 pr-1.5 transition-colors ${
          owed
            ? 'border-l-amber-500 bg-stone-900'
            : isTurn
              ? 'border-l-amber-600 bg-amber-950/40'
              : foe
                ? 'border-l-red-900/70 bg-stone-900/40 hover:bg-stone-900'
                : 'border-l-stone-700 bg-stone-900/40 hover:bg-stone-900'
        }`}
        style={!isTurn && !owed && !foe && accent ? { borderLeftColor: accent } : undefined}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`w-4 shrink-0 text-right font-mono text-[10px] ${
              isTurn ? 'text-amber-300' : 'text-stone-600'
            }`}
          >
            {i + 1}
          </span>

          {/* During rolls the score sits where the position number is:
              it's the thing you're scanning for. */}
          {rolling &&
            (owed ? (
              <>
                <span
                  className="animate-pulse rounded bg-amber-700 px-1 py-0.5 font-mono text-[9px] font-semibold text-stone-950"
                  title="hasn't rolled yet"
                >
                  ROLL
                </span>
                <input
                  className="w-10 rounded bg-stone-800 px-1 py-0.5 text-center font-mono text-[11px] text-stone-100 focus:outline-none"
                  inputMode="numeric"
                  placeholder="—"
                  aria-label={`${label} rolled`}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const n = Number(e.currentTarget.value.trim());
                    if (!Number.isFinite(n)) return;
                    op({ op: 'score', entryId: entry.id, score: n });
                  }}
                />
              </>
            ) : (
              <span className="rounded bg-stone-800 px-1 py-0.5 font-mono text-[10px] text-amber-300">
                {entry.score}
              </span>
            ))}

          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${
              isTurn ? 'text-amber-100' : 'text-stone-300'
            }`}
          >
            {label}
          </span>

          {/* Somebody is sitting in front of this one, and whether their
              screen is still talking to us. */}
          {seat && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: isLive(seat) ? seat.color || '#34d399' : '#44403c' }}
              title={isLive(seat) ? 'seated, live' : 'seated, not answering'}
            />
          )}

          {/* Conditions, as colour. The chips live on the stage. */}
          {(sheet?.lists.conditions ?? []).length > 0 && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400"
              title={(sheet?.lists.conditions ?? [])
                .map((c) => (c.value === undefined ? c.name : `${c.name} ${c.value}`))
                .join(', ')}
            />
          )}

          {/* The edit you make most often is to somebody ELSE'S health,
              on the turn of the thing that just hit them. */}
          {vital && entry.entityId && (
            <span
              className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
                isTurn ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
              }`}
            >
              <button
                className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                aria-label={`${vital.name} down`}
                onClick={() =>
                  writeEntry(entry.entityId!, {
                    list: 'resources',
                    name: vital.name,
                    value: Math.max(0, (typeof vital.value === 'number' ? vital.value : 0) - 1),
                  })
                }
              >
                −
              </button>
              <span className="min-w-9 text-center font-mono text-[11px] text-stone-300">
                {typeof vital.value === 'number' ? vital.value : 0}
                {typeof vital.max === 'number' && (
                  <span className="text-stone-600">/{vital.max}</span>
                )}
              </span>
              <button
                className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                aria-label={`${vital.name} up`}
                onClick={() =>
                  writeEntry(entry.entityId!, {
                    list: 'resources',
                    name: vital.name,
                    value: Math.min(
                      typeof vital.max === 'number' ? vital.max : Number.MAX_SAFE_INTEGER,
                      (typeof vital.value === 'number' ? vital.value : 0) + 1,
                    ),
                  })
                }
              >
                +
              </button>
            </span>
          )}

          {/* The rare row actions — reorder, remove — ride along on hover
              rather than crowding a row you read eight of at a glance.
              HIDDEN rather than transparent, unlike the steppers: a
              stepper reserves its space so the number it edits doesn't
              jump under the hand, and these have no such number. Held
              transparent they cost 3rem of every name, and a column of
              "Bark Wa…" is what the sidebar is for reading. */}
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-30"
              disabled={i === 0}
              title="earlier in the order"
              onClick={() => op({ op: 'set', order: move(order, i, i - 1) })}
            >
              ▲
            </button>
            <button
              className="rounded px-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-100 disabled:opacity-30"
              disabled={i === order.length - 1}
              title="later in the order"
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

        {vital && <VitalBar entry={vital} className="mt-1.5" />}
      </li>
    );
  };

  const setupTools = (
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
  );

  const turnControls = (
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
  );

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

        {/* Taking rolls. Players roll real dice and report on their own
            seat; teller has already rolled for anything it deployed. */}
        {order.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
            {rolling ? (
              <>
                <span className="font-mono text-xs text-amber-300">taking rolls</span>
                <span
                  className={`font-mono text-[11px] ${
                    order.some((e) => e.score == null) ? 'text-stone-400' : 'text-emerald-400'
                  }`}
                >
                  {order.filter((e) => e.score == null).length
                    ? `${order.filter((e) => e.score == null).length} still to roll`
                    : 'everyone is in'}
                </span>
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
                  className={`${btn} ml-auto text-xs`}
                  disabled={rollingFoes}
                  title={`clear every score, ask each seat for a fresh roll, and throw ${initiative.data?.field ?? 'initiative'} for the foes — you can still overrule any of it`}
                  onClick={rollInitiative}
                >
                  {rollingFoes ? 'rolling…' : 'roll initiative'}
                </button>
              </>
            )}
            {!rolling && unrolledFoes.length > 0 && (
              <span className="font-mono text-[10px] text-stone-700">
                {unrolledFoes.length} foe{unrolledFoes.length === 1 ? '' : 's'} unrolled
              </span>
            )}
          </div>
        )}

        <div className="grid items-start gap-4 @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            {order.length > 0 ? (
              <ol className="divide-y divide-stone-800/60 overflow-hidden rounded-lg">
                {order.map(rosterRow)}
              </ol>
            ) : (
              <p className="rounded-lg border border-dashed border-stone-800 px-3 py-6 text-center text-[11px] text-stone-600">
                the turn order builds here
              </p>
            )}

            {/* While a fight runs, setup is one line until asked for. */}
            {running ? (
              <div>
                <button
                  className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-stone-600 transition-colors hover:bg-stone-900 hover:text-stone-300"
                  onClick={() => setSetupOpen((v) => !v)}
                >
                  {setupOpen ? '▾' : '＋'} add to the fight
                </button>
                {setupOpen && <div className="mt-2">{setupTools}</div>}
              </div>
            ) : (
              setupTools
            )}
          </div>

          <div className="space-y-3">
            {running && acting && actingSheet ? (
              <>
                <TurnStage
                  key={actingSheet.id}
                  acting={actingSheet}
                  index={turn.data!.turn!}
                  total={order.length}
                  round={turn.data!.round}
                  statuses={statuses.data ?? []}
                  accent={actingSheet.type ? accents.data?.[actingSheet.type] : undefined}
                  onWrite={(edit) => writeEntry(actingSheet.id, edit)}
                  armed={armed}
                  onArm={setArmed}
                  order={order
                    .filter((e) => e.entityId)
                    .map((e) => ({
                      id: e.entityId!,
                      label: e.label ?? names.get(e.entityId!) ?? '?',
                    }))}
                  sheetOf={(id) => sheets.data?.[id]}
                  dice={dice.data}
                  icons={icons.data}
                  pins={pins.data}
                  conditionsList={CONDITIONS}
                  conditionCap={conditionCap}
                  costCounter={use.data?.costCounter}
                  onWriteTo={writeEntry}
                />
                {/* A player's turn gets no proposal, and the stage says
                    why rather than going blank. teller does not play
                    player characters. */}
                {actingSheet.type !== 'foe' && (
                  <p className="px-1 text-[12px] italic text-stone-600">
                    {actingSheet.name} plays themselves.
                  </p>
                )}
              </>
            ) : running && acting ? (
              <p className="text-sm text-stone-600">
                {acting.label ?? 'unlabeled'} is up — an ad-hoc entry, so there's no sheet to show.
              </p>
            ) : running ? (
              <p className="text-sm text-stone-600">no one is up</p>
            ) : (
              <p className="text-sm text-stone-600">
                not running — start combat to open the stage
              </p>
            )}

            {turnControls}

            {/*
              The slot. This file names a POINT and nothing else: with no
              plugin providing it, nothing below renders — no button, no
              box, no nag (rule 7's posture, §15's contract). What comes
              back is words on the Warden's screen; playing any of it is
              the Warden's act (rule 1).
            */}
            {running && acting && actingSheet?.type === 'foe' && (
              <ProviderSlot
                point="propose.turn"
                ask="what would they do?"
                placeholder="…or tell it what they do, and press enter"
                // Arming something IS a decision, so it goes over as the
                // thing to work around rather than a hint — the old app's
                // own move ("if I want to just say that I think it would
                // use the frenzy attack now because I decided, but I
                // still want the rest"). The flow above never reads this
                // back: with no plugin there is no box, and the exchange
                // runs exactly the same.
                payload={() =>
                  armed
                    ? { intent: [armed.name, armed.note].filter(Boolean).join(' — ') }
                    : {}
                }
              />
            )}
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

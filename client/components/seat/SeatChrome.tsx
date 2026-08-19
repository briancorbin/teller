// The seat's own chrome — the top bar and the segmented screen bar that
// wrap whichever entity-subject panel is showing. Ported from the old
// app's `SheetHeader` (src/components/sheet/SheetHeader.tsx) and
// `Screens` (src/components/sheet/Screens.tsx): identity lives in the
// bar at the top, and switching between the six seat layouts
// (`core/panels.ts`'s entity-subject panels) is the segmented bar at
// the bottom, exactly the shape the DM's console offered before this
// port — a seat, or a console previewing one, is never a single frozen
// arrangement.
//
// The seam from the old app: `SheetHeader` read the trade/player off
// `groups.title`/`groups.player` FIELDS and priced its chips off
// `use.costCounter`/`use.costs`. The new `Entity` gives the trade for
// free (`entity.type`) and the player is the SEAT's own identity now
// (rule 7 — a seat belongs to a person, and that person is who the DM
// named the display for), so `seatName` is preferred and the `meta`
// list's own "Player" entry (when a system still declares one) is only
// the fallback. The spend chips still come from `use` — that's the
// system's own word for what a turn costs, not a hosting-layer concept.

import { useCallback, useEffect, useState } from 'react';
import type { Entity } from '../../../core/entity.ts';
import type { PanelDef } from '../../../core/panels.ts';
import { api } from '../../lib/api.ts';
import { onNudge } from '../../lib/use-session.ts';
import { entryNamed } from '../../panels/blocks.tsx';
import { PanelSurface, type BlockCtx, type Glass } from '../../panels/render.tsx';

type Records = Record<string, Record<string, unknown>>;

const RECORD_SLOTS = ['accents', 'dials', 'brand', 'portraits', 'pins', 'use', 'groups', 'dice'];

function numberOf(entry: { value?: number | string } | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** The header's plate: who this is, and the trade as its caption. */
function Plate({
  name,
  trade,
  accent,
  mounted,
}: {
  name?: string;
  trade?: string;
  accent?: string;
  mounted: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center px-1">
      {name && (
        <span
          className={`min-w-0 font-serif text-[1.35rem] font-bold leading-tight text-stone-100 ${
            mounted ? 'max-w-full truncate' : 'break-words text-center'
          }`}
        >
          {name}
        </span>
      )}
      {trade && (
        <span
          className="whitespace-nowrap text-[0.7rem] uppercase leading-tight tracking-[0.18em]"
          style={{ color: accent ?? '#f59e0b' }}
        >
          The {trade}
        </span>
      )}
    </span>
  );
}

function CostChip({
  name,
  value,
  face,
  accent,
  onSet,
}: {
  name: string;
  value: number;
  face?: string;
  accent: string;
  onSet: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${name}: ${value}`}
        aria-expanded={open}
        className="flex items-center gap-1.5"
      >
        <span className="text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">{name}</span>
        {face === 'cards' ? (
          <span className="flex h-8 w-6 items-center justify-center rounded-[4px] border border-stone-400 bg-[#f4efe4] font-mono text-sm font-bold text-stone-900">
            {value}
          </span>
        ) : (
          <span
            className={`flex h-7 min-w-[2.6rem] items-center justify-center border font-mono text-sm text-stone-100 ${
              face === 'cylinder'
                ? 'rounded-l-sm rounded-r-full border-l-2 pl-1.5 pr-2.5'
                : 'rounded-full px-2.5'
            }`}
            style={{ borderColor: accent, background: `${accent}1f` }}
          >
            {value}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-1 rounded-lg border border-stone-700 bg-stone-950 p-1 shadow-lg">
          <button
            type="button"
            aria-label={`decrease ${name}`}
            onClick={() => onSet(Math.max(0, value - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-800 font-mono text-lg text-stone-100 hover:bg-stone-700"
          >
            −
          </button>
          <span className="min-w-[2rem] text-center font-mono text-sm text-stone-100">{value}</span>
          <button
            type="button"
            aria-label={`increase ${name}`}
            onClick={() => onSet(value + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-800 font-mono text-lg text-stone-100 hover:bg-stone-700"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({
  entity,
  seatName,
  records,
  mounted,
  onWrite,
}: {
  entity?: Entity;
  seatName?: string;
  records: Records;
  mounted: boolean;
  onWrite?: (edit: Record<string, unknown>) => void;
}) {
  const accent = entity?.type
    ? ((records.accents?.[entity.type] as string | undefined) ?? '#f59e0b')
    : '#f59e0b';
  const player = seatName?.trim() || entryNamed(entity, 'player')?.value?.toString().trim();
  const use = records.use as
    | { costCounter?: string; costs?: { counter: string }[] }
    | undefined;
  const dials = records.dials as Record<string, string> | undefined;
  const costNames = [
    ...(use?.costCounter ? [use.costCounter] : []),
    ...(use?.costs ?? []).map((c) => c.counter),
  ].filter((n, i, a) => a.indexOf(n) === i);
  const chips = costNames.flatMap((n) => {
    const entry = entryNamed(entity, n);
    if (!entry) return [];
    return [
      <CostChip
        key={n}
        name={n}
        value={numberOf(entry)}
        face={dials?.[n]}
        accent={accent}
        onSet={(v) => onWrite?.({ list: 'resources', name: n, value: v })}
      />,
    ];
  });

  if (!entity && !player) return null;

  if (!mounted) {
    return (
      <div
        className="flex shrink-0 flex-col gap-1.5 rounded-md border px-3 py-1.5"
        style={{ borderColor: `${accent}66` }}
      >
        <div className="flex items-center gap-2.5">
          <span className="h-px flex-1" style={{ background: `${accent}55` }} />
          <Plate name={entity?.name} trade={entity?.type} accent={accent} mounted={mounted} />
          <span className="h-px flex-1" style={{ background: `${accent}55` }} />
        </div>
        {(player || chips.length > 0) && (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
              {player}
            </span>
            <div className="flex shrink-0 items-center gap-3">{chips}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 rounded-md border px-3 py-1.5"
      style={{ borderColor: `${accent}66` }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {player && (
          <span className="min-w-0 truncate text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
            {player}
          </span>
        )}
        <span className="h-px flex-1" style={{ background: `${accent}55` }} />
      </div>

      <Plate name={entity?.name} trade={entity?.type} accent={accent} mounted={mounted} />

      <div className="flex min-w-0 items-center gap-3">
        <span className="h-px flex-1" style={{ background: `${accent}55` }} />
        {chips}
      </div>
    </div>
  );
}

/** The segmented bar — one button per declared entity layout. Ported
 * from `Screens` (src/components/sheet/Screens.tsx), minus the icon
 * collapse: these six tabs never existed as an old-app `Screens` bar
 * (they were a per-DISPLAY assignment, chosen from the console), so
 * there's no historical glyph mapping to port for them — plain words. */
function TabBar({
  panels,
  current,
  onGo,
}: {
  panels: PanelDef[];
  current: string;
  onGo: (name: string) => void;
}) {
  if (panels.length <= 1) return null;
  return (
    <nav
      aria-label="screens"
      className="flex shrink-0 gap-1 rounded-lg bg-stone-950/85 p-1 backdrop-blur-sm"
    >
      {panels.map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={() => onGo(p.name)}
          aria-current={p.name === current}
          className={`flex-1 rounded-md px-2 py-1.5 text-[0.7rem] uppercase tracking-[0.18em] transition-colors ${
            p.name === current
              ? 'text-stone-950'
              : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
          }`}
          style={p.name === current ? { background: 'var(--sheet-accent, #f59e0b)' } : undefined}
        >
          {p.label ?? p.name}
        </button>
      ))}
    </nav>
  );
}

export function SeatChrome({
  entityId,
  initialPanel,
  seatName,
  glass,
}: {
  entityId: string;
  initialPanel: string;
  seatName?: string;
  glass: Glass;
}) {
  const [panels, setPanels] = useState<PanelDef[] | undefined>(undefined);
  const [records, setRecords] = useState<Records>({});
  const [entity, setEntity] = useState<Entity | undefined>(undefined);
  const [current, setCurrent] = useState(initialPanel);

  const load = useCallback(() => {
    api<PanelDef[]>('/api/stack/declarations/panels').then(setPanels).catch(() => setPanels([]));
    Promise.all(
      RECORD_SLOTS.map((slot) =>
        api<Record<string, unknown>>(`/api/stack/record/${slot}`).then((r) => [slot, r] as const),
      ),
    )
      .then((pairs) => setRecords(Object.fromEntries(pairs)))
      .catch(() => {});
    api<Entity>(`/api/entities/${entityId}?resolved=1`)
      .then(setEntity)
      .catch(() => setEntity(undefined));
  }, [entityId]);

  useEffect(load, [load]);
  useEffect(() => onNudge(load), [load]);

  const screens = (panels ?? []).filter((p) => p.subject === 'entity');
  const panel = screens.find((p) => p.name === current) ?? screens[0];

  const ctx: BlockCtx = {
    glass,
    entity,
    records,
    write: (edit) => api(`/api/entities/${entityId}/entry`, { body: edit }).then(() => {}),
  };

  return (
    <div
      className={`flex min-h-0 flex-col gap-2 ${glass === 'mounted' ? 'h-full' : 'min-h-full'}`}
    >
      <TopBar
        entity={entity}
        seatName={seatName}
        records={records}
        mounted={glass === 'mounted'}
        onWrite={ctx.write ? (edit) => ctx.write!(edit) : undefined}
      />

      <div className={`flex min-h-0 flex-1 flex-col ${glass === 'mounted' ? 'overflow-hidden' : ''}`}>
        {panel ? (
          <PanelSurface
            panel={panel}
            ctx={ctx}
            fallback={
              <p className="p-8 text-sm text-stone-500">
                '{panel.name}' failed to render — the floor has it
              </p>
            }
          />
        ) : (
          <p className="p-8 text-sm text-stone-500">no seat layout declared</p>
        )}
      </div>

      {/* Sticky only where the card scrolls — held glass. Mounted glass
          never scrolls (rule 6), so there is nothing for the bar to
          stick to. */}
      <div className={`z-10 shrink-0 ${glass === 'mounted' ? '' : 'sticky bottom-0'}`}>
        <TabBar panels={screens} current={panel?.name ?? current} onGo={setCurrent} />
      </div>
    </div>
  );
}

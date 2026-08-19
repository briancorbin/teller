// The 'log' tool — everything that happened, newest first (rule 3:
// "what doesn't exist yet is a *readable* combat log or history for the
// DM (TEL-5) — the data is there, nothing renders it"). No old-app
// equivalent to port; built in the old app's own card/section grammar
// (`sectionLabel`, `card`, gap-4 rhythm, font-mono numbers) so it reads
// like it always belonged there — a table of rows, actor + kind + a
// terse line, timestamp trailing in mono. `GET /api/events` already
// returns everything a DM needs; this is a floor over it, not a story.

import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { card, input, sectionLabel } from '../lib/ui.ts';
import { Refusal } from '../panels/render.tsx';
import { registerTool } from './index.ts';

type EventRow = {
  id: number;
  entityId: string | null;
  actor: string;
  kind: string;
  payload: unknown;
  createdAt: string;
};

type RosterEntry = { id: string; name: string; type: string | null };

type EntitySnapshot = { name?: string; lists?: Record<string, { name: string; value?: unknown }[]> };

/** The first entry whose value actually moved, between two snapshots of
 * the same entity — `entity.updated`'s payload carries the whole
 * before/after, and most edits touch exactly one entry (rule 1: a
 * stored value changed, so say which one). */
function firstChange(before?: EntitySnapshot, after?: EntitySnapshot): string | undefined {
  if (!before?.lists || !after?.lists) return undefined;
  for (const [list, afterEntries] of Object.entries(after.lists)) {
    const beforeEntries = before.lists[list] ?? [];
    for (const entry of afterEntries) {
      const was = beforeEntries.find((b) => b.name === entry.name);
      if (!was) return `${entry.name} added`;
      if (was.value !== entry.value) return `${entry.name} ${String(was.value)} → ${String(entry.value)}`;
    }
    for (const was of beforeEntries) {
      if (!afterEntries.some((a) => a.name === was.name)) return `${was.name} removed`;
    }
  }
  return undefined;
}

/** Kind → a human, mono-friendly summary of what happened (core/store.ts's `append` calls). */
function describe(e: EventRow, names: Map<string, string>): string {
  const who = e.entityId ? (names.get(e.entityId) ?? e.entityId) : null;
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'entity.created':
      return `${(p.after as EntitySnapshot | undefined)?.name ?? who ?? 'something'} was created`;
    case 'entity.updated': {
      const diff = firstChange(p.before as EntitySnapshot, p.after as EntitySnapshot);
      return `${who ?? (p.after as EntitySnapshot | undefined)?.name ?? 'an entity'}${diff ? ` — ${diff}` : ' was edited'}`;
    }
    case 'entity.deleted':
      return `${(p.before as EntitySnapshot | undefined)?.name ?? who ?? 'an entity'} was deleted`;
    case 'entity.moved':
      return `${who ?? 'an entity'} moved to ${String(p.to ?? '?')}`;
    case 'template.updated':
      return `template — ${String(p.slot ?? '?')}`;
    case 'template.deleted':
      return `template removed`;
    case 'board.updated':
      return `board updated`;
    case 'board.cleared':
      return `board cleared`;
    case 'turn.updated':
      return p.op ? `turn: ${String(p.op)}` : 'turn order changed';
    case 'campaign.created':
      return `campaign created — ${String(p.name ?? '?')}`;
    default:
      return who ? `${who} — ${e.kind}` : e.kind;
  }
}

function when(createdAt: string): string {
  const ms = Date.parse(createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z'));
  if (!Number.isFinite(ms)) return createdAt;
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

function LogTool() {
  const [entityId, setEntityId] = useState('');
  const events = useLive(
    () =>
      api<EventRow[]>(
        `/api/events?limit=200${entityId ? `&entity=${encodeURIComponent(entityId)}` : ''}`,
      ),
    [entityId],
  );
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), []);
  const names = new Map((roster.data ?? []).map((e) => [e.id, e.name]));

  const rows = events.data ?? [];

  return (
    <div className="space-y-3">
      <div className={`${card} flex flex-wrap items-center gap-2`}>
        <span className={sectionLabel}>Log</span>
        <select
          className={`${input} ml-auto`}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          aria-label="filter by entity"
        >
          <option value="">everyone</option>
          {(roster.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {events.error && (
        <p className="text-sm text-red-400">{events.error.message}</p>
      )}

      {rows.length === 0 && !events.error && (
        <Refusal>nothing has happened yet</Refusal>
      )}

      {rows.length > 0 && (
        <ol className={`${card} divide-y divide-stone-800/70 p-0`}>
          {rows.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
              <span className="w-16 shrink-0 truncate font-mono text-[10px] uppercase tracking-wider text-stone-600">
                {e.kind.split('.')[0]}
              </span>
              <span className="min-w-0 flex-1 truncate text-stone-300">
                {describe(e, names)}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-stone-600">
                {e.actor}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[11px] text-stone-600">
                {when(e.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

registerTool('log', () => <LogTool />);

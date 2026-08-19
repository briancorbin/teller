// The 'screens' tool — every screen in the room, and what each one is.
// Ported grammar from the old app's DisplaysPanel
// (src/components/DisplaysPanel.tsx): an "add a screen" card with the
// pairing-code box, one card per adopted screen with a live dot, a
// rename field, identify/forget, and a row of role/assignment selects
// with the colour swatches pinned to the right.
//
// Trimmed for this host (single campaign, no `campaignId` on a
// `Display` — core-next serves one table): no "on another campaign" /
// "bring here" section, since there's nowhere else for a screen to be.
// Also left out: the calibration wizard and pretend-glass sizing
// (`ppi`/`glass` params exist on the type but nothing here sets them —
// noted as a gap) and the guided "saddle up from a trade" stamp flow
// (`encounters`/`roster` own character creation; a seat here just
// points at whoever the roster already has).

import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';
import { registerTool } from './index.ts';

// Mirrors `Display`/`DisplayRole` (core/store.ts) — not imported, same
// reasoning as `runner.tsx`'s local `TurnState`: the server module isn't
// otherwise part of the client's graph.
type DisplayRole = 'console' | 'table' | 'board' | 'art' | 'seat' | 'badge' | 'blank';

type Display = {
  id: string;
  name?: string;
  color?: string;
  role: DisplayRole;
  params: Record<string, unknown>;
  code?: string;
  position?: number;
  lastSeenAt?: string;
};

type PanelDecl = { name: string; label?: string; subject?: 'entity' | 'none' };
type RosterEntry = { id: string; name: string; type: string | null };

const ROLES: { value: DisplayRole; label: string; needsEntity?: boolean }[] = [
  { value: 'blank', label: 'blank' },
  { value: 'table', label: 'table' },
  { value: 'board', label: 'board' },
  { value: 'art', label: 'art' },
  { value: 'badge', label: 'badge', needsEntity: true },
  { value: 'seat', label: 'seat', needsEntity: true },
  { value: 'console', label: 'console' },
];

const COLORS = ['#f59e0b', '#38bdf8', '#a3e635', '#f472b6', '#c084fc', '#fb7185'];
const SLOT_SUGGESTIONS = ['tv', 'board', 'art', 'seat'];

/** A screen is "live" if it has spoken to us lately. */
function isLive(display: Display): boolean {
  if (!display.lastSeenAt) return false;
  // The new store writes real ISO strings; the massage below is only
  // for the old worker's SQLite spelling ("YYYY-MM-DD HH:MM:SS") and
  // appending 'Z' to an ISO string made every screen read dead (…ZZ).
  const raw = display.lastSeenAt;
  const seen = Date.parse(
    raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z',
  );
  return Number.isFinite(seen) && Date.now() - seen < 60_000;
}

function ScreensTool() {
  const displays = useLive(() => api<Display[]>('/api/displays'), []);
  const panels = useLive(() => api<PanelDecl[]>('/api/stack/declarations/panels'), []);
  const roster = useLive(() => api<RosterEntry[]>('/api/entities'), []);

  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  // Only ADOPTED screens get a card. An unclaimed screen is showing its
  // code across the room and the adopt box above is how it arrives
  // (rule 6: the screen shows the code, the DM types it) — listing the
  // waiting ones just mirrors every open tab back at the console. A dim
  // count keeps them discoverable without giving them furniture.
  const all = displays.data ?? [];
  // The DM's own order (position, assigned at adoption, moved by the
  // arrows) — never by who spoke last: a row must not leap out from
  // under the hand about to touch it. Id breaks ties for stability.
  const list = all
    .filter((d) => !d.code)
    .sort(
      (a, b) =>
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );
  const waiting = all.length - list.length;

  /**
   * Move a row and REINDEX the whole room, 1..n. Swapping raw values
   * broke on rows adopted before ordering existed (their missing
   * position could collide with a neighbor's real one and the swap
   * became a no-op) — writing every row its own index is idempotent,
   * and heals the legacy rows the first time anything moves.
   */
  const nudgeRow = (index: number, delta: -1 | 1) => {
    if (!list[index] || !list[index + delta]) return;
    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    Promise.all(
      next.map((d, i) =>
        d.position === i + 1
          ? Promise.resolve()
          : api(`/api/displays/${d.id}`, {
              method: 'PATCH',
              body: { position: i + 1 },
            }),
      ),
    )
      .then(displays.reload)
      .catch(displays.reload);
  };
  const panes = (panels.data ?? []).filter((p) => p.subject !== 'entity');
  const layouts = (panels.data ?? []).filter((p) => p.subject === 'entity');
  // core-next has no reliable PC/NPC signal left on an entity (rule 2 —
  // `type` is free text, a trade name here, and often absent on a fresh
  // character). The old app could restrict this to `kind === 'pc'`;
  // this can't, so a seat or badge picks from everyone, sorted by name —
  // a DM finding the wrong name in a short list beats a right name
  // that never appears because a guessed filter excluded it.
  const party = [...(roster.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  const claim = () => {
    if (!code.trim()) return;
    api<Display>('/api/displays/claim', { body: { code: code.trim() } })
      .then(() => {
        setCode('');
        setError('');
        displays.reload();
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  };

  const patch = (id: string, body: Record<string, unknown>) => {
    api(`/api/displays/${id}`, { method: 'PATCH', body }).then(displays.reload).catch(displays.reload);
  };

  return (
    <div className="space-y-3">
      <section className={`${card} space-y-2`}>
        <span className={sectionLabel}>Add a screen</span>
        <p className="text-sm text-stone-500">
          Open teller on it — phone, tablet, panel, TV — and type the code it's showing.
        </p>
        <div className="flex gap-2">
          <input
            className={`${input} flex-1 font-mono uppercase tracking-widest`}
            placeholder="K7RM4P"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && claim()}
          />
          <button className={btnPrimary} onClick={claim}>
            adopt
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-sm text-stone-500">
          <span>No spare device? Open one on this machine:</span>
          {SLOT_SUGGESTIONS.map((slot) => (
            <a
              key={slot}
              className="rounded-full bg-stone-900 px-2 py-0.5 font-mono text-xs text-stone-300 transition-colors hover:bg-stone-800 hover:text-stone-100"
              href={`/#${slot}`}
              target="_blank"
              rel="noreferrer"
            >
              #{slot}
            </a>
          ))}
          <span className="text-stone-600">— any name works, and each one is its own screen</span>
        </div>
        {waiting > 0 && (
          <p className="mt-2 text-xs text-stone-600">
            {waiting} screen{waiting === 1 ? '' : 's'} showing a code, waiting to be adopted
          </p>
        )}
      </section>

      {list.map((d, i) => {
        const role = ROLES.find((r) => r.value === d.role);
        const params = d.params ?? {};
        return (
          <section key={d.id} className={`${card} space-y-2`}>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: isLive(d) ? d.color || '#f59e0b' : '#44403c' }}
                title={isLive(d) ? 'live' : d.lastSeenAt ? `last seen ${d.lastSeenAt}` : 'never seen'}
              />
              <input
                className={`${input} min-w-0 flex-1`}
                defaultValue={d.name}
                aria-label="screen name"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== d.name) patch(d.id, { name });
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <button
                className="rounded-md px-1.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200 disabled:opacity-30"
                title="move up"
                disabled={i === 0}
                onClick={() => nudgeRow(i, -1)}
              >
                ▲
              </button>
              <button
                className="rounded-md px-1.5 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200 disabled:opacity-30"
                title="move down"
                disabled={i === list.length - 1}
                onClick={() => nudgeRow(i, 1)}
              >
                ▼
              </button>
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
                title="flash this screen so you can tell which one it is"
                onClick={() => api(`/api/displays/${d.id}/identify`, { method: 'POST' })}
              >
                identify
              </button>
              <button
                className="rounded-md px-2 py-1 text-sm text-stone-600 transition-colors hover:bg-red-950 hover:text-red-300"
                title="forget this screen"
                onClick={() => {
                  if (!window.confirm(`Forget "${d.name ?? 'this screen'}"? It'll show a new code.`))
                    return;
                  api(`/api/displays/${d.id}`, { method: 'DELETE' }).then(displays.reload);
                }}
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className={input}
                value={d.role}
                onChange={(e) => patch(d.id, { role: e.target.value as DisplayRole })}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              {role?.needsEntity && (
                <select
                  className={input}
                  value={typeof params.entityId === 'string' ? params.entityId : ''}
                  onChange={(e) =>
                    patch(d.id, { params: { ...params, entityId: e.target.value || null } })
                  }
                >
                  <option value="">— whose? —</option>
                  {party.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              )}

              {d.role === 'seat' && (
                <select
                  className={input}
                  value={typeof params.layout === 'string' ? params.layout : 'sheet'}
                  aria-label="how this seat arranges its card"
                  onChange={(e) => patch(d.id, { params: { ...params, layout: e.target.value } })}
                >
                  {(layouts.length ? layouts : [{ name: 'sheet', label: 'Sheet' }]).map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label ?? p.name}
                    </option>
                  ))}
                </select>
              )}

              {d.role === 'console' && (
                <select
                  className={input}
                  value={typeof params.pane === 'string' ? params.pane : ''}
                  onChange={(e) =>
                    patch(d.id, { params: { ...params, pane: e.target.value || null } })
                  }
                >
                  <option value="">full console</option>
                  {panes.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.label ?? p.name}
                    </option>
                  ))}
                </select>
              )}

              <span className="ml-auto flex gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`h-5 w-5 rounded-full transition-transform ${
                      d.color === c ? 'scale-110 ring-2 ring-stone-300' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    title="identify colour"
                    onClick={() => patch(d.id, { color: c })}
                  />
                ))}
              </span>
            </div>
          </section>
        );
      })}

      {list.length === 0 && <p className="px-1 text-sm text-stone-500">No screens yet.</p>}
    </div>
  );
}

registerTool('screens', () => <ScreensTool />);

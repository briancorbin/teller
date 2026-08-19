// The 'boards' tool — battlemap assets, ported in the old app's card/
// list grammar (src/views/DmView.tsx). The vanilla client
// (`server/public/app.js`) links each board to a separate `#board=`
// route with its own placements table; the new client has no such
// route to link to, so this tool folds board picker + placements table
// into one card, matching the vanilla `boardView`'s functionality (who,
// u, v, remove) without reaching for the full battlemap editor —
// SceneEditor's fog/grid/token authoring is out of scope here.

import { useState } from 'react';
import { registerTool } from './index.ts';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui.ts';

type BoardMeta = { id: string; name: string };
type RosterRow = { id: string; name: string; type?: string };
type Placement = { entityId?: string; label?: string; u: number; v: number; sizeInches?: number };
type BoardState = { placements?: Placement[] } & Record<string, unknown>;

function whoOf(p: Placement, names: Map<string, string>): string {
  if (p.label) return p.label;
  if (p.entityId) return names.get(p.entityId) ?? `missing: ${p.entityId}`;
  return '?';
}

function BoardsTool() {
  const { data: boards } = useLive(() => api<BoardMeta[]>('/api/boards'), []);
  const { data: roster } = useLive(() => api<RosterRow[]>('/api/entities'), []);
  const [selected, setSelected] = useState<string | null>(null);

  const { data: state, reload } = useLive(
    () => (selected ? api<BoardState | null>(`/api/board-state/${selected}`) : Promise.resolve(null)),
    [selected],
  );

  const [entityId, setEntityId] = useState('');
  const [label, setLabel] = useState('');
  const [u, setU] = useState('0');
  const [v, setV] = useState('0');
  const [size, setSize] = useState('1');

  if (!boards || !roster) return null;

  const board = boards.find((b) => b.id === selected);
  const placements = state?.placements ?? [];
  const names = new Map(roster.map((r) => [r.id, r.name]));

  const save = async (next: Placement[]) => {
    if (!selected) return;
    await api(`/api/board-state/${selected}`, {
      method: 'PUT',
      body: { data: { ...(state ?? {}), placements: next } },
    });
    reload();
  };

  const addPlacement = () => {
    const placement: Placement = {
      u: Number(u) || 0,
      v: Number(v) || 0,
      sizeInches: Number(size) || 1,
    };
    if (entityId) placement.entityId = entityId;
    else if (label.trim()) placement.label = label.trim();
    else return;
    save([...placements, placement]);
    setLabel('');
    setEntityId('');
  };

  return (
    <div className="space-y-3">
      <section className={`${card} space-y-2`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Boards</span>
          <span className="font-mono text-[11px] text-stone-600">{boards.length}</span>
        </div>
        {boards.length === 0 && <p className="text-sm text-stone-600">no boards on the shelf</p>}
        <ul className="space-y-1">
          {boards.map((b) => (
            <li key={b.id}>
              <button
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  selected === b.id
                    ? 'bg-stone-800 text-stone-50'
                    : 'bg-stone-900 text-stone-200 hover:bg-stone-800'
                }`}
                onClick={() => setSelected(b.id)}
              >
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {board && (
        <section className={`${card} space-y-3`}>
          <div className="flex items-center justify-between">
            <span className={sectionLabel}>{board.name} — placements</span>
            <span className="font-mono text-[11px] text-stone-600">{placements.length}</span>
          </div>

          <ul className="space-y-1">
            {placements.map((p, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100" title={p.entityId ?? ''}>
                  {whoOf(p, names)}
                </span>
                <span className="font-mono text-[11px] text-stone-600">
                  u{p.u} v{p.v}
                </span>
                <button
                  className={`${btnGhost} hover:text-red-300`}
                  onClick={() => save(placements.filter((_, j) => j !== i))}
                  aria-label={`remove ${whoOf(p, names)}`}
                >
                  ✕
                </button>
              </li>
            ))}
            {placements.length === 0 && (
              <li className="text-sm text-stone-600">nothing placed yet</li>
            )}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${input} min-w-0 flex-1 text-xs`}
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                if (e.target.value) setLabel('');
              }}
            >
              <option value="">a label instead…</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <input
              className={`${input} w-32 text-xs`}
              placeholder="or a label"
              value={label}
              disabled={!!entityId}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              className={`${input} w-14 text-right font-mono`}
              placeholder="u"
              value={u}
              onChange={(e) => setU(e.target.value)}
              aria-label="u"
            />
            <input
              className={`${input} w-14 text-right font-mono`}
              placeholder="v"
              value={v}
              onChange={(e) => setV(e.target.value)}
              aria-label="v"
            />
            <input
              className={`${input} w-14 text-right font-mono`}
              placeholder="in"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              aria-label="size, inches"
            />
            <button className={btn} disabled={!entityId && !label.trim()} onClick={addPlacement}>
              + place
            </button>
          </div>

          <p className="text-[11px] text-stone-600">
            quick edits only — the full battlemap editor (fog, grid, tokens) isn't ported here.
          </p>
        </section>
      )}
    </div>
  );
}

registerTool('boards', () => <BoardsTool />);

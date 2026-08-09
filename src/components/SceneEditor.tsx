import { useEffect, useRef, useState } from 'react';
import type { Scene, SceneView, Token, TokenEffect } from '../../worker/types';
import { newLocalId } from '../lib/api';
import { input } from '../lib/ui';
import { TOKEN_EFFECTS, tokenShapeStyle, zoneBase, zoneStyle } from './token-visuals';
import { TileZones } from './TileZones';

// The map workshop: a fullscreen canvas with floating tool overlays.
// Edits are LIVE (debounced PATCH) like everything else in teller —
// adjust framing, look at the table, adjust again, no save round-trip.
// An in-editor undo stack covers mistakes. docs/BATTLEMAP.md governs
// the coordinate rules; the camera here is workshop-only and never
// touches what the table shows.

const DEFAULT_VIEW: SceneView = { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 };

export const TOKEN_COLORS = [
  '#dc2626',
  '#d97706',
  '#65a30d',
  '#0d9488',
  '#2563eb',
  '#9333ea',
  '#db2777',
  '#57534e',
];

const TOKEN_SIZES = [0.5, 1, 2, 3, 4, 6, 8];
const TOKEN_SHAPES = ['circle', 'square', 'triangle'] as const;

type Tool = 'pan' | 'frame' | 'paint';
type Cell = [number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const panel =
  'rounded-2xl border border-stone-800 bg-stone-950/85 shadow-xl backdrop-blur';
const toolBtn = (on: boolean) =>
  `flex h-11 w-11 items-center justify-center rounded-xl text-lg transition-colors ${
    on ? 'bg-amber-700 text-stone-950' : 'text-stone-300 hover:bg-stone-800'
  }`;

export function SceneEditor({
  scene,
  combatRunning,
  ppi,
  tableDisplay,
  characters,
  onChange,
  onClose,
}: {
  scene: Scene;
  combatRunning: boolean;
  ppi?: number;
  tableDisplay?: { w: number; h: number };
  characters: { id: string; name: string; kind: 'pc' | 'npc' }[];
  /** Live — called on every committed edit (debounced upstream). */
  onChange: (next: Scene) => void;
  /** Omitted when the editor IS the surface (the map pane). */
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState<Scene>({
    ...scene,
    view: scene.view ?? DEFAULT_VIEW,
  });
  const [tool, setTool] = useState<Tool>('frame');
  const [brush, setBrush] = useState<TokenEffect>('fire');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showTokens, setShowTokens] = useState(false);
  const [showScene, setShowScene] = useState(false);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [camReady, setCamReady] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const undoRef = useRef<Scene[]>([]);
  const confirmedRef = useRef(false);
  const dragRef = useRef<
    | { kind: 'pan'; x: number; y: number }
    | { kind: 'token'; id: string }
    | { kind: 'frame' }
    | { kind: 'paint'; op: 'add' | 'remove'; last: string | null }
    | null
  >(null);

  const view = draft.view ?? DEFAULT_VIEW;
  const tokens = draft.tokens ?? [];
  const selected = tokens.find((t) => t.id === selectedId) ?? null;

  // --- live commit + undo ---------------------------------------------------

  // A ref mirrors the draft so successive writes inside one drag build
  // on each other instead of on a stale render closure.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commit = (next: Scene) => {
    draftRef.current = next;
    setDraft(next);
    onChange(next);
  };
  /** Local (not yet sent) edit — committed to the wire on pointer up. */
  const stage = (next: Scene) => {
    draftRef.current = next;
    setDraft(next);
  };
  /** Snapshot before a discrete operation so undo can step back. */
  const mark = () => {
    undoRef.current = [...undoRef.current.slice(-49), draftRef.current];
  };
  const undo = () => {
    const prev = undoRef.current.pop();
    if (prev) commit(prev);
  };

  // --- canvas geometry ------------------------------------------------------

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({
        w: entry.contentRect.width,
        h: entry.contentRect.height,
      }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure via ref AND onLoad: a cached image completes before React
  // attaches the load listener, so onLoad alone silently misses and the
  // whole geometry (grid, tiles, painting) never initialises.
  const measure = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth) {
      setNat((prev) =>
        prev?.w === el.naturalWidth && prev?.h === el.naturalHeight
          ? prev
          : { w: el.naturalWidth, h: el.naturalHeight },
      );
    }
  };

  const fitScale = nat && size ? Math.min(size.w / nat.w, size.h / nat.h) : null;
  const baseW = nat && fitScale ? nat.w * fitScale : 0;
  const baseH = nat && fitScale ? nat.h * fitScale : 0;

  // Center the map the first time we know its size.
  useEffect(() => {
    if (!camReady && size && baseW && baseH) {
      setCam({ x: (size.w - baseW) / 2, y: (size.h - baseH) / 2, z: 1 });
      setCamReady(true);
    }
  }, [camReady, size, baseW, baseH]);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setCam((c) => {
      const z = Math.min(8, Math.max(0.4, c.z * factor));
      const k = z / c.z;
      return { z, x: px - k * (px - c.x), y: py - k * (py - c.y) };
    });
  };

  const zoomCenter = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  const resetCam = () => {
    if (size) setCam({ x: (size.w - baseW) / 2, y: (size.h - baseH) / 2, z: 1 });
  };

  const toUv = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !baseW || !baseH) return null;
    return {
      u: clamp01((clientX - rect.left - cam.x) / cam.z / baseW),
      v: clamp01((clientY - rect.top - cam.y) / cam.z / baseH),
    };
  };

  // --- map-space grid + painting -------------------------------------------

  const cols = draft.widthInches ?? null;
  const rows = cols && nat ? cols * (nat.h / nat.w) : null;
  const cellPx = cols && baseW ? baseW / cols : null;

  const cellAt = (clientX: number, clientY: number): Cell | null => {
    if (!cols || !rows) return null;
    const uv = toUv(clientX, clientY);
    if (!uv) return null;
    return [
      Math.min(cols - 1, Math.floor(uv.u * cols)),
      Math.min(Math.ceil(rows) - 1, Math.floor(uv.v * rows)),
    ];
  };

  const painted = (effect: TokenEffect, [c, r]: Cell) =>
    (draftRef.current.zones ?? [])
      .find((z) => z.effect === effect)
      ?.cells.some(([cc, rr]) => cc === c && rr === r) ?? false;

  const applyCell = (effect: TokenEffect, cell: Cell, op: 'add' | 'remove') => {
    const d = draftRef.current;
    const zones = [...(d.zones ?? [])];
    const i = zones.findIndex((z) => z.effect === effect);
    const cells = i >= 0 ? [...zones[i].cells] : [];
    const at = cells.findIndex(([c, r]) => c === cell[0] && r === cell[1]);
    if (op === 'add' && at < 0) cells.push(cell);
    if (op === 'remove' && at >= 0) cells.splice(at, 1);
    if (i >= 0) zones[i] = { effect, cells };
    else zones.push({ effect, cells });
    commit({ ...d, zones: zones.filter((z) => z.cells.length > 0) });
  };

  // --- framing (soft-locked during combat) ---------------------------------

  const framingAllowed = () => {
    if (!combatRunning || confirmedRef.current) return true;
    confirmedRef.current = window.confirm(
      'Combat is running — physical minis stand on the current framing. Adjust anyway?',
    );
    return confirmedRef.current;
  };

  const setView = (patch: Partial<SceneView>, live = true) => {
    const d = draftRef.current;
    const next = { ...d, view: { ...(d.view ?? DEFAULT_VIEW), ...patch } };
    live ? commit(next) : stage(next);
  };

  const setToken = (id: string, patch: Partial<Token>, live = true) => {
    const d = draftRef.current;
    const next = {
      ...d,
      tokens: (d.tokens ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    };
    live ? commit(next) : stage(next);
  };

  const addToken = () => {
    mark();
    const token: Token = {
      id: newLocalId('tok'),
      label: `Token ${tokens.length + 1}`,
      u: view.cu,
      v: view.cv,
      sizeInches: 1,
      color: TOKEN_COLORS[tokens.length % TOKEN_COLORS.length],
    };
    commit({ ...draft, tokens: [...tokens, token] });
    setSelectedId(token.id);
    setTool('frame');
  };

  // --- keyboard -------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose?.();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'v') setTool('frame');
      if (e.key === 'h') setTool('pan');
      if (e.key === 'b' && cols) setTool('paint');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // --- pointer handling -----------------------------------------------------

  // Capture keeps a drag alive past the element edge, but throws when
  // the pointer isn't active — never let that abort the interaction.
  const capture = (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    capture(e);
    if (tool === 'pan' || e.button === 1) {
      dragRef.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === 'paint') {
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      mark();
      const op = painted(brush, cell) ? 'remove' : 'add';
      dragRef.current = { kind: 'paint', op, last: cell.join(',') };
      applyCell(brush, cell, op);
      return;
    }
    // frame tool on empty map
    if (view.mode !== 'true') return;
    if (!framingAllowed()) return;
    mark();
    dragRef.current = { kind: 'frame' };
    const uv = toUv(e.clientX, e.clientY);
    if (uv) setView({ cu: uv.u, cv: uv.v }, false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      dragRef.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
    } else if (d.kind === 'paint') {
      const cell = cellAt(e.clientX, e.clientY);
      if (cell && cell.join(',') !== d.last) {
        d.last = cell.join(',');
        applyCell(brush, cell, d.op);
      }
    } else if (d.kind === 'token') {
      const uv = toUv(e.clientX, e.clientY);
      if (uv) setToken(d.id, uv, false);
    } else if (d.kind === 'frame') {
      const uv = toUv(e.clientX, e.clientY);
      if (uv) setView({ cu: uv.u, cv: uv.v }, false);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    // one write for the whole drag, not one per pointer sample
    if (d?.kind === 'token' || d?.kind === 'frame') onChange(draftRef.current);
  };

  // --- derived table frame --------------------------------------------------

  const denom = (ppi ?? 0) * (draft.widthInches ?? 0) * (view.zoom || 1);
  const frame =
    view.mode === 'true' && denom > 0 && tableDisplay && nat
      ? {
          fw: tableDisplay.w / denom,
          fh: tableDisplay.h / (denom * (nat.h / nat.w)),
        }
      : null;

  const px = (inches: number) => (cellPx ? inches * cellPx : 24);

  return (
    <div className="absolute inset-0 z-40 overflow-hidden bg-stone-950">
      {/* ---------------- canvas ---------------- */}
      <div
        ref={canvasRef}
        className={`absolute inset-0 overflow-hidden touch-none ${
          tool === 'pan' ? 'cursor-grab' : tool === 'paint' ? 'cursor-crosshair' : ''
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12)}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: baseW || undefined,
            height: baseH || undefined,
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`,
          }}
        >
          <img
            src={`/api/maps/${draft.key}`}
            alt={draft.name}
            className="absolute inset-0 h-full w-full select-none"
            draggable={false}
            ref={measure}
            onLoad={(e) => measure(e.currentTarget)}
          />

          {cellPx && (
            <TileZones
              zones={draft.zones ?? []}
              left={0}
              top={0}
              width={baseW}
              height={baseH}
              cellPx={cellPx}
            />
          )}

          {cellPx && showGrid && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(251,191,36,0.22) 0 1px, transparent 1px 100%), linear-gradient(to bottom, rgba(251,191,36,0.22) 0 1px, transparent 1px 100%)',
                backgroundSize: `${cellPx}px ${cellPx}px`,
              }}
              aria-hidden
            />
          )}

          {frame && (
            <div
              className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/5"
              style={{
                left: (view.cu - frame.fw / 2) * baseW,
                top: (view.cv - frame.fh / 2) * baseH,
                width: frame.fw * baseW,
                height: frame.fh * baseH,
                borderWidth: 2 / cam.z,
              }}
              aria-hidden
            />
          )}

          {[...tokens]
            .sort((a, b) => (a.effect ? 0 : 1) - (b.effect ? 0 : 1))
            .map((token) => {
              const zone = token.effect ? zoneStyle(token.effect) : null;
              const s = px(token.sizeInches);
              return (
                <button
                  key={token.id}
                  className={`absolute flex items-center justify-center font-mono font-bold text-stone-950 ${
                    tool !== 'frame' ? 'pointer-events-none' : ''
                  } ${zone?.animate ? 'animate-pulse' : ''} ${
                    selectedId === token.id ? 'ring-2 ring-amber-300' : ''
                  } ${!zone ? 'border-2 border-stone-950/70' : ''}`}
                  style={{
                    left: token.u * baseW,
                    top: token.v * baseH,
                    width: s,
                    height: s,
                    fontSize: Math.max(8, s * 0.3),
                    ...(zone
                      ? { background: zone.background, boxShadow: zone.boxShadow }
                      : { backgroundColor: token.color }),
                    ...tokenShapeStyle(zone ? token : { ...token, shape: 'circle' }),
                  }}
                  onPointerDown={(e) => {
                    if (tool !== 'frame') return;
                    e.stopPropagation();
                    capture(e);
                    mark();
                    setSelectedId(token.id);
                    dragRef.current = { kind: 'token', id: token.id };
                  }}
                  aria-label={`token ${token.label}`}
                  title={token.label}
                >
                  {!zone && token.label.slice(0, 2)}
                </button>
              );
            })}
        </div>
      </div>

      {/* ---------------- top bar ---------------- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className={`pointer-events-auto flex items-center gap-2 px-3 py-2 ${panel}`}>
          <input
            className="w-48 bg-transparent font-serif text-lg text-stone-100 focus:outline-none"
            defaultValue={draft.name}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== draft.name) {
                mark();
                commit({ ...draft, name });
              }
            }}
            aria-label="scene name"
          />
          <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-500/80">
            live
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <div className={`flex items-center gap-1 p-1 ${panel}`}>
            <button
              className={toolBtn(false)}
              onClick={undo}
              title="undo (⌘Z)"
              aria-label="undo"
            >
              ↺
            </button>
            <button
              className={toolBtn(false)}
              onClick={() => zoomCenter(1 / 1.25)}
              aria-label="zoom out"
            >
              −
            </button>
            <button
              className="px-1 font-mono text-xs text-stone-400 hover:text-stone-100"
              onClick={resetCam}
              title="reset view"
            >
              {Math.round(cam.z * 100)}%
            </button>
            <button
              className={toolBtn(false)}
              onClick={() => zoomCenter(1.25)}
              aria-label="zoom in"
            >
              +
            </button>
          </div>
          {onClose && (
            <button
              className={`pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl text-lg text-stone-300 hover:text-stone-100 ${panel}`}
              onClick={onClose}
              aria-label="close editor"
              title="close (esc)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ---------------- left tool rail ---------------- */}
      <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
        <div className={`flex flex-col gap-1 p-1 ${panel}`}>
          <button
            className={toolBtn(tool === 'frame')}
            onClick={() => setTool('frame')}
            title="select & frame (V) — drag tokens, drag map to aim the table"
            aria-label="frame tool"
          >
            ⊹
          </button>
          <button
            className={toolBtn(tool === 'pan')}
            onClick={() => setTool('pan')}
            title="pan the workshop view (H)"
            aria-label="pan tool"
          >
            ✋
          </button>
          <button
            className={toolBtn(tool === 'paint')}
            onClick={() => cols && setTool('paint')}
            disabled={!cols}
            title={
              cols
                ? 'paint ground effects onto 1" tiles (B)'
                : 'set the map width first — tiles need inches'
            }
            aria-label="paint tool"
          >
            <span className={cols ? '' : 'opacity-30'}>🖌</span>
          </button>
          <button
            className={toolBtn(false)}
            onClick={addToken}
            title="add a token"
            aria-label="add token"
          >
            ⊕
          </button>
          <button
            className={toolBtn(showGrid)}
            onClick={() => setShowGrid(!showGrid)}
            title="map grid preview"
            aria-label="toggle grid"
          >
            ▦
          </button>
        </div>

        {tool === 'paint' && (
          <div className={`flex flex-col gap-1 p-1 ${panel}`}>
            {TOKEN_EFFECTS.map((fx) => (
              <button
                key={fx.value}
                className={`flex h-9 w-11 items-center justify-center rounded-lg ${
                  brush === fx.value ? 'ring-2 ring-amber-400' : ''
                }`}
                style={{ backgroundColor: zoneBase(fx.value).fill }}
                onClick={() => setBrush(fx.value)}
                title={fx.label}
                aria-label={`brush ${fx.label}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---------------- token inspector ---------------- */}
      {selected && (
        <div
          className={`absolute bottom-20 left-1/2 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${panel}`}
        >
          <input
            className={`${input} w-28`}
            value={selected.label}
            onChange={(e) => setToken(selected.id, { label: e.target.value })}
            aria-label="token label"
          />
          <select
            className={input}
            value={selected.effect ?? ''}
            onChange={(e) => {
              mark();
              setToken(selected.id, {
                effect: (e.target.value || undefined) as Token['effect'],
              });
            }}
            aria-label="token style"
          >
            <option value="">marker</option>
            {TOKEN_EFFECTS.map((fx) => (
              <option key={fx.value} value={fx.value}>
                {fx.label}
              </option>
            ))}
          </select>
          {selected.effect ? (
            <>
              <select
                className={input}
                value={selected.shape ?? 'circle'}
                onChange={(e) =>
                  setToken(selected.id, { shape: e.target.value as Token['shape'] })
                }
                aria-label="zone shape"
              >
                {TOKEN_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                className="rounded bg-stone-800 px-2 py-1 font-mono text-xs text-stone-300"
                onClick={() =>
                  setToken(selected.id, { rot: ((selected.rot ?? 0) + 45) % 360 })
                }
                aria-label="rotate zone"
              >
                ⟳ {selected.rot ?? 0}°
              </button>
            </>
          ) : (
            <div className="flex gap-1">
              {TOKEN_COLORS.map((color) => (
                <button
                  key={color}
                  className={`h-5 w-5 rounded-full ${
                    selected.color === color ? 'ring-2 ring-stone-100' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setToken(selected.id, { color })}
                  aria-label={`color ${color}`}
                />
              ))}
            </div>
          )}
          <select
            className={input}
            value={selected.sizeInches}
            onChange={(e) =>
              setToken(selected.id, { sizeInches: Number(e.target.value) })
            }
            aria-label="token size"
          >
            {TOKEN_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}"
              </option>
            ))}
          </select>
          {!selected.effect && (
            <select
              className={input}
              value={selected.characterId ?? ''}
              onChange={(e) =>
                setToken(selected.id, { characterId: e.target.value || null })
              }
              aria-label="link token to character"
            >
              <option value="">no link</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === 'npc' ? ' (npc)' : ''}
                </option>
              ))}
            </select>
          )}
          <button
            className="rounded px-2 py-1 text-sm text-stone-400 hover:bg-red-950 hover:text-red-300"
            onClick={() => {
              mark();
              commit({ ...draft, tokens: tokens.filter((t) => t.id !== selected.id) });
              setSelectedId(null);
            }}
          >
            delete
          </button>
        </div>
      )}

      {/* ---------------- bottom bar ---------------- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <div className="pointer-events-auto flex flex-col gap-2">
          {showScene && (
            <div className={`flex flex-col gap-3 p-3 ${panel}`}>
              <label className="flex items-center gap-2">
                <span className="w-24 font-mono text-xs uppercase tracking-wider text-stone-500">
                  true width
                </span>
                <input
                  className={`${input} w-20`}
                  type="number"
                  placeholder="in"
                  defaultValue={draft.widthInches ?? ''}
                  onBlur={(e) => {
                    mark();
                    commit({
                      ...draft,
                      widthInches:
                        e.target.value === '' ? undefined : Number(e.target.value),
                    });
                  }}
                  aria-label="map width in inches"
                />
                <span className="text-xs text-stone-600">
                  {cols ? `${cols} × ${Math.round(rows ?? 0)} squares` : 'needed for tiles'}
                </span>
              </label>

              <div className="flex items-center gap-2">
                <span className="w-24 font-mono text-xs uppercase tracking-wider text-stone-500">
                  table shows
                </span>
                {(['fit', 'true'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      view.mode === mode
                        ? 'bg-amber-700 text-stone-950'
                        : 'bg-stone-800 text-stone-300'
                    }`}
                    onClick={() => framingAllowed() && setView({ mode })}
                  >
                    {mode === 'true' ? 'true scale' : 'whole map'}
                  </button>
                ))}
                {view.mode === 'true' && (
                  <>
                    <button
                      className="h-8 w-8 rounded-lg bg-stone-800 text-stone-200"
                      onClick={() =>
                        framingAllowed() &&
                        setView({ zoom: Math.max(0.25, (view.zoom || 1) - 0.25) })
                      }
                      aria-label="table zoom out"
                    >
                      −
                    </button>
                    <span className="font-mono text-sm text-stone-300">
                      {(view.zoom || 1).toFixed(2)}×
                    </span>
                    <button
                      className="h-8 w-8 rounded-lg bg-stone-800 text-stone-200"
                      onClick={() =>
                        framingAllowed() && setView({ zoom: (view.zoom || 1) + 0.25 })
                      }
                      aria-label="table zoom in"
                    >
                      +
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <button
            className={`self-start px-3 py-2 font-mono text-xs text-stone-300 ${panel}`}
            onClick={() => setShowScene(!showScene)}
          >
            scene {showScene ? '▾' : '▸'}
          </button>
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {showTokens && (
            <div className={`max-h-64 w-56 overflow-y-auto p-2 ${panel}`}>
              {tokens.length === 0 && (
                <p className="px-1 py-2 text-xs text-stone-600">nothing placed yet</p>
              )}
              {tokens.map((t) => (
                <button
                  key={t.id}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                    selectedId === t.id ? 'bg-stone-800 text-stone-100' : 'text-stone-400'
                  }`}
                  onClick={() => {
                    setSelectedId(t.id);
                    setTool('frame');
                    // center the workshop view on it
                    if (size)
                      setCam((c) => ({
                        ...c,
                        x: size.w / 2 - t.u * baseW * c.z,
                        y: size.h / 2 - t.v * baseH * c.z,
                      }));
                  }}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: t.effect
                        ? zoneBase(t.effect).fill
                        : t.color,
                    }}
                  />
                  <span className="truncate">{t.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-stone-600">
                    {t.sizeInches}"
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            className={`px-3 py-2 font-mono text-xs text-stone-300 ${panel}`}
            onClick={() => setShowTokens(!showTokens)}
          >
            tokens · {tokens.length} {showTokens ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {/* ---------------- hint ---------------- */}
      <p className="pointer-events-none absolute inset-x-0 bottom-14 text-center font-mono text-[11px] text-stone-600">
        {tool === 'paint'
          ? `drag to paint ${brush} · tap a painted tile to erase`
          : tool === 'pan'
            ? 'drag to move the workshop view · scroll to zoom'
            : view.mode === 'true'
              ? 'drag tokens to place · drag the map to aim the amber frame at the table'
              : 'drag tokens to place · table is showing the whole map'}
        {combatRunning && ' · combat running'}
      </p>
    </div>
  );
}

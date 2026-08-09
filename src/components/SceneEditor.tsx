import { useRef, useState } from 'react';
import type { Scene, SceneView, Token } from '../../worker/types';
import { newLocalId } from '../lib/api';
import { btn, input, sectionLabel } from '../lib/ui';
import { TOKEN_EFFECTS, zoneStyle } from './token-visuals';

// Fullscreen scene editor (console-side). Scale + framing + tokens —
// drag the map to move the viewport, drag a token to move the token,
// tap a token to select and edit it. Fog paints onto this same
// surface next phase (docs/BATTLEMAP.md).

const DEFAULT_VIEW: SceneView = { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 };

export const TOKEN_COLORS = [
  '#dc2626', // red
  '#d97706', // amber
  '#65a30d', // lime
  '#0d9488', // teal
  '#2563eb', // blue
  '#9333ea', // purple
  '#db2777', // pink
  '#57534e', // stone
];

const TOKEN_SIZES = [0.5, 1, 2, 3, 4, 6, 8];

export function SceneEditor({
  scene,
  combatRunning,
  ppi,
  tableDisplay,
  characters,
  onSave,
  onClose,
}: {
  scene: Scene;
  combatRunning: boolean;
  /** The table display's calibrated px-per-inch (from the grid). */
  ppi?: number;
  /** The table client's self-reported viewport. */
  tableDisplay?: { w: number; h: number };
  /** For linking tokens to characters (reactive effects). */
  characters: { id: string; name: string; kind: 'pc' | 'npc' }[];
  onSave: (next: Scene) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Scene>({
    ...scene,
    view: scene.view ?? DEFAULT_VIEW,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [, setLoaded] = useState(false); // re-render once img has layout
  const confirmedRef = useRef(false);
  const draggingViewRef = useRef(false);
  const draggingTokenRef = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const view = draft.view ?? DEFAULT_VIEW;
  const tokens = draft.tokens ?? [];
  const selected = tokens.find((t) => t.id === selectedId) ?? null;

  // The exact region the table will show, as fractions of the map:
  // visible map inches = table px / (ppi × zoom); over widthInches.
  const img = imgRef.current;
  const denom = (ppi ?? 0) * (draft.widthInches ?? 0) * (view.zoom || 1);
  const frame =
    view.mode === 'true' && denom > 0 && tableDisplay && img && img.naturalWidth
      ? {
          fw: tableDisplay.w / denom,
          fh: tableDisplay.h / (denom * (img.naturalHeight / img.naturalWidth)),
        }
      : null;

  // Tokens render in MAP inches on the preview: px per map inch of the
  // displayed image. Falls back to a readable fixed size pre-width.
  const previewPxPerInch =
    img && draft.widthInches ? img.offsetWidth / draft.widthInches : null;

  // Soft lock: physical minis stand on the current framing. Warn once
  // per editor open while initiative is running; never forbid.
  const framingAllowed = () => {
    if (!combatRunning || confirmedRef.current) return true;
    confirmedRef.current = window.confirm(
      'Combat is running — physical minis stand on the current framing. Adjust anyway?',
    );
    return confirmedRef.current;
  };

  const setView = (patch: Partial<SceneView>) =>
    setDraft((d) => ({ ...d, view: { ...(d.view ?? DEFAULT_VIEW), ...patch } }));

  const setToken = (id: string, patch: Partial<Token>) =>
    setDraft((d) => ({
      ...d,
      tokens: (d.tokens ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  const pointerUv = (e: React.PointerEvent): { u: number; v: number } | null => {
    const el = imgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      u: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      v: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const addToken = () => {
    const token: Token = {
      id: newLocalId('tok'),
      label: `NPC ${tokens.length + 1}`,
      u: view.cu,
      v: view.cv,
      sizeInches: 1,
      color: TOKEN_COLORS[tokens.length % TOKEN_COLORS.length],
    };
    setDraft((d) => ({ ...d, tokens: [...(d.tokens ?? []), token] }));
    setSelectedId(token.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-950/97 backdrop-blur-sm">
      <header className="flex items-center gap-3 p-4">
        <input
          className="min-w-0 flex-1 bg-transparent font-serif text-2xl text-stone-100 focus:outline-none"
          defaultValue={draft.name}
          onBlur={(e) =>
            e.target.value.trim() &&
            setDraft((d) => ({ ...d, name: e.target.value.trim() }))
          }
          aria-label="scene name"
        />
        <button className={btn} onClick={() => onSave(draft)}>
          save
        </button>
        <button className={btn} onClick={onClose}>
          cancel
        </button>
      </header>

      <div
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        onPointerDown={(e) => {
          if (view.mode !== 'true' || !framingAllowed()) return;
          draggingViewRef.current = true;
          const uv = pointerUv(e);
          if (uv) setView({ cu: uv.u, cv: uv.v });
        }}
        onPointerMove={(e) => {
          if (draggingTokenRef.current) {
            const uv = pointerUv(e);
            if (uv) setToken(draggingTokenRef.current, uv);
          } else if (draggingViewRef.current) {
            const uv = pointerUv(e);
            if (uv) setView({ cu: uv.u, cv: uv.v });
          }
        }}
        onPointerUp={() => {
          draggingViewRef.current = false;
          draggingTokenRef.current = null;
        }}
        onPointerLeave={() => {
          draggingViewRef.current = false;
          draggingTokenRef.current = null;
        }}
      >
        <img
          ref={imgRef}
          src={`/api/maps/${draft.key}`}
          alt={draft.name}
          className="absolute inset-0 m-auto max-h-full max-w-full"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
        {view.mode === 'true' && img && (
          <>
            {frame && (
              <div
                className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_0_9999px_rgba(12,10,9,0.45)]"
                style={{
                  left: img.offsetLeft + (view.cu - frame.fw / 2) * img.offsetWidth,
                  top: img.offsetTop + (view.cv - frame.fh / 2) * img.offsetHeight,
                  width: frame.fw * img.offsetWidth,
                  height: frame.fh * img.offsetHeight,
                }}
                aria-hidden
              />
            )}
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400"
              style={{
                left: img.offsetLeft + view.cu * img.offsetWidth,
                top: img.offsetTop + view.cv * img.offsetHeight,
              }}
              aria-hidden
            />
          </>
        )}
        {img &&
          [...tokens]
            .sort((a, b) => (a.effect ? 0 : 1) - (b.effect ? 0 : 1))
            .map((token) => {
              const size = previewPxPerInch
                ? Math.max(14, token.sizeInches * previewPxPerInch)
                : 24;
              const zone = token.effect ? zoneStyle(token.effect) : null;
              return (
                <button
                  key={token.id}
                  className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-mono text-[10px] font-bold text-stone-950 ${
                    zone
                      ? zone.animate
                        ? 'animate-pulse'
                        : ''
                      : 'border-2'
                  } ${
                    selectedId === token.id
                      ? 'ring-2 ring-amber-400'
                      : zone
                        ? ''
                        : 'border-stone-950/70'
                  } ${selectedId === token.id && !zone ? 'border-amber-300' : ''}`}
                  style={{
                    left: img.offsetLeft + token.u * img.offsetWidth,
                    top: img.offsetTop + token.v * img.offsetHeight,
                    width: size,
                    height: size,
                    ...(zone
                      ? { background: zone.background, boxShadow: zone.boxShadow }
                      : { backgroundColor: token.color }),
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(token.id);
                    draggingTokenRef.current = token.id;
                  }}
                  aria-label={`token ${token.label}`}
                  title={token.label}
                >
                  {!zone && token.label.slice(0, 2)}
                </button>
              );
            })}
      </div>

      <footer className="space-y-3 p-4">
        {selected && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-stone-800 bg-stone-900/60 p-3">
            <input
              className={`${input} w-32`}
              value={selected.label}
              onChange={(e) => setToken(selected.id, { label: e.target.value })}
              aria-label="token label"
            />
            <select
              className={input}
              value={selected.effect ?? ''}
              onChange={(e) =>
                setToken(selected.id, {
                  effect: (e.target.value || undefined) as Token['effect'],
                })
              }
              aria-label="token style"
            >
              <option value="">marker</option>
              {TOKEN_EFFECTS.map((fx) => (
                <option key={fx.value} value={fx.value}>
                  {fx.label}
                </option>
              ))}
            </select>
            {!selected.effect && (
              <div className="flex gap-1">
                {TOKEN_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`h-6 w-6 rounded-full ${
                      selected.color === color ? 'ring-2 ring-stone-100' : ''
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setToken(selected.id, { color })}
                    aria-label={`color ${color}`}
                  />
                ))}
              </div>
            )}
            <div className="flex gap-1">
              {TOKEN_SIZES.map((s) => (
                <button
                  key={s}
                  className={`rounded px-2 py-0.5 font-mono text-xs ${
                    selected.sizeInches === s
                      ? 'bg-amber-700 text-stone-950'
                      : 'bg-stone-800 text-stone-300'
                  }`}
                  onClick={() => setToken(selected.id, { sizeInches: s })}
                >
                  {s}"
                </button>
              ))}
            </div>
            {!selected.effect && (
            <select
              className={input}
              value={selected.characterId ?? ''}
              onChange={(e) =>
                setToken(selected.id, { characterId: e.target.value || null })
              }
              aria-label="link token to character"
            >
              <option value="">no character link</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === 'npc' ? ' (npc)' : ''}
                </option>
              ))}
            </select>
            )}
            <button
              className="ml-auto rounded px-2 py-1 text-sm text-stone-400 hover:bg-red-950 hover:text-red-300"
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  tokens: (d.tokens ?? []).filter((t) => t.id !== selected.id),
                }));
                setSelectedId(null);
              }}
            >
              delete
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <button className={btn} onClick={addToken}>
            + token
          </button>

          <label className="flex items-center gap-2">
            <span className={sectionLabel}>True width</span>
            <input
              className={`${input} w-24`}
              type="number"
              placeholder="inches"
              defaultValue={draft.widthInches ?? ''}
              onBlur={(e) =>
                setDraft((d) => ({
                  ...d,
                  widthInches:
                    e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              aria-label="map width in inches"
            />
            <span className="text-xs text-stone-500">in</span>
          </label>

          <div className="flex items-center gap-1">
            {(['fit', 'true'] as const).map((mode) => (
              <button
                key={mode}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  view.mode === mode
                    ? 'bg-amber-700 text-stone-950'
                    : 'bg-stone-800 text-stone-300'
                }`}
                onClick={() => framingAllowed() && setView({ mode })}
                title={
                  mode === 'true'
                    ? 'true physical scale (needs width + a calibrated grid)'
                    : 'fit the whole map on screen'
                }
              >
                {mode === 'true' ? 'true scale' : 'fit'}
              </button>
            ))}
          </div>

          {view.mode === 'true' && (
            <div className="flex items-center gap-2">
              <span className={sectionLabel}>Zoom</span>
              <button
                className="h-8 w-8 rounded-lg bg-stone-800 text-lg text-stone-200"
                onClick={() =>
                  framingAllowed() &&
                  setView({ zoom: Math.max(0.25, (view.zoom || 1) - 0.25) })
                }
                aria-label="zoom out"
              >
                −
              </button>
              <span className="font-mono text-sm text-stone-300">
                {(view.zoom || 1).toFixed(2)}×
              </span>
              <button
                className="h-8 w-8 rounded-lg bg-stone-800 text-lg text-stone-200"
                onClick={() =>
                  framingAllowed() && setView({ zoom: (view.zoom || 1) + 0.25 })
                }
                aria-label="zoom in"
              >
                +
              </button>
            </div>
          )}

          <p className="basis-full text-xs leading-snug text-stone-600">
            {view.mode === 'true'
              ? 'drag the map to frame (the amber box is exactly what the table shows) · drag tokens to place them · tap a token to edit'
              : 'fit shows the whole map · drag tokens to place them · tap a token to edit'}
            {combatRunning && ' · combat is running — framing changes will ask first'}
          </p>
        </div>
      </footer>
    </div>
  );
}

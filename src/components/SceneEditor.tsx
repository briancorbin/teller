import { useRef, useState } from 'react';
import type { Scene, SceneView } from '../../worker/types';
import { btn, input, sectionLabel } from '../lib/ui';

// Fullscreen scene editor (console-side). Phase 1: scale + framing —
// declare the map's physical width, choose fit/true, zoom, and tap or
// drag on the preview to move the viewport center. Tokens and fog
// paint onto this same surface in later phases (docs/BATTLEMAP.md).

const DEFAULT_VIEW: SceneView = { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 };

export function SceneEditor({
  scene,
  combatRunning,
  ppi,
  tableDisplay,
  onSave,
  onClose,
}: {
  scene: Scene;
  combatRunning: boolean;
  /** The table display's calibrated px-per-inch (from the grid). */
  ppi?: number;
  /** The table client's self-reported viewport. */
  tableDisplay?: { w: number; h: number };
  onSave: (next: Scene) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Scene>({
    ...scene,
    view: scene.view ?? DEFAULT_VIEW,
  });
  const [, setLoaded] = useState(false); // re-render once img has layout
  const confirmedRef = useRef(false);
  const draggingRef = useRef(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const view = draft.view ?? DEFAULT_VIEW;

  // The exact region the table will show, as fractions of the map:
  // visible map inches = table px / (ppi × zoom); over widthInches.
  const img = imgRef.current;
  const denom = (ppi ?? 0) * (draft.widthInches ?? 0) * (view.zoom || 1);
  const frame =
    view.mode === 'true' && denom > 0 && tableDisplay && img && img.naturalWidth
      ? {
          fw: tableDisplay.w / denom,
          fh:
            tableDisplay.h /
            (denom * (img.naturalHeight / img.naturalWidth)),
        }
      : null;

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

  const centerFromPointer = (e: React.PointerEvent) => {
    const img = imgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    setView({
      cu: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      cv: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
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
          draggingRef.current = true;
          centerFromPointer(e);
        }}
        onPointerMove={(e) => draggingRef.current && centerFromPointer(e)}
        onPointerUp={() => (draggingRef.current = false)}
        onPointerLeave={() => (draggingRef.current = false)}
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
      </div>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
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
            ? 'tap or drag to frame — the amber box is exactly what the table shows; 1.00× = exact inches on a calibrated table'
            : 'fit shows the whole map; switch to true scale for combat once the grid is calibrated'}
          {combatRunning && ' · combat is running — framing changes will ask first'}
        </p>
      </footer>
    </div>
  );
}

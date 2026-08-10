import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  Display,
  Placement,
  Scene,
  SceneView,
  Token,
  TokenEffect,
} from '../../worker/types';
import { newLocalId } from '../lib/api';
import { input } from '../lib/ui';
import {
  TOKEN_COLORS,
  TOKEN_EFFECTS,
  tokenShapeStyle,
  zoneBase,
  zoneStyle,
} from './token-visuals';
import { TileZones } from './TileZones';
import { FogLayer } from './FogLayer';
import { GRID_COLORS, GRID_DEFAULTS, GridOverlay } from './GridOverlay';
import { CalibrationWizard } from './CalibrationWizard';

// The map workshop: a fullscreen canvas with floating tool overlays.
// Edits are LIVE (debounced PATCH) like everything else in teller —
// adjust framing, look at the table, adjust again, no save round-trip.
// An in-editor undo stack covers mistakes. docs/BATTLEMAP.md governs
// the coordinate rules; the camera here is workshop-only and never
// touches what the table shows.

const DEFAULT_VIEW: SceneView = { mode: 'fit', zoom: 1, cu: 0.5, cv: 0.5 };
const SNAP_PREF = 'teller.editor.snap';
const AREAS_PREF = 'teller.editor.areas';

const TOKEN_SIZES = [0.5, 1, 2, 3, 4, 6, 8];
const TOKEN_SHAPES = ['circle', 'square', 'triangle'] as const;

// 'select' is the safe default: it drags tokens, and a drag on empty
// map pans the workshop view rather than re-aiming the table. Aiming
// the table is its own deliberate tool, and can be locked outright.
type Tool = 'select' | 'pan' | 'frame' | 'paint' | 'fog';
type Cell = [number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const panel =
  'rounded-2xl border border-stone-800 bg-stone-950/85 shadow-xl backdrop-blur';
const toolBtn = (on: boolean) =>
  `flex h-11 w-11 items-center justify-center rounded-xl text-lg transition-colors ${
    on ? 'bg-amber-700 text-stone-950' : 'text-stone-300 hover:bg-stone-800'
  }`;

export function SceneEditor({
  campaignId,
  scene,
  combatRunning,
  table,
  characters,
  placements,
  onPlacements,
  placementNames,
  fights,
  arrangingId,
  onArrange,
  live = true,
  onCalibrate,
  onChange,
  onClose,
}: {
  campaignId: string;
  scene: Scene;
  combatRunning: boolean;
  /**
   * The screen currently assigned the table role, if any. Calibration
   * and viewport belong to that glass, not to the campaign — so the
   * true-scale preview is only as real as the screen it describes.
   */
  table?: Display | null;
  characters: { id: string; name: string; kind: 'pc' | 'npc' }[];
  /**
   * Foes of a prepared fight being arranged on this map.
   *
   * They are NOT tokens: nothing exists on the table yet. A placement is
   * where a creature will START, drawn here so you can arrange an ambush
   * the week before you run it. Deploying turns each one into a real
   * character and a real token at this spot.
   *
   * Absent when the editor is just editing a map.
   */
  placements?: Placement[];
  onPlacements?: (next: Placement[]) => void;
  /** Names for the placement pucks, resolved from the bestiary. */
  placementNames?: Map<string, string>;
  /** Prepared fights staged on THIS map — the ones arrangeable here. */
  fights?: { id: string; name: string }[];
  /** Which one is being arranged, or null for map work. */
  arrangingId?: string | null;
  onArrange?: (id: string | null) => void;
  /** Whether this scene is the one currently on the table. */
  live?: boolean;
  /** Write the table display's calibration (px per true inch, per axis). */
  onCalibrate?: (ppi: number, ppiY: number) => void;
  /** Live — called on every committed edit (debounced upstream). */
  onChange: (next: Scene) => void;
  /** Omitted when the editor IS the surface (the map pane). */
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState<Scene>(() => ({
    ...scene,
    view: scene.view ?? DEFAULT_VIEW,
    // Layers painted before they had identities get one now, so they
    // can be managed individually like everything painted since.
    zones: scene.zones?.map((z) => (z.id ? z : { ...z, id: newLocalId('zon') })),
  }));
  const [tool, setTool] = useState<Tool>('select');
  const [brush, setBrush] = useState<TokenEffect>('fire');
  const [secret, setSecret] = useState(false);
  const [fogBrush, setFogBrush] = useState<'reveal' | 'cover'>('reveal');
  /** When set, fog painting edits that region's cells instead of the map. */
  const [regionEditId, setRegionEditId] = useState<string | null>(null);
  const [showFog, setShowFog] = useState(false);
  const [showZones, setShowZones] = useState(false);
  /** When set, painting continues that ground layer instead of a new one. */
  const [zoneEditId, setZoneEditId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [tvWidth, setTvWidth] = useState('');
  const [tvHeight, setTvHeight] = useState('');
  // Personal workshop preference (not scene data — the table never
  // needs to know how you placed a token, only where it ended up).
  const [snap, setSnap] = useState(() => localStorage.getItem(SNAP_PREF) !== '0');
  /** Draw fog-area outlines whatever tool you're holding. */
  const [showAreas, setShowAreas] = useState(
    () => localStorage.getItem(AREAS_PREF) !== '0',
  );
  const [showTokens, setShowTokens] = useState(false);
  const [showScene, setShowScene] = useState(false);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 });
  const [camReady, setCamReady] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const undoRef = useRef<Scene[]>([]);
  const confirmedRef = useRef(false);
  /** The ground layer the in-progress stroke is writing into. */
  const zoneStrokeRef = useRef<string | null>(null);
  const dragRef = useRef<
    | { kind: 'pan'; x: number; y: number }
    | { kind: 'token'; id: string }
    | { kind: 'placement'; id: string }
    | { kind: 'frame' }
    | { kind: 'paint'; op: 'add' | 'remove'; last: string | null }
    | null
  >(null);

  // Placements are dragged live and written once on release, same as
  // tokens — a write per pointer sample would be a write per pixel. So
  // the drag runs against a local copy, and the parent hears about it
  // when the finger comes up.
  const [placementDraft, setPlacementDraft] = useState<Placement[]>(
    placements ?? [],
  );
  const placementsRef = useRef(placementDraft);
  placementsRef.current = placementDraft;

  // Adopt what the parent has — but never mid-drag, or the foe under
  // your finger snaps back to where the server last saw it.
  const incoming = JSON.stringify(placements ?? []);
  useEffect(() => {
    if (dragRef.current?.kind === 'placement') return;
    setPlacementDraft(JSON.parse(incoming) as Placement[]);
  }, [incoming]);

  // Adopt a scene that changed UNDER us.
  //
  // `draft` is seeded once, so anything the server adds while this pane
  // is open was invisible here — deploy would drop four tokens onto the
  // map and the editor would still show none. Worse, the next pan
  // committed the stale draft back and DELETED them: an edit made
  // somewhere else, silently undone by looking at the map.
  //
  // Our own commits echo back through this prop, so adopting blindly
  // would fight the person typing. The echo is recognisable — it equals
  // what we last sent — and anything else came from elsewhere and wins.
  const lastSentRef = useRef<string>(JSON.stringify(scene));
  const incomingScene = JSON.stringify(scene);
  useEffect(() => {
    if (incomingScene === lastSentRef.current) return;
    if (dragRef.current) return; // never yank the map out from under a finger
    lastSentRef.current = incomingScene;
    setDraft(JSON.parse(incomingScene) as Scene);
  }, [incomingScene]);

  const setPlacement = (id: string, patch: Partial<Placement>) => {
    const next = placementsRef.current.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    );
    placementsRef.current = next;
    setPlacementDraft(next);
  };

  const ppi = table?.ppi ?? undefined;
  const ppiY = table?.ppiY ?? undefined;
  const tableDisplay = table?.viewport ?? undefined;
  const view = draft.view ?? DEFAULT_VIEW;
  const showGrid = draft.grid?.on !== false;
  /** Axes that disagree by more than rounding = the picture is stretched. */
  const stretched = Boolean(ppi && ppiY && Math.abs(ppiY / ppi - 1) > 0.02);
  const tokens = draft.tokens ?? [];
  const selected = tokens.find((t) => t.id === selectedId) ?? null;
  const selectedPlacement =
    placementDraft.find((p) => p.id === selectedId && p.u !== undefined) ?? null;

  // --- live commit + undo ---------------------------------------------------

  // A ref mirrors the draft so successive writes inside one drag build
  // on each other instead of on a stale render closure.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const commit = (next: Scene) => {
    draftRef.current = next;
    setDraft(next);
    // Remember what we sent, so the echo of this edit isn't mistaken for
    // someone else's and adopted back over the next keystroke.
    lastSentRef.current = JSON.stringify(next);
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

  // Self-healing measurement: the observer catches resizes, and the
  // layout pass re-checks every render so a stale zero (pane hidden,
  // tab backgrounded, device rotated) can never strand the geometry.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w && h && (size?.w !== w || size?.h !== h)) setSize({ w, h });
  });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure the map off to the side rather than off the rendered <img>:
  // React's onLoad misses images the browser already has cached, and the
  // whole geometry (grid, tiles, painting, framing) hangs off this.
  useEffect(() => {
    let alive = true;
    const probe = new Image();
    const take = () => {
      if (alive && probe.naturalWidth)
        setNat({ w: probe.naturalWidth, h: probe.naturalHeight });
    };
    probe.onload = take;
    probe.src = `/api/maps/${draft.key}`;
    if (probe.complete) take();
    return () => {
      alive = false;
    };
  }, [draft.key]);

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

  /**
   * Snap a token's centre to the grid the way minis actually sit:
   * odd-inch bases (1", 3") centre inside a square, even-inch bases
   * (2", 4"…) centre on the intersection so they cover their squares
   * evenly. Hold Option while dragging to place freely.
   */
  const snapUv = (u: number, v: number, sizeInches: number) => {
    if (!snap || !cols || !rows) return { u, v };
    const onIntersection = sizeInches >= 2 && Math.round(sizeInches) % 2 === 0;
    const fit = (n: number) =>
      onIntersection ? Math.round(n) : Math.floor(n) + 0.5;
    return {
      u: clamp01(fit(u * cols) / cols),
      v: clamp01(fit(v * rows) / rows),
    };
  };

  const cellAt = (clientX: number, clientY: number): Cell | null => {
    if (!cols || !rows) return null;
    const uv = toUv(clientX, clientY);
    if (!uv) return null;
    return [
      Math.min(cols - 1, Math.floor(uv.u * cols)),
      Math.min(Math.ceil(rows) - 1, Math.floor(uv.v * rows)),
    ];
  };

  /**
   * Which layer a paint stroke belongs to. Touching existing paint of
   * the current brush picks that layer up (and erases from it);
   * otherwise the stroke continues the layer you're editing, or starts
   * a fresh one — so two separate fires stay two separate fires.
   */
  const zoneStrokeTarget = (cell: Cell): { id: string; op: 'add' | 'remove' } => {
    const zones = draftRef.current.zones ?? [];
    const under = zones.find(
      (z) =>
        z.effect === brush &&
        !!z.hidden === secret &&
        z.cells.some(([c, r]) => c === cell[0] && r === cell[1]),
    );
    if (under?.id) return { id: under.id, op: 'remove' };
    const editing = zones.find(
      (z) => z.id === zoneEditId && z.effect === brush && !!z.hidden === secret,
    );
    return { id: editing?.id ?? newLocalId('zon'), op: 'add' };
  };

  const applyCell = (zoneId: string, cell: Cell, op: 'add' | 'remove') => {
    const d = draftRef.current;
    const zones = [...(d.zones ?? [])];
    const i = zones.findIndex((z) => z.id === zoneId);
    if (i < 0) {
      if (op === 'remove') return;
      zones.push({
        id: zoneId,
        effect: brush,
        cells: [cell],
        ...(secret ? { hidden: true } : {}),
      });
    } else {
      const cells = zones[i].cells.filter(
        ([c, r]) => !(c === cell[0] && r === cell[1]),
      );
      if (op === 'add') cells.push(cell);
      zones[i] = { ...zones[i], cells };
    }
    commit({ ...d, zones: zones.filter((z) => z.cells.length > 0) });
  };

  // --- fog -----------------------------------------------------------------

  const fog = draft.fog ?? { on: false, revealed: [] as [number, number][] };
  const regions = fog.regions ?? [];
  const editingRegion = regions.find((r) => r.id === regionEditId) ?? null;

  const setFog = (next: Partial<typeof fog>) =>
    commit({ ...draftRef.current, fog: { ...fog, ...next } });

  const inCells = (cells: [number, number][], [c, r]: Cell) =>
    cells.some(([cc, rr]) => cc === c && rr === r);

  const applyFog = (cell: Cell, op: 'add' | 'remove') => {
    const d = draftRef.current;
    const f = d.fog ?? { on: true, revealed: [] as [number, number][] };
    const edit = (cells: [number, number][]) => {
      const next = cells.filter(([c, r]) => !(c === cell[0] && r === cell[1]));
      return op === 'add' ? [...next, cell] : next;
    };
    // Painting into a region shapes the room; otherwise it clears ground.
    const nextFog = regionEditId
      ? {
          ...f,
          regions: (f.regions ?? []).map((r) =>
            r.id === regionEditId ? { ...r, cells: edit(r.cells) } : r,
          ),
        }
      : { ...f, revealed: edit(f.revealed ?? []) };
    commit({ ...d, fog: nextFog });
  };

  const fogPainted = (cell: Cell) =>
    regionEditId
      ? inCells(editingRegion?.cells ?? [], cell)
      : inCells(fog.revealed ?? [], cell);

  const addRegion = () => {
    mark();
    const region = {
      id: newLocalId('rgn'),
      name: `Area ${regions.length + 1}`,
      cells: [] as [number, number][],
      revealed: false,
    };
    setFog({ regions: [...regions, region] });
    setRegionEditId(region.id);
    setTool('fog');
    setFogBrush('reveal');
    setShowFog(true);
  };

  /** Flip one layer between shown and hidden — layers stay distinct. */
  const toggleZoneHidden = (zoneId: string) =>
    commit({
      ...draftRef.current,
      zones: (draftRef.current.zones ?? []).map((z) =>
        z.id === zoneId ? { ...z, hidden: z.hidden ? undefined : true } : z,
      ),
    });

  const deleteZone = (zoneId: string) =>
    commit({
      ...draftRef.current,
      zones: (draftRef.current.zones ?? []).filter((z) => z.id !== zoneId),
    });

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
    const placed = snapUv(view.cu, view.cv, 1);
    const token: Token = {
      id: newLocalId('tok'),
      label: `Token ${tokens.length + 1}`,
      u: placed.u,
      v: placed.v,
      sizeInches: 1,
      color: TOKEN_COLORS[tokens.length % TOKEN_COLORS.length],
      // New markers start behind the screen: revealing is deliberate,
      // and nothing lands on the table by surprise.
      hidden: true,
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
      if (e.key === 'v') setTool('select');
      if (e.key === 'f') setTool('frame');
      if (e.key === 'h') setTool('pan');
      if (e.key === 'b' && cols) setTool('paint');
      if (e.key === 'g' && cols) setTool('fog');
      if (e.key === 'l') setView({ locked: !view.locked });
      if (e.key === 's' && cols) {
        const next = !snap;
        setSnap(next);
        localStorage.setItem(SNAP_PREF, next ? '1' : '0');
      }
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
    // A drag on empty map never re-aims the table unless that's the
    // tool you chose — it just moves your own view.
    if (tool === 'pan' || tool === 'select' || e.button === 1) {
      dragRef.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === 'paint' || tool === 'fog') {
      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return;
      mark();
      if (tool === 'fog') {
        const op =
          fogBrush === 'reveal' ? (fogPainted(cell) ? 'remove' : 'add') : 'remove';
        dragRef.current = { kind: 'paint', op, last: cell.join(',') };
        applyFog(cell, op);
        return;
      }
      const target = zoneStrokeTarget(cell);
      setZoneEditId(target.id);
      zoneStrokeRef.current = target.id;
      dragRef.current = { kind: 'paint', op: target.op, last: cell.join(',') };
      applyCell(target.id, cell, target.op);
      return;
    }
    // frame tool
    if (view.locked) return;
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
        if (tool === 'fog') applyFog(cell, d.op);
        else if (zoneStrokeRef.current)
          applyCell(zoneStrokeRef.current, cell, d.op);
      }
    } else if (d.kind === 'token') {
      const uv = toUv(e.clientX, e.clientY);
      if (!uv) return;
      const token = (draftRef.current.tokens ?? []).find((t) => t.id === d.id);
      // Option bypasses the snap for fine placement.
      const placed =
        e.altKey || !token ? uv : snapUv(uv.u, uv.v, token.sizeInches);
      setToken(d.id, placed, false);
    } else if (d.kind === 'placement') {
      const uv = toUv(e.clientX, e.clientY);
      if (!uv) return;
      const foe = (placementsRef.current ?? []).find((p) => p.id === d.id);
      const placed =
        e.altKey || !foe ? uv : snapUv(uv.u, uv.v, foe.sizeInches ?? 1);
      setPlacement(d.id, placed);
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
    if (d?.kind === 'placement') onPlacements?.(placementsRef.current ?? []);
  };

  // --- derived table frame --------------------------------------------------

  const zoomed = (draft.widthInches ?? 0) * (view.zoom || 1);
  const denomX = (ppi ?? 0) * zoomed;
  const denomY = (ppiY ?? ppi ?? 0) * zoomed;
  const frame =
    view.mode === 'true' && denomX > 0 && denomY > 0 && tableDisplay && nat
      ? {
          fw: tableDisplay.w / denomX,
          fh: tableDisplay.h / (denomY * (nat.h / nat.w)),
        }
      : null;

  const px = (inches: number) => (cellPx ? inches * cellPx : 24);

  return (
    <div className="absolute inset-0 z-40 overflow-hidden bg-stone-950">
      {calibrating && (
        <CalibrationWizard
          campaignId={campaignId}
          ppi={ppi}
          ppiY={ppiY}
          tableDisplay={tableDisplay}
          onCancel={() => setCalibrating(false)}
          onDone={(x, y) => {
            onCalibrate?.(x, y);
            setCalibrating(false);
          }}
        />
      )}
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
          />

          {cellPx && (
            <TileZones
              zones={draft.zones ?? []}
              left={0}
              top={0}
              width={baseW}
              height={baseH}
              cellPx={cellPx}
              dm
            />
          )}

          {cellPx && <GridOverlay cellPx={cellPx} grid={draft.grid} />}

          {cellPx && (
            <FogLayer
              fog={draft.fog}
              left={0}
              top={0}
              width={baseW}
              height={baseH}
              cellPx={cellPx}
              dm
            />
          )}

          {/* region extents — so the Warden can see rooms that the
              table can't, and which one the brush is shaping */}
          {cellPx &&
            (tool === 'fog' || showAreas) &&
            regions.map((region) =>
              region.cells.map(([c, r]) => (
                <div
                  key={`${region.id}:${c},${r}`}
                  className="pointer-events-none absolute"
                  style={{
                    left: c * cellPx,
                    top: r * cellPx,
                    width: cellPx,
                    height: cellPx,
                    border: `${Math.max(1, cellPx * 0.04)}px solid ${
                      region.id === regionEditId
                        ? 'rgba(251,191,36,0.85)'
                        : 'rgba(125,211,252,0.45)'
                    }`,
                    background:
                      region.id === regionEditId
                        ? 'rgba(251,191,36,0.12)'
                        : 'rgba(125,211,252,0.07)',
                  }}
                />
              )),
            )}

          {frame && (
            <div
              className={`pointer-events-none absolute ${
                view.locked
                  ? 'border-dashed border-amber-500/60'
                  : 'border-amber-400 bg-amber-400/5'
              } border-2`}
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
                    tool !== 'select' ? 'pointer-events-none' : ''
                  } ${zone?.animate ? 'animate-pulse' : ''} ${
                    selectedId === token.id ? 'ring-2 ring-amber-300' : ''
                  } ${!zone ? 'border-2' : ''} ${
                    !zone
                      ? token.hidden
                        ? 'border-dashed border-stone-300/70'
                        : 'border-stone-950/70'
                      : ''
                  }`}
                  style={{
                    left: token.u * baseW,
                    top: token.v * baseH,
                    width: s,
                    height: s,
                    fontSize: Math.max(8, s * 0.3),
                    opacity: token.hidden ? 0.55 : 1,
                    ...(zone
                      ? { background: zone.background, boxShadow: zone.boxShadow }
                      : { backgroundColor: token.color }),
                    ...tokenShapeStyle(zone ? token : { ...token, shape: 'circle' }),
                  }}
                  onPointerDown={(e) => {
                    if (tool !== 'select') return;
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

          {/* Prepared foes. Drawn dashed and translucent because they
              are NOT on the table — nothing here exists until the
              encounter is deployed. Confusing "will start here" with
              "is here" mid-session would be the worst kind of wrong. */}
          {placementDraft
            .filter((p) => p.u !== undefined && p.v !== undefined)
            .map((foe) => {
              const s = px(foe.sizeInches ?? 1);
              const label = foe.name ?? placementNames?.get(foe.blueprintId) ?? '?';
              return (
                <button
                  key={foe.id}
                  className={`absolute flex items-center justify-center rounded-full border-2 border-dashed font-mono font-bold text-stone-100 ${
                    tool !== 'select' ? 'pointer-events-none' : ''
                  } ${
                    selectedId === foe.id
                      ? 'border-amber-300 ring-2 ring-amber-300'
                      : 'border-stone-200/70'
                  }`}
                  style={{
                    left: (foe.u ?? 0) * baseW,
                    top: (foe.v ?? 0) * baseH,
                    width: s,
                    height: s,
                    fontSize: Math.max(8, s * 0.3),
                    backgroundColor: 'rgba(28,25,23,0.55)',
                    transform: 'translate(-50%, -50%)',
                    opacity: foe.hidden ? 0.5 : 0.85,
                  }}
                  onPointerDown={(e) => {
                    if (tool !== 'select') return;
                    e.stopPropagation();
                    capture(e);
                    setSelectedId(foe.id);
                    dragRef.current = { kind: 'placement', id: foe.id };
                  }}
                  aria-label={`placement ${label}`}
                  title={`${label} — starts here when this encounter is deployed`}
                >
                  {label.slice(0, 2)}
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
          <span
            className={`font-mono text-[10px] uppercase tracking-widest ${
              live ? 'text-emerald-500/80' : 'text-stone-500'
            }`}
            title={
              live
                ? 'this scene is on the table — edits show up immediately'
                : 'off the table — shape it privately, then put it up'
            }
          >
            {live ? 'on the table' : 'off the table'}
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
            className={toolBtn(tool === 'select')}
            onClick={() => setTool('select')}
            title="select (V) — drag tokens; drag the map to move your view"
            aria-label="select tool"
          >
            ⊹
          </button>
          <button
            className={toolBtn(tool === 'frame')}
            onClick={() => setTool('frame')}
            title={
              view.locked
                ? 'framing is locked — unlock below to aim the table'
                : 'aim the table (F) — drag to move what the table shows'
            }
            aria-label="frame tool"
          >
            <span className={view.locked ? 'opacity-40' : ''}>▣</span>
          </button>
          <button
            className={toolBtn(!!view.locked)}
            onClick={() => setView({ locked: !view.locked })}
            title={
              view.locked
                ? 'framing locked — tap to allow re-aiming (L)'
                : 'lock framing so it cannot be moved by accident (L)'
            }
            aria-label={view.locked ? 'unlock framing' : 'lock framing'}
          >
            {view.locked ? '🔒' : '🔓'}
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
          {/*
            Arranging a fight is a MODE, so it belongs with the modes —
            it used to be a dropdown in the far corner labelled "arrange
            no fight", which read like an instruction rather than a
            state. Only offered when a prepared fight names this map;
            with exactly one, turning it on picks it, because being made
            to choose from a list of one is not a choice.
          */}
          {onArrange && (fights?.length ?? 0) > 0 && (
            <button
              className={toolBtn(Boolean(arrangingId))}
              onClick={() =>
                onArrange(arrangingId ? null : (fights![0]?.id ?? null))
              }
              title={
                arrangingId
                  ? 'stop arranging — back to working on the map'
                  : `arrange a prepared fight on this map (${fights!.length})`
              }
              aria-label={arrangingId ? 'stop arranging' : 'arrange a fight'}
              aria-pressed={Boolean(arrangingId)}
            >
              ♟
            </button>
          )}
          <button
            className={toolBtn(tool === 'fog')}
            onClick={() => {
              if (!cols) return;
              // Reaching for the tool must never black out the table —
              // fog goes on only when you say so, in the panel.
              setTool('fog');
              setShowFog(true);
            }}
            disabled={!cols}
            title={
              cols
                ? 'fog (G) — paint what the posse can see'
                : 'set the map width first — fog uses inch tiles'
            }
            aria-label="fog tool"
          >
            <span className={cols ? '' : 'opacity-30'}>🌫</span>
          </button>
          <button
            // Emoji ignore text colour, so an active toggle has to
            // change its background to read as on.
            className={toolBtn(snap && !!cols)}
            onClick={() => {
              const next = !snap;
              setSnap(next);
              localStorage.setItem(SNAP_PREF, next ? '1' : '0');
            }}
            disabled={!cols}
            title={
              cols
                ? snap
                  ? 'tokens snap to the grid (S) — hold ⌥ while dragging to place freely'
                  : 'tokens place freely (S) — turn on to snap them to the grid'
                : 'set the map width first — snapping needs inch tiles'
            }
            aria-label={snap ? 'snapping on' : 'snapping off'}
          >
            <span className={cols ? '' : 'opacity-30'}>🧲</span>
          </button>
          <button
            className={toolBtn(showGrid)}
            onClick={() => {
              mark();
              commit({
                ...draftRef.current,
                grid: { ...(draftRef.current.grid ?? {}), on: !showGrid },
              });
            }}
            title="this map's grid — the table shows the same lines"
            aria-label="toggle grid"
          >
            ▦
          </button>
        </div>

        {tool === 'fog' && (
          <div className={`flex flex-col gap-1 p-1 ${panel}`}>
            {(['reveal', 'cover'] as const).map((m) => (
              <button
                key={m}
                className={`rounded-lg px-1 py-2 text-[10px] leading-tight ${
                  fogBrush === m
                    ? 'bg-amber-700 text-stone-950'
                    : 'text-stone-300 hover:bg-stone-800'
                }`}
                onClick={() => setFogBrush(m)}
                aria-label={`fog brush ${m}`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

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
            <button
              className={`mt-1 flex h-9 w-11 items-center justify-center rounded-lg text-sm ${
                secret ? 'bg-amber-700' : 'hover:bg-stone-800'
              }`}
              onClick={() => setSecret(!secret)}
              aria-label={secret ? 'painting hidden' : 'painting visible'}
              title={
                secret
                  ? 'painting behind the screen — the table sees nothing'
                  : 'painting in the open — the table sees it immediately'
              }
            >
              {secret ? '🙈' : '👁'}
            </button>
          </div>
        )}
      </div>

      {/* ---------------- placement inspector ---------------- */}
      {selectedPlacement && (
        <div
          className={`absolute bottom-20 left-1/2 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${panel}`}
        >
          <span className="font-mono text-xs text-stone-300">
            {selectedPlacement.name ??
              placementNames?.get(selectedPlacement.blueprintId) ??
              'foe'}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-stone-600">
            starts here
          </span>
          <button
            className={`rounded-lg px-2.5 py-1.5 font-mono text-xs ${
              selectedPlacement.hidden
                ? 'bg-stone-800 text-amber-300'
                : 'bg-stone-800 text-stone-400'
            }`}
            title="behind the screen until you reveal it"
            onClick={() => {
              const next = placementsRef.current.map((p) =>
                p.id === selectedPlacement.id
                  ? { ...p, hidden: p.hidden ? undefined : true }
                  : p,
              );
              placementsRef.current = next;
              setPlacementDraft(next);
              onPlacements?.(next);
            }}
          >
            {selectedPlacement.hidden ? 'hidden' : 'in the open'}
          </button>
          <select
            className={input}
            value={selectedPlacement.sizeInches ?? 1}
            onChange={(e) => {
              const next = placementsRef.current.map((p) =>
                p.id === selectedPlacement.id
                  ? { ...p, sizeInches: Number(e.target.value) }
                  : p,
              );
              placementsRef.current = next;
              setPlacementDraft(next);
              onPlacements?.(next);
            }}
            aria-label="placement size"
          >
            {TOKEN_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}"
              </option>
            ))}
          </select>
          {/* Off the map, not out of the fight — it still deploys, just
              without a starting square. */}
          <button
            className="rounded-lg bg-stone-800 px-2.5 py-1.5 font-mono text-xs text-stone-400 hover:text-red-300"
            onClick={() => {
              const next = placementsRef.current.map((p) =>
                p.id === selectedPlacement.id
                  ? { ...p, u: undefined, v: undefined }
                  : p,
              );
              placementsRef.current = next;
              setPlacementDraft(next);
              onPlacements?.(next);
              setSelectedId(null);
            }}
          >
            off the map
          </button>
        </div>
      )}

      {/* ---------------- token inspector ---------------- */}
      {selected && (
        <div
          className={`absolute bottom-20 left-1/2 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 ${panel}`}
        >
          <button
            className={`rounded-lg px-2.5 py-1.5 font-mono text-xs ${
              selected.hidden
                ? 'bg-stone-800 text-amber-300'
                : 'bg-emerald-800/70 text-emerald-100'
            }`}
            onClick={() => {
              mark();
              setToken(selected.id, { hidden: selected.hidden ? undefined : true });
            }}
            aria-label={selected.hidden ? 'reveal to the table' : 'hide from the table'}
            title={
              selected.hidden
                ? 'behind the screen — tap to reveal it to the table'
                : 'the table can see this — tap to hide it'
            }
          >
            {selected.hidden ? '🙈 hidden' : '👁 shown'}
          </button>
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
          {/* Which fight, when this map stages more than one. With a
              single fight there is nothing to pick and the rail button
              already said which. */}
          {onArrange && arrangingId && (fights?.length ?? 0) > 1 && (
            <div className={`flex flex-wrap items-center gap-1.5 p-2 ${panel}`}>
              <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
                arranging
              </span>
              {fights!.map((f) => (
                <button
                  key={f.id}
                  className={`rounded-md px-2 py-1 text-xs ${
                    f.id === arrangingId
                      ? 'bg-amber-700 text-stone-950'
                      : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  }`}
                  onClick={() => onArrange(f.id)}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
          {/* Foes in this fight that aren't on the map yet. Opening the
              editor never places anything by itself — a map you only
              looked at shouldn't come away changed. Tap one and it
              lands at the middle of the frame, then you drag it. */}
          {onPlacements && placementDraft.some((p) => p.u === undefined) && (
            <div className={`flex max-w-md flex-wrap items-center gap-1.5 p-2 ${panel}`}>
              <span className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
                not placed
              </span>
              {placementDraft
                .filter((p) => p.u === undefined)
                .map((foe) => (
                  <button
                    key={foe.id}
                    className="rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-200 transition-colors hover:bg-stone-700"
                    onClick={() => {
                      const placed = snap
                        ? snapUv(view.cu, view.cv, foe.sizeInches ?? 1)
                        : { u: view.cu, v: view.cv };
                      const next = placementsRef.current.map((p) =>
                        p.id === foe.id ? { ...p, ...placed } : p,
                      );
                      placementsRef.current = next;
                      setPlacementDraft(next);
                      onPlacements(next);
                      setSelectedId(foe.id);
                    }}
                  >
                    {foe.name ?? placementNames?.get(foe.blueprintId) ?? 'foe'}
                  </button>
                ))}
            </div>
          )}
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

              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 font-mono text-xs uppercase tracking-wider text-stone-500">
                  grid
                </span>
                <div className="flex gap-1">
                  {GRID_COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`h-6 w-6 rounded border border-stone-700 ${
                        (draft.grid?.color ?? GRID_DEFAULTS.color) === c.value
                          ? 'ring-2 ring-stone-100'
                          : ''
                      }`}
                      style={{ backgroundColor: c.value }}
                      onClick={() =>
                        commit({
                          ...draftRef.current,
                          grid: {
                            ...(draftRef.current.grid ?? {}),
                            on: showGrid,
                            color: c.value,
                          },
                        })
                      }
                      aria-label={`grid colour ${c.label}`}
                      title={c.label}
                    />
                  ))}
                </div>
                <input
                  className="w-24 accent-amber-500"
                  type="range"
                  min={5}
                  max={80}
                  step={1}
                  value={Math.round(
                    (draft.grid?.opacity ?? GRID_DEFAULTS.opacity) * 100,
                  )}
                  onChange={(e) =>
                    commit({
                      ...draftRef.current,
                      grid: {
                        ...(draftRef.current.grid ?? {}),
                        on: showGrid,
                        opacity: Number(e.target.value) / 100,
                      },
                    })
                  }
                  aria-label="grid opacity"
                />
                <span className="font-mono text-xs text-stone-500">
                  {Math.round((draft.grid?.opacity ?? GRID_DEFAULTS.opacity) * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-24 font-mono text-xs uppercase tracking-wider text-stone-500">
                  start over
                </span>
                <button
                  className="rounded-lg px-2.5 py-1.5 font-mono text-xs text-stone-400 hover:bg-red-950 hover:text-red-300"
                  onClick={() => {
                    const counts = [
                      tokens.length && `${tokens.length} token${tokens.length > 1 ? 's' : ''}`,
                      (draft.zones ?? []).length &&
                        `${(draft.zones ?? []).length} ground layer${(draft.zones ?? []).length > 1 ? 's' : ''}`,
                      fog.on || regions.length ? 'fog' : '',
                    ].filter(Boolean);
                    if (!counts.length) return;
                    if (
                      !window.confirm(
                        `Clear ${counts.join(', ')} from “${draft.name}”? The map, its width and framing stay. (⌘Z undoes this.)`,
                      )
                    )
                      return;
                    mark();
                    commit({
                      ...draftRef.current,
                      tokens: [],
                      zones: [],
                      fog: undefined,
                    });
                    setRegionEditId(null);
                    setSelectedId(null);
                  }}
                  title="wipe tokens, painted ground and fog — the map itself stays"
                >
                  clear tokens, ground &amp; fog
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 font-mono text-xs uppercase tracking-wider text-stone-500">
                  table screen
                </span>
                {tableDisplay ? (
                  <>
                    <input
                      className={`${input} w-20`}
                      type="number"
                      placeholder={'width"'}
                      value={tvWidth}
                      onChange={(e) => setTvWidth(e.target.value)}
                      aria-label="measured picture width in inches"
                    />
                    <span className="font-mono text-xs text-stone-600">×</span>
                    <input
                      className={`${input} w-20`}
                      type="number"
                      placeholder={'height"'}
                      value={tvHeight}
                      onChange={(e) => setTvHeight(e.target.value)}
                      aria-label="measured picture height in inches"
                    />
                    <button
                      className="rounded-lg bg-stone-800 px-2.5 py-1.5 font-mono text-xs text-stone-300 hover:bg-stone-700"
                      disabled={!Number(tvWidth) || !Number(tvHeight)}
                      onClick={() => {
                        const { w, h } = tableDisplay;
                        const round = (n: number) => Math.round(n * 10) / 10;
                        onCalibrate?.(
                          round(w / Number(tvWidth)),
                          round(h / Number(tvHeight)),
                        );
                      }}
                      title={`the table reports ${tableDisplay.w}×${tableDisplay.h}px — measure the PICTURE it's drawing, edge to edge, and give both sides`}
                    >
                      calibrate
                    </button>
                    <button
                      className="rounded-lg bg-stone-800 px-2.5 py-1.5 font-mono text-xs text-stone-300 hover:bg-stone-700"
                      onClick={() => setCalibrating(true)}
                      title="match the table against a ruler or a jig — more accurate than measuring, and it checks for cropping first"
                    >
                      with a ruler…
                    </button>
                    <span className="font-mono text-xs text-stone-500">
                      {ppi
                        ? stretched
                          ? `${ppi.toFixed(1)} × ${(ppiY ?? ppi).toFixed(1)} px/in`
                          : `${ppi.toFixed(1)} px/in`
                        : 'not calibrated'}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-stone-600">
                    {table
                      ? 'waiting for that screen to report its size…'
                      : 'assign a screen to the table role to enable calibration'}
                  </span>
                )}
              </div>

              {/* Measure the picture, not the panel: overscan and
                  windowing make them differ, invisibly. */}
              <p className="pl-26 text-xs text-stone-600">
                Measure the image on the table screen itself, corner to corner
                of the picture — not the bezel, not the box's size.
              </p>
              {stretched && (
                <p className="pl-26 text-xs text-amber-500/80">
                  Those axes disagree by{' '}
                  {Math.round(Math.abs((ppiY ?? 0) / (ppi ?? 1) - 1) * 100)}% — the
                  table is stretching the picture. teller will draw true inches
                  correctly anyway, but the TV's aspect/zoom setting is worth a
                  look.
                </p>
              )}

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
          {showFog && (
            <div className={`w-72 space-y-2 p-3 ${panel}`}>
              <div className="flex items-center gap-2">
                <button
                  className={`rounded-lg px-2.5 py-1.5 font-mono text-xs ${
                    fog.on
                      ? 'bg-amber-700 text-stone-950'
                      : 'bg-stone-800 text-stone-300'
                  }`}
                  onClick={() => {
                    mark();
                    setFog({ on: !fog.on });
                  }}
                  title={
                    fog.on ? 'lift the fog entirely' : 'cover the map with fog'
                  }
                >
                  {fog.on ? 'fog on' : 'fog off'}
                </button>
                <button
                  className="rounded-lg bg-stone-800 px-2.5 py-1.5 font-mono text-xs text-stone-300 hover:bg-stone-700"
                  onClick={() => {
                    mark();
                    setFog({
                      on: true,
                      revealed: [],
                      regions: regions.map((r) => ({ ...r, revealed: false })),
                    });
                  }}
                  title="hide everything again"
                >
                  cover all
                </button>
                <button
                  className={`rounded-lg px-2.5 py-1.5 font-mono text-xs ${
                    showAreas
                      ? 'bg-stone-700 text-stone-100'
                      : 'bg-stone-800 text-stone-400'
                  }`}
                  onClick={() => {
                    const next = !showAreas;
                    setShowAreas(next);
                    localStorage.setItem(AREAS_PREF, next ? '1' : '0');
                  }}
                  title="outline your areas on the map whatever tool you're using (console only)"
                >
                  areas
                </button>
                <button
                  className="ml-auto rounded-lg px-2 py-1.5 font-mono text-xs text-amber-300 hover:bg-stone-800"
                  onClick={addRegion}
                  title="paint a new area you can reveal in one tap"
                >
                  + area
                </button>
              </div>

              {regions.length === 0 ? (
                <p className="text-xs leading-snug text-stone-600">
                  paint freeform with the fog tool, or make an “area” for a room
                  you'll reveal in one tap when the posse walks in
                </p>
              ) : (
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {regions.map((region) => (
                    <div key={region.id} className="flex items-center gap-1">
                      <button
                        className={`rounded px-2 py-1 text-xs ${
                          region.revealed
                            ? 'bg-emerald-800/70 text-emerald-100'
                            : 'bg-stone-800 text-stone-400'
                        }`}
                        onClick={() => {
                          mark();
                          setFog({
                            regions: regions.map((r) =>
                              r.id === region.id
                                ? { ...r, revealed: !r.revealed }
                                : r,
                            ),
                          });
                        }}
                        title={
                          region.revealed
                            ? 'the table can see this area — tap to hide it again'
                            : 'reveal this area to the table'
                        }
                      >
                        {region.revealed ? 'shown' : 'hidden'}
                      </button>
                      <input
                        className="min-w-0 flex-1 bg-transparent text-sm text-stone-200 focus:outline-none"
                        value={region.name}
                        onChange={(e) =>
                          setFog({
                            regions: regions.map((r) =>
                              r.id === region.id
                                ? { ...r, name: e.target.value }
                                : r,
                            ),
                          })
                        }
                        aria-label={`area name ${region.name}`}
                      />
                      <span className="shrink-0 font-mono text-[10px] text-stone-600">
                        {region.cells.length}
                      </span>
                      <button
                        className={`rounded px-1.5 py-1 text-xs ${
                          regionEditId === region.id
                            ? 'bg-amber-700 text-stone-950'
                            : 'text-stone-500 hover:bg-stone-800'
                        }`}
                        onClick={() => {
                          setRegionEditId(
                            regionEditId === region.id ? null : region.id,
                          );
                          setTool('fog');
                        }}
                        title="shape this area — paint its tiles"
                        aria-label={`shape ${region.name}`}
                      >
                        ✎
                      </button>
                      <button
                        className="rounded px-1.5 py-1 text-xs text-stone-500 hover:bg-red-950 hover:text-red-300"
                        onClick={() => {
                          mark();
                          if (regionEditId === region.id) setRegionEditId(null);
                          setFog({
                            regions: regions.filter((r) => r.id !== region.id),
                          });
                        }}
                        aria-label={`delete ${region.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {showZones && (
            <div className={`w-72 space-y-1 p-3 ${panel}`}>
              {(draft.zones ?? []).length === 0 ? (
                <p className="text-xs leading-snug text-stone-600">
                  nothing painted yet — use the 🖌 tool to lay down fire, oil,
                  smoke and the rest
                </p>
              ) : (
                (draft.zones ?? []).map((zone, i) => (
                  <div
                    key={zone.id ?? i}
                    className={`flex items-center gap-2 rounded px-1 ${
                      zoneEditId === zone.id ? 'bg-stone-800/70' : ''
                    }`}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded"
                      style={{ backgroundColor: zoneBase(zone.effect).fill }}
                    />
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm text-stone-200 hover:text-amber-300"
                      onClick={() => {
                        // pick this layer up with the brush
                        setBrush(zone.effect);
                        setSecret(!!zone.hidden);
                        setZoneEditId(zone.id ?? null);
                        setTool('paint');
                      }}
                      title="paint into this layer"
                    >
                      {zone.effect}
                      {(draft.zones ?? []).filter((z) => z.effect === zone.effect)
                        .length > 1 && (
                        <span className="text-stone-500">
                          {' '}
                          {(draft.zones ?? [])
                            .filter((z) => z.effect === zone.effect)
                            .indexOf(zone) + 1}
                        </span>
                      )}
                    </button>
                    <span className="shrink-0 font-mono text-[10px] text-stone-600">
                      {zone.cells.length}
                    </span>
                    <button
                      className={`shrink-0 rounded px-2 py-1 text-xs ${
                        zone.hidden
                          ? 'bg-stone-800 text-amber-300'
                          : 'bg-emerald-800/70 text-emerald-100'
                      }`}
                      onClick={() => {
                        mark();
                        if (zone.id) toggleZoneHidden(zone.id);
                      }}
                      title={
                        zone.hidden
                          ? 'behind the screen — tap to reveal to the table'
                          : 'the table can see this — tap to hide it'
                      }
                      aria-label={`${zone.hidden ? 'reveal' : 'hide'} ${zone.effect}`}
                    >
                      {zone.hidden ? 'hidden' : 'shown'}
                    </button>
                    <button
                      className="shrink-0 rounded px-1.5 py-1 text-xs text-stone-500 hover:bg-red-950 hover:text-red-300"
                      onClick={() => {
                        mark();
                        if (zoneEditId === zone.id) setZoneEditId(null);
                        if (zone.id) deleteZone(zone.id);
                      }}
                      aria-label={`delete ${zone.effect}${zone.hidden ? ' hidden' : ''} layer`}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              className={`px-3 py-2 font-mono text-xs text-stone-300 ${panel}`}
              onClick={() => setShowScene(!showScene)}
            >
              scene {showScene ? '▾' : '▸'}
            </button>
            <button
              className={`px-3 py-2 font-mono text-xs text-stone-300 ${panel}`}
              onClick={() => setShowZones(!showZones)}
            >
              ground · {(draft.zones ?? []).length} {showZones ? '▾' : '▸'}
            </button>
            <button
              className={`px-3 py-2 font-mono text-xs ${panel} ${
                fog.on ? 'text-amber-300' : 'text-stone-300'
              }`}
              onClick={() => setShowFog(!showFog)}
            >
              fog{fog.on ? ' · on' : ''} {showFog ? '▾' : '▸'}
            </button>
          </div>
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          {showTokens && (
            <div className={`max-h-64 w-56 overflow-y-auto p-2 ${panel}`}>
              {tokens.length === 0 && (
                <p className="px-1 py-2 text-xs text-stone-600">no tokens on this map</p>
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
                  <span className={`truncate ${t.hidden ? 'italic' : ''}`}>
                    {t.label}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-stone-600">
                    {t.hidden ? '🙈' : `${t.sizeInches}"`}
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
        {tool === 'fog'
          ? editingRegion
            ? `shaping “${editingRegion.name}” — drag to add tiles, tap one to remove · done when its outline looks right`
            : `drag to ${fogBrush} fog${
                fog.on ? '' : ' · fog is OFF — turn it on in the fog panel to show it'
              } · make an area to reveal a whole room at once`
          : tool === 'paint'
          ? `drag to paint ${brush}${secret ? ' behind the screen' : ''} · tap a painted tile to erase`
          : tool === 'pan'
            ? 'drag to move your view · scroll to zoom'
            : tool === 'frame'
              ? view.locked
                ? 'framing is locked — tap 🔒 to allow re-aiming'
                : view.mode === 'true'
                  ? 'drag to aim the amber frame — this moves what the table shows'
                  : 'table is showing the whole map — switch to true scale in scene settings'
              : `drag tokens to place${
                  snap && cols ? ' (snapping to the grid — hold ⌥ for free)' : ''
                } · drag the map to move your view · framing is safe`}
        {combatRunning && ' · combat running'}
      </p>
    </div>
  );
}

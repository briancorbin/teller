// The rung-4 public API (§E UN-DEFERRED): panel code's `import … from
// 'teller'` resolves here via the import map. This IS the promotion the
// ladder described as happening "deliberately, later" — later is now,
// and the seam freezes as it stands: whatever this file exports is what
// a custom block or takeover may touch. Nothing else in client/ is
// reachable from panel code (it's built external — panels-shelf.ts's
// `EXTERNAL` — so nothing but these three specifiers even resolves).
//
// Riding the SAME rollup build as the app (see runtime/react.ts) also
// means this file's own imports (React components, `api`, `useLive`, …)
// are the app's own instances — no second copy of anything here either.

// -- the ui grammar (className tokens; client/lib/ui.ts) --------------------
export * from '../lib/ui.ts';

// -- api + live data ----------------------------------------------------------
export { api, fileUrl } from '../lib/api.ts';
export { useLive } from '../lib/use-session.ts';

// The two declaration readers every standard sheet block already uses:
// the pack's caption under a heading, and its rule text by name. A
// custom block that couldn't reach these could not reproduce the sheet
// it's replacing a piece of — the captions ARE the sheet.
export { usePanelNote, useRuleLookup } from '../lib/rules.ts';

// -- ported primitives ----------------------------------------------------------
export { VitalBar, CounterStepper } from '../components/Vitals.tsx';
export { TagSection } from '../components/TagSection.tsx';
export { BigGauge, LedgerRow, SkillRow } from '../components/Counters.tsx';
export { ClockFace } from '../components/ClockFace.tsx';
export { DicePool } from '../components/DicePool.tsx';
export { SheetPanel } from '../components/sheet/SheetPanel.tsx';
export { HealthPanel } from '../components/sheet/HealthPanel.tsx';
export { SheetGauge } from '../components/sheet/SheetGauge.tsx';
export { StatusPanel } from '../components/sheet/StatusPanel.tsx';
export { Cylinder } from '../components/sheet/Cylinder.tsx';
export { ItemTile } from '../components/items/ItemTile.tsx';
export { CarriedScreen } from '../components/items/Screen.tsx';
export * from '../components/items/Track.tsx';
export * from '../components/items/Purse.tsx';

// -- the blocks helpers already exported from panels/blocks.tsx --------------
export { entriesOf, entryNamed, accentOf, dialOf, pinsOf, shaped } from '../panels/blocks.tsx';

// -- the render seam (client/panels/render.tsx) ------------------------------
export { registerBlock, Refusal, RenderBlock, PanelSurface } from '../panels/render.tsx';
export type { BlockCtx, Glass, CustomBlockComponent, TakeoverComponent } from '../panels/render.tsx';

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
export { usePanelNote, useRuleLookup, useRuleSections } from '../lib/rules.ts';
export type { RuleEntry, RuleHit, RuleSection } from '../lib/rules.ts';

// -- the neutral floor (§L: shape-derived, no system's vocabulary) -----------
// A bar for anything with a ceiling, a stepper for anything you count, a
// chip for anything you either have or don't, a ledger line, a clock, and
// the plate chrome every block on a printed sheet wears. Nothing here
// knows a game — which is exactly the test for whether it belongs.
export { VitalBar, CounterStepper } from '../components/Vitals.tsx';
export { TagSection } from '../components/TagSection.tsx';
export { BigGauge, LedgerRow, SkillRow } from '../components/Counters.tsx';
export { ClockFace } from '../components/ClockFace.tsx';
export { SheetPanel } from '../components/sheet/SheetPanel.tsx';
export { SheetGauge } from '../components/sheet/SheetGauge.tsx';

// A system's dice, as DATA (§J) — the pool spelling, the tally, and the
// throw teller is allowed to make for foes. Neutral for the same reason
// the `dice` record is: the faces and what they're worth both arrive
// from the system, so nothing here knows a B from a G.
export { expandPool, isPool, rollPool, tallyFaces } from '../lib/dice.ts';
export type { DiceRecord } from '../lib/dice.ts';

// -- declared advancement, interpreted (core/effects.ts) --------------------
// A system's `spends` menu turned into ordinary writes: what a purchase
// costs, what it would change, and what it can't do said out loud. Pure
// declaration-reading — it never names a counter, a rung or a tier, so a
// pack's own `SpendMenu` composes its LOOK on top of teller's arithmetic
// rather than reimplementing the arithmetic to get the look.
export {
  affordable,
  amendPool,
  costWrites,
  describeEffect,
  isRefusal,
  locate,
  needsChoice,
  spendOptions,
  tierAt,
  toSpends,
} from '../../core/effects.ts';
export type {
  EntryWrite,
  SpendEffect,
  SpendItem,
  SpendOption,
  SpendPlan,
  SpendTier,
  SpendWorld,
  SpendsDecl,
  StampWrite,
} from '../../core/effects.ts';

// The two floors those declarations fall to, exported so a pack's own
// face can wrap, extend or fall back to one instead of starting from a
// blank div — and so its props type IS the contract it must satisfy.
export { SpendFloor } from '../components/SpendFloor.tsx';
export type { SpendMenuProps } from '../components/SpendFloor.tsx';
export { LadderFloor, ladderList, toLadder } from '../components/LadderFloor.tsx';
export type { LadderDecl, LadderPanelProps, LadderStep } from '../components/LadderFloor.tsx';

// The entity leaf helpers a face needs to read what it was handed.
export { findEntry, formatEntry, numberOf, sameName } from '../../core/entity.ts';
export type { Entity, Entry, Ref } from '../../core/entity.ts';

// -- the summoning seam (§L phase 3) -----------------------------------------
// What draws a face called X — the active system's presentations first,
// teller's demoted copies second, `undefined` third. Panel code that
// wants a system's own vocabulary should `import { … } from 'system'`
// directly; this is for code that must survive not finding it.
export { presentationOf, suppliedPresentations } from '../lib/presentations.ts';

// -- DEPRECATED: system vocabulary, still exported so nothing breaks ---------
// §L phase 3 moved these four into the WiW pack
// (`packs/<name>/presentations/*.tsx`). They are **not teller's** — a
// HealthPanel is one printed sheet's health box, a Cylinder is a
// revolver, a StatusPanel is severity boxes with relief captions, a
// DicePool is B and G dice — and they remain here only as the fallback
// under the migration (`FALLBACK_PRESENTATIONS`, client/lib/presentations.ts).
//
// **Panel code should import these from `'system'`, not from `'teller'`.**
// A panel that reaches for them here gets whatever teller happened to
// ship rather than what the system it's arranging actually prints, which
// is the conflation §L exists to end. They go when the fallback map does.
export { DicePool } from '../components/DicePool.tsx';
export { HealthPanel } from '../components/sheet/HealthPanel.tsx';
export { StatusPanel } from '../components/sheet/StatusPanel.tsx';
export { Cylinder } from '../components/sheet/Cylinder.tsx';

// -- items (§K furniture) ---------------------------------------------------
export { ItemTile } from '../components/items/ItemTile.tsx';
export { CarriedScreen } from '../components/items/Screen.tsx';
export * from '../components/items/Track.tsx';
export * from '../components/items/Purse.tsx';

// -- the blocks helpers already exported from panels/blocks.tsx --------------
export { entriesOf, entryNamed, accentOf, dialOf, pinsOf, shaped } from '../panels/blocks.tsx';

// -- the render seam (client/panels/render.tsx) ------------------------------
export { registerBlock, Refusal, RenderBlock, PanelSurface } from '../panels/render.tsx';
export type { BlockCtx, Glass, CustomBlockComponent, TakeoverComponent } from '../panels/render.tsx';

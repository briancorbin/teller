// The summoning seam (§L phase 3) — one place that answers "what draws
// a thing called X?", and one resolution order for every caller.
//
// §L's settlement: **data-generic was conflated with belongs-to-teller.**
// A component parameterized by records is still VOCABULARY — HealthPanel
// is the WiW printed sheet's health box, the Cylinder is a revolver —
// and vocabulary lives on the SYSTEM layer, shipped as pack-carried code
// (`packs/<name>/presentations/*.tsx`, compiled by the same sweep, gated
// by the same trust row). teller keeps the neutral floor: bars,
// steppers, chips, ledger rows, the plate chrome.
//
// So a face is SUMMONED BY NAME, exactly as `dials`/`pins` already
// summon by name, and resolution is the same later-wins stack as
// everything else, one rung shorter:
//
//   1. the active system's presentations (`import * as system`)
//   2. teller's own fallback registry, below
//   3. nothing — and the caller falls to its neutral rendering
//
// Step 3 is the point of the whole exercise: a system with no code of
// its own still plays, and every caller of `presentationOf` must have an
// answer for `undefined` that a table could sit down at. A face is
// dressing; the stored value is the sheet.

import * as system from 'system';
import { Cylinder } from '../components/sheet/Cylinder.tsx';
import { HealthPanel } from '../components/sheet/HealthPanel.tsx';
import { StatusPanel } from '../components/sheet/StatusPanel.tsx';
import { DicePool } from '../components/DicePool.tsx';

/**
 * teller's own copies of the four faces the WiW pack now carries —
 * step 2 of the ladder above, and a DEMOTION, not a home.
 *
 * §L phase 3 moved these components into the pack; this map is the
 * transitional floor under that move, so a host whose pack is untrusted,
 * absent or mid-edit renders the sheet it rendered yesterday instead of
 * degrading on a day nobody asked it to. Emptying it is phase 3.5 — the
 * one-line change that makes "other systems don't all have vitals" true
 * in the code rather than only in the doc, and the reason every consumer
 * below is written to survive `undefined` TODAY.
 *
 * Nothing new belongs in here. A face teller genuinely owns is a neutral
 * primitive with a plain import, not a name someone has to summon.
 */
export const FALLBACK_PRESENTATIONS: Record<string, unknown> = {
  Cylinder,
  HealthPanel,
  StatusPanel,
  DicePool,
};

/** '/pack-code/system.js' as a namespace — `any`, by declaration (client/system.d.ts). */
const supplied = system as Record<string, unknown>;

/**
 * The face named `name`, or `undefined` if nobody supplies one.
 *
 * A `dials` value is a lowercase noun the way a person writes it
 * (`"cylinder"`, `"cards"`); a presentation FILE is named for its export
 * and so is a JS identifier (`Cylinder.tsx`). Rather than making packs
 * choose, both spellings resolve: the exact name first, then the same
 * word capitalized. Nothing else is inferred — a record saying `"cards"`
 * on a host whose pack ships no `Cards.tsx` gets `undefined`, and the
 * caller draws the floor.
 */
export function presentationOf<T = unknown>(name: string): T | undefined {
  const word = name.trim();
  if (!word) return undefined;
  const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
  const hit =
    supplied[word] ??
    supplied[capitalized] ??
    FALLBACK_PRESENTATIONS[word] ??
    FALLBACK_PRESENTATIONS[capitalized];
  return hit as T | undefined;
}

/** Which names the active system actually supplied — the console's business to say out loud. */
export function suppliedPresentations(): string[] {
  return Object.keys(supplied).sort();
}

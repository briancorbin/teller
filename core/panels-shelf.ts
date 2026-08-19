// How the standard panels reach disk, and how the sweep reads them back
// — §E extended again (2026-08-18): "the defaults are `.panel` files
// too, and a panel owns its assets." Split out of `panels.ts` on
// purpose: that file is type-imported straight from `client/` (the
// renderer wants `PanelDef`/`PanelBlock`), so it stays free of
// `node:fs`. This module is the Node-only half — server-side only,
// same split as `plugins.ts` (discovery) vs the shelf it discovers.
//
// Two acts, mirroring the plugin sweep:
//
//   * SEED (`seedPanels`) writes every standard panel to its own folder
//     the first time this host sees it — seed-if-absent, the
//     `seedSystems` posture (rule 1 for files): a folder that already
//     exists, because it was seeded before or duplicated by hand, is
//     never touched, so an edit survives every boot and every upgrade.
//   * SWEEP (`sweepPanels`) reads `<dataDir>/panels/*/panel.json` back
//     as the teller base layer `boot.ts` stacks BELOW system, pack and
//     campaign. Writes nothing, exactly like `discoverPlugins`; a
//     folder that fails to parse is a problem in the report, never a
//     crash, and never blocks the rest of the shelf.
//
// A duplicated folder — copy `sheet/` to `my-sheet/`, edit `name`
// inside — just works: it's another file the sweep finds, and the NAME
// (not the folder, not the minted id) is still the merge key.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from './id.ts';
import { STANDARD_PANELS, toPanel, type PanelDef } from './panels.ts';

/** A folder that didn't parse — reported, never a crash (like a broken plugin or pack). */
export type PanelProblem = { dir: string; problem: string };

/**
 * Seed-if-absent: write every standard panel to its own folder, minting
 * a `pan_` id once at seed time and baking it in. Never overwrites a
 * folder that's already there.
 */
export function seedPanels(dataDir: string): void {
  const root = join(dataDir, 'panels');
  for (const panel of STANDARD_PANELS) {
    const dir = join(root, panel.name);
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true });
    const seeded: PanelDef = { ...panel, id: newId('pan') };
    writeFileSync(join(dir, 'panel.json'), `${JSON.stringify(seeded, null, 2)}\n`);
  }
}

/**
 * Every `panels/*\/panel.json` on the shelf, read back in folder-name
 * order. No `panels/` directory yet (a fresh shelf, a test's scratch
 * dir) is just an empty shelf — not a problem, mirroring
 * `discoverPlugins`'s missing-folder case.
 */
export function sweepPanels(
  dataDir: string,
): { panels: PanelDef[]; problems: PanelProblem[] } {
  const panels: PanelDef[] = [];
  const problems: PanelProblem[] = [];
  const root = join(dataDir, 'panels');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { panels, problems };
  }
  for (const name of names.sort()) {
    const dir = join(root, name);
    const path = join(dir, 'panel.json');
    if (!existsSync(path)) continue;
    let panel: PanelDef | undefined;
    try {
      panel = toPanel(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      panel = undefined;
    }
    if (!panel) {
      problems.push({ dir, problem: 'panel.json is not a panel (needs a name)' });
      continue;
    }
    panels.push(panel);
  }
  return { panels, problems };
}

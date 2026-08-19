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
//
// UN-DEFERRED (§E, 2026-08-19): a panel folder may also carry
// `blocks/*.tsx` (custom blocks), `panel.tsx` (a takeover) and
// `style.css` — rungs 3-5 of the ladder. The sweep compiles what it
// finds with esbuild into `<folder>/.build/`, mtime-gated so an
// untouched folder costs nothing on the next boot. A compile error is a
// `PanelProblem`, exactly like a `panel.json` that doesn't parse — the
// panel's DECLARATION still loads, just without its code.
//
// Code is gated by TRUST, data is not (§E's "code needs the trust gate;
// data doesn't"): `code` is attached to the returned `PanelDef` only
// when `shelf.pluginTrust(panel.id)?.enabled` — reusing §15's plugin
// trust table verbatim rather than inventing a second one, because a
// trust row is a trust row regardless of what kind of id it names. An
// untrusted code-carrying panel gets `codePending: true` instead, so
// the client can say so rather than silently rendering as if the code
// didn't exist.
//
// Whose trust is implicit: teller's OWN seeded panels. The simplest
// honest mechanism available — no new marker file, no new column — is
// to write the trust row at the moment `seedPanels` mints the panel's
// id, which happens exactly once per panel, ever (seed-if-absent, same
// guard as the folder write). A later human `disable` is a stored value
// and wins forever after (rule 1); this only ever fires on first seed.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { buildOne, compileFolder, newerThan, PANEL_IMPORTS } from './compile.ts';
import { newId } from './id.ts';
import { STANDARD_PANELS, toPanel, type PanelDef } from './panels.ts';
import type { Shelf } from './store.ts';

/** A folder that didn't parse, or a source that didn't compile — reported, never a crash. */
export type PanelProblem = { dir: string; problem: string };

// The rung-4 public API (§E UN-DEFERRED): a custom block or a takeover
// imports the bare specifiers in `PANEL_IMPORTS` and nothing else
// resolves through the bundle — the client serves them via an import
// map, so marking them external is what keeps the compiled output tiny
// and lets the client supply its own copies at runtime. `system` joined
// that list in §L phase 2: panel code consumes the active system's
// pack-supplied presentations by the same seam.

/**
 * Seed-if-absent: write every standard panel to its own folder, minting
 * a `pan_` id once at seed time and baking it in. Never overwrites a
 * folder that's already there.
 *
 * `shelf`, when given, also writes a trust row for the freshly minted
 * id — the mechanism that makes a shipped default's code trusted
 * without a ceremony (§E: "not a ceremony for your own hands"). It only
 * ever fires the moment a folder is first written, so it can never
 * overwrite a human's later `disable`.
 */
export function seedPanels(dataDir: string, shelf?: Shelf): void {
  const root = join(dataDir, 'panels');
  for (const panel of STANDARD_PANELS) {
    const dir = join(root, panel.name);
    if (existsSync(dir)) continue;
    mkdirSync(dir, { recursive: true });
    const id = newId('pan');
    const seeded: PanelDef = { ...panel, id };
    writeFileSync(join(dir, 'panel.json'), `${JSON.stringify(seeded, null, 2)}\n`);
    shelf?.setPluginEnabled(id, true);
  }
}

/**
 * Compile one panel folder's code (`blocks/*.tsx`, `panel.tsx`,
 * `style.css`) into `<dir>/.build/`, skipping anything whose output is
 * already newer than its source. Returns the URLs the client should be
 * given — trust is decided by the caller, not here, so this function
 * runs unconditionally and reports what it found regardless of who
 * eventually gets to see it.
 */
export function compilePanelCode(
  dir: string,
  panelId: string | undefined,
): { code?: NonNullable<PanelDef['code']>; problems: string[] } {
  const blocksDir = join(dir, 'blocks');
  const takeoverPath = join(dir, 'panel.tsx');
  const stylePath = join(dir, 'style.css');
  const hasBlocks = existsSync(blocksDir);
  const hasTakeover = existsSync(takeoverPath);
  const hasStyle = existsSync(stylePath);
  if (!hasBlocks && !hasTakeover && !hasStyle) return { problems: [] };

  const problems: string[] = [];
  if (!panelId) {
    problems.push('carries code but has no pan_ id — cannot compile or serve it');
    return { problems };
  }

  const buildRoot = join(dir, '.build');
  const code: NonNullable<PanelDef['code']> = {};

  if (hasBlocks) {
    const { built, problems: blockProblems } = compileFolder(
      blocksDir,
      join(buildRoot, 'blocks'),
      PANEL_IMPORTS,
    );
    for (const { file, problem } of blockProblems) problems.push(`blocks/${file}: ${problem}`);
    const blocks: Record<string, string> = {};
    for (const name of built) blocks[name] = `/panel-code/${panelId}/blocks/${name}.js`;
    if (Object.keys(blocks).length) code.blocks = blocks;
  }

  if (hasTakeover) {
    const out = join(buildRoot, 'panel.js');
    if (newerThan(takeoverPath, out)) {
      const err = buildOne(takeoverPath, out, PANEL_IMPORTS);
      if (err) problems.push(`panel.tsx: ${err}`);
    }
    if (existsSync(out)) code.takeover = `/panel-code/${panelId}/panel.js`;
  }

  if (hasStyle) {
    const out = join(buildRoot, 'style.css');
    if (newerThan(stylePath, out)) {
      try {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, readFileSync(stylePath));
      } catch (err) {
        problems.push(`style.css: ${String(err)}`);
      }
    }
    if (existsSync(out)) code.style = `/panel-code/${panelId}/style.css`;
  }

  return { code: Object.keys(code).length ? code : undefined, problems };
}

/**
 * Every `panels/*\/panel.json` on the shelf, read back in folder-name
 * order, code compiled and trust-gated. No `panels/` directory yet (a
 * fresh shelf, a test's scratch dir) is just an empty shelf — not a
 * problem, mirroring `discoverPlugins`'s missing-folder case.
 *
 * `shelf`, when given, is consulted for trust (§15's own table). With
 * no shelf a code-carrying panel still compiles — the report stays
 * honest — but never gets attached, the same fail-closed default
 * `discoverPlugins` uses for `enabled`.
 */
export function sweepPanels(
  dataDir: string,
  shelf?: Shelf,
): { panels: PanelDef[]; problems: PanelProblem[] } {
  return sweepPanelsIn(join(dataDir, 'panels'), shelf);
}

/**
 * The sweep itself, over ANY folder of panel folders. The table's own
 * `<dataDir>/panels/` is one such root; a system folder's
 * `systems/<name>/panels/` is another (§M — "a system ships PANELS,
 * functional and unbranded"). Same format, same compile, same trust
 * row, so it is one function with the root passed in rather than a
 * second copy that drifts.
 */
export function sweepPanelsIn(
  root: string,
  shelf?: Shelf,
): { panels: PanelDef[]; problems: PanelProblem[] } {
  const panels: PanelDef[] = [];
  const problems: PanelProblem[] = [];
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
    const { code, problems: compileProblems } = compilePanelCode(dir, panel.id);
    for (const problem of compileProblems) problems.push({ dir, problem });
    if (code) {
      if (shelf?.pluginTrust(panel.id ?? '')?.enabled) {
        panel.code = code;
      } else {
        panel.codePending = true;
      }
    }
    panels.push(panel);
  }
  return { panels, problems };
}

/**
 * Which folder holds a panel's compiled output, for the server's
 * `/panel-code/<pan_id>/…` route to resolve. A small linear scan over
 * `panel.json`s — the shelf holds a handful of panels, not thousands.
 */
export function panelDir(dataDir: string, panelId: string): string | undefined {
  return panelDirIn(join(dataDir, 'panels'), panelId);
}

/** The same lookup over any root of panel folders — a system's `panels/` too (§M). */
export function panelDirIn(root: string, panelId: string): string | undefined {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names) {
    const dir = join(root, name);
    const path = join(dir, 'panel.json');
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { id?: unknown };
      if (raw && typeof raw === 'object' && raw.id === panelId) return dir;
    } catch {
      // a broken panel.json is sweepPanels's problem to report, not this lookup's
    }
  }
  return undefined;
}

// How the standard panels reach disk, and how the sweep reads them back
// — §E extended again (2026-08-18): "the defaults are `.panel` files
// too, and a panel owns its assets." Split out of `panels.ts` on
// purpose: that file is type-imported straight from `client/` (the
// renderer wants `PanelDef`/`PanelBlock`), so it stays free of
// `node:fs`. This module is the Node-only half — server-side only,
// same split as `plugins.ts` (discovery) vs the shelf it discovers.
//
// Two sweeps, and NO seeding (2026-08-19, the first of §M-6's two
// wrinkles fixed). teller's defaults ship WITH teller — real `.panel`
// folders in the install's `defaults/panels/`, read where they lie —
// so the data dir's `panels/` is the TABLE's own and teller never
// writes a byte into it:
//
//   * DEFAULTS (`defaultPanels`) reads the five folders teller ships,
//     resolved against this module's own location rather than any cwd
//     or data dir. They are the FLOOR of the panels merge, source
//     `teller`, and their `pan_` ids are baked into the files so they
//     are stable across hosts and upgrades — nothing is minted at boot
//     any more, so nothing can be reminted.
//   * SWEEP (`sweepPanels`) reads `<dataDir>/panels/*/panel.json` as
//     the TABLE's layer, which `boot.ts` stacks ABOVE everything —
//     system, packs, campaign — because the table's ruling beats the
//     book's (rule 1). Writes nothing, exactly like `discoverPlugins`;
//     a folder that fails to parse is a problem in the report, never a
//     crash, and never blocks the rest of the shelf.
//
// What died with the seeding: a deleted default used to come back on
// the next boot, and an edited one lived only on the host that edited
// it. Now a table that wants a different `log` writes its own
// `panels/log/panel.json` and wins by restating the name — the same
// override every other layer uses — and deleting that folder falls
// back to teller's, instead of resurrecting a copy.
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
// teller's shipped defaults carry no code today — they are five tool
// declarations and nothing else — so nothing about them needs trusting.
// If one ever grows a block, it takes the same route every other
// code-carrying panel takes: a human enables it.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOne, compileFolder, newerThan, PANEL_IMPORTS } from './compile.ts';
import { toPanel, type PanelDef } from './panels.ts';
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
 * Where teller's own `.panel` folders live in THIS install. Resolved
 * against this module's URL and then walked upward, so it holds
 * whether the server runs unbundled from the repo (`core/` beside
 * `defaults/`) or from a build directory a level or two down. Never
 * relative to cwd, and never inside anyone's data dir.
 */
export function defaultsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let up = 0; up < 5; up += 1) {
    const candidate = join(dir, 'defaults', 'panels');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(here, '..', 'defaults', 'panels');
}

/**
 * The panels teller ships: `defaults/panels/*\/panel.json`, read where
 * they lie. The FLOOR of the merge (`boot.ts` stacks them under
 * everything), with ids baked into the files rather than minted, so
 * every host names the same panel the same way.
 *
 * Read once and cached — the install's own files don't change under a
 * running server, and boot asks for them on every campaign load.
 */
let cachedDefaults: PanelDef[] | undefined;
export function defaultPanels(): PanelDef[] {
  if (!cachedDefaults) cachedDefaults = sweepPanelsIn(defaultsRoot()).panels;
  return cachedDefaults;
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
 * Every `panels/*\/panel.json` on the TABLE's shelf, read back in
 * folder-name order, code compiled and trust-gated. No `panels/`
 * directory (the ordinary case now that nothing seeds one) is just an
 * empty layer — not a problem, mirroring `discoverPlugins`'s
 * missing-folder case.
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

/** The same lookup over teller's shipped defaults, for a default that grows code. */
export function defaultPanelDir(panelId: string): string | undefined {
  return panelDirIn(defaultsRoot(), panelId);
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

// The one esbuild pass, shared by both shelves that carry code.
//
// A `.panel` folder compiles `blocks/*.tsx` (§E UN-DEFERRED) and a pack
// folder compiles `presentations/*.tsx` (§L phase 2). Same sweep, same
// esbuild, same mtime gate, same "a compile error is a report problem,
// never a crash" posture — so it is one helper, extracted here rather
// than a second copy in `packs-shelf.ts`. Node-only, like both callers.
//
// **What a file may import is the only thing that differs**, and the
// difference is load-bearing:
//
//   * `PANEL_IMPORTS` — react, react/jsx-runtime, teller, AND `system`.
//     Panel code is a CONSUMER of the active system's presentations
//     (§L: "panels compose from the system's vocabulary plus teller's
//     primitives").
//   * `PACK_IMPORTS` — the three neutral ones only. A pack presentation
//     may NOT import `system`, because it IS the system: the cycle
//     would be incoherent. Leaving `system` out of the externals is the
//     enforcement — esbuild fails the compile with "Could not resolve
//     "system"", which lands in the load report as an ordinary problem
//     the author can read.
//
// Anything else a file imports gets BUNDLED into its output (a helper
// beside it, a dependency it vendored) — externals are the seam the
// client's import map answers, not a whitelist of the whole language.

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

/** The bare specifiers `client/index.html`'s import map answers for everyone. */
export const NEUTRAL_IMPORTS = ['react', 'react/jsx-runtime', 'teller'];

/** What panel code may import — the neutral three plus the active system. */
export const PANEL_IMPORTS = [...NEUTRAL_IMPORTS, 'system'];

/** What a pack's own presentations may import — the neutral three, and no `system`. */
export const PACK_IMPORTS = NEUTRAL_IMPORTS;

/**
 * What a PLUGIN's pane code may import — the same four as a panel's.
 *
 * `system` is in the list, and the call is worth stating because a
 * plugin is the one container that is deliberately system-AGNOSTIC
 * (§M-2: usable with any system). It reads like a contradiction and
 * isn't: a pane is client code rendering AT A TABLE, and a table always
 * has a system (§M-6 — a host with none is a host mid-setup). The
 * specifier resolves to a module the host GENERATES, empty when nothing
 * supplies a presentation, so importing it never 404s and never
 * requires anything. So the honest rule is the same one panels got —
 * a pane may consume the active system's vocabulary if it wants to
 * dress itself in the book's face, and a pane that imports nothing but
 * `teller` works identically on every system. Leaving `system` out
 * would have banned the good case to prevent no bad one.
 */
export const PLUGIN_IMPORTS = PANEL_IMPORTS;

/** Has this source changed since its output was written? A missing output always has. */
export function newerThan(srcPath: string, outPath: string): boolean {
  if (!existsSync(outPath)) return true;
  return statSync(srcPath).mtimeMs > statSync(outPath).mtimeMs;
}

/**
 * The `?v=` a code url carries: the compiled artifact's own mtime, in
 * base 36. A browser caches a module by its url, and an edited-and-swept
 * folder used to serve yesterday's bytes behind today's url until
 * somebody thought to hard-refresh. Naming the mtime makes the url
 * change EXACTLY when the code changed and never otherwise.
 *
 * The mtime, not a content hash: the sweep already stats these files to
 * decide whether to compile at all, so this costs nothing, and the
 * question a cache is asking ("is this the same build?") is one an
 * mtime answers honestly. An unstattable file gets no stamp rather than
 * a made-up one.
 *
 * Lives here, beside the compile, because both shelves that carry code
 * ask it the same question — panels since §E, plugins since §15's pane
 * tier landed.
 */
export function stamp(outPath: string): string {
  try {
    return `?v=${Math.floor(statSync(outPath).mtimeMs).toString(36)}`;
  } catch {
    return '';
  }
}

/** `undefined` on success, an error message on failure — never a throw. */
export function buildOne(
  srcPath: string,
  outPath: string,
  external: string[],
): string | undefined {
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    esbuild.buildSync({
      entryPoints: [srcPath],
      outfile: outPath,
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      external,
      minify: false,
      write: true,
      logLevel: 'silent',
    });
    return undefined;
  } catch (err) {
    const errors = (err as { errors?: { text: string }[] }).errors;
    return errors?.length ? errors.map((e) => e.text).join('; ') : String(err);
  }
}

/**
 * Compile every `*.tsx` in one folder into `<outDir>/<name>.js`,
 * skipping anything whose output is already newer than its source.
 * Returns the names that have a build on disk (whether this pass wrote
 * it or a previous one did) and one problem per file that didn't
 * compile — the caller decides how to word them and who gets to see
 * the result. Trust is never decided here.
 */
export function compileFolder(
  srcDir: string,
  outDir: string,
  external: string[],
): { built: string[]; problems: { file: string; problem: string }[] } {
  const built: string[] = [];
  const problems: { file: string; problem: string }[] = [];
  for (const file of readdirSync(srcDir).sort()) {
    if (!file.endsWith('.tsx')) continue;
    const name = file.slice(0, -'.tsx'.length);
    const src = join(srcDir, file);
    const out = join(outDir, `${name}.js`);
    if (newerThan(src, out)) {
      const err = buildOne(src, out, external);
      if (err) {
        problems.push({ file, problem: err });
        continue;
      }
    }
    if (existsSync(out)) built.push(name);
  }
  return { built, problems };
}

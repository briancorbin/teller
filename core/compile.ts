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

/** Has this source changed since its output was written? A missing output always has. */
export function newerThan(srcPath: string, outPath: string): boolean {
  if (!existsSync(outPath)) return true;
  return statSync(srcPath).mtimeMs > statSync(outPath).mtimeMs;
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

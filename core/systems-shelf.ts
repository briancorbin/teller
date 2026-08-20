// The fourth shelf dir — `~/.teller-next/systems/<name>/` (§M·4).
//
// §M drew the line the migration hadn't yet: a SYSTEM is pure function
// (kinds, dice, effects, mechanics code, unbranded panels — freely
// distributable because mechanics aren't protectable expression) and a
// PACK is the book's stuff (monsters, prose, art, branded panels, rights
// following the content). Phase 1 put `system.json` INSIDE the pack
// folder because one converter run produced both halves; that was
// right-for-the-migration and known-temporary. This module is the
// separation: a system is its own folder, on its own shelf, with its own
// trust row and its own code.
//
//   systems/wiw/
//     system.json          sys_ id, name, version, and the record slots
//                          inline — the same file, the same reserved
//                          keys, read by the same `systemFrom`
//     presentations/*.tsx  the system's own components, compiled by the
//                          shared esbuild pass, `PACK_IMPORTS` (no
//                          `system` self-import — these ARE the system)
//     panels/<name>/       ordinary `.panel` folders, swept by
//                          `sweepPanelsIn` — the system's furniture,
//                          merging above teller's floor and below the
//                          packs
//     art/                 assets function demands, installed under
//                          `art/<sys_id>/…` exactly as a pack's are
//
// NOTHING about the loaded model changed: a folder here yields the same
// `ShelfSystem` a `system.json` inside a pack yields, and the same one a
// `shelf.db` row yields. What changed is WHERE the authoring copy lives
// and, therefore, who may hand it on.
//
// **Precedence, per id: this folder > a pack-folder-embedded
// `system.json` > a `shelf.db` row.** Same law as everywhere else and
// for the same reason (`boot.ts` applies it): the more authored, more
// specific copy wins, and the ones it shadows stay readable so nothing
// breaks on the way through. An old export whose system rides inside its
// pack keeps working forever — that is the compatibility contract, and
// it has a test.
//
// Trust is the pack machinery verbatim: one `pluginTrust` row, keyed by
// the `sys_` id, gating CODE and never data. A system's declarations,
// kinds and dice load for anyone; its presentations wait for a human.
// Brian's own shelf is his own files, so the row is minted enabled by
// the hand that put the folder there (see the §M note in CORE-NEXT).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileFolder, readBuildMeta, stamp, NEUTRAL_IMPORTS } from './compile.ts';
import {
  compilePackCode,
  copyNewer,
  systemFrom,
  type PackProblem,
  type SystemExport,
  type ShelfSystem,
} from './packs-shelf.ts';
import { panelDirIn, sweepPanelsIn } from './panels-shelf.ts';
import type { PanelDef } from './panels.ts';
import type { Shelf } from './store.ts';

// `SystemExport` is declared in `packs-shelf.ts`, beside the shim that
// re-exports one and the index module it is a sibling of; re-exported
// here because a system folder is what produces them.
export type { SystemExport } from './packs-shelf.ts';

/** A system as its own folder holds one — the shelf shape, plus what only a folder can carry. */
export type ShelfSystemFolder = ShelfSystem & {
  /** Compiled presentations, attached only once a human trusted the `sys_` id. */
  code?: {
    presentations: Record<string, string>;
    /** `exports/<name>` → where it is and what it exports. */
    exports?: Record<string, SystemExport>;
    /** `system/<name>` specifiers the system's OWN code imports. */
    needs?: string[];
  };
  /** A folder that compiled code nobody has enabled yet. Its DATA loaded regardless. */
  codePending?: boolean;
};

export type SystemSweep = { systems: ShelfSystemFolder[]; problems: PackProblem[] };

/**
 * Every system folder on the shelf, in folder-name order. A folder with
 * no `system.json` is not a system and is skipped in silence
 * (`sweepPacks`'s posture for a folder with no `pack.json`); one whose
 * `system.json` doesn't parse is a problem in the report and contributes
 * nothing.
 */
export function sweepSystems(dataDir: string, shelf?: Shelf): SystemSweep {
  const systems: ShelfSystemFolder[] = [];
  const problems: PackProblem[] = [];
  const root = join(dataDir, 'systems');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { systems, problems };
  }

  for (const name of names.sort()) {
    const dir = join(root, name);
    const path = join(dir, 'system.json');
    if (!existsSync(path)) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      problems.push({ dir, problem: `system.json did not parse: ${String((err as Error).message ?? err)}` });
      continue;
    }
    const record =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    if (!record) {
      problems.push({ dir, problem: 'system.json is not a system (needs an object)' });
      continue;
    }

    // The id has to be known before the art install, because a system's
    // pictures are keyed by it — same order `sweepPacks` uses.
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const artDir = join(dir, 'art');
    if (id && existsSync(artDir)) {
      try {
        copyNewer(artDir, join(dataDir, 'art', id));
      } catch (err) {
        problems.push({ dir, problem: `art/ did not install: ${String(err)}` });
      }
    }

    const { system, problem } = systemFrom(record, id);
    if (problem) problems.push({ dir, problem });
    if (!system) continue;

    // The system's own panels ride in its data blob, as the `panels`
    // slot every layer merges by name — so a system panel overrides
    // teller's floor and a pack's overrides the system's, with no new
    // resolution rule anywhere.
    const panels = sweepPanelsIn(join(dir, 'panels'), shelf);
    for (const p of panels.problems) problems.push(p);
    if (panels.panels.length) {
      const floor = Array.isArray(system.data.panels)
        ? (system.data.panels as PanelDef[])
        : [];
      system.data.panels = [...floor, ...panels.panels];
    }

    const entry: ShelfSystemFolder = system;
    const { presentations, needs, problems: codeProblems } = compilePackCode(dir, system.id);
    for (const problem of codeProblems) problems.push({ dir, problem });
    // …and the system's declared function beside its faces (§M-4a).
    // Both halves take the SAME trust row, because they are the same
    // system's code arriving through the same door.
    const { exports, problems: exportProblems } = compileSystemExports(dir, system.id);
    for (const problem of exportProblems) problems.push({ dir, problem });
    if (presentations || exports) {
      if (shelf?.pluginTrust(system.id)?.enabled) {
        entry.code = {
          presentations: presentations ?? {},
          ...(exports ? { exports } : {}),
          ...(needs?.length ? { needs } : {}),
        };
      } else entry.codePending = true;
    }
    systems.push(entry);
  }

  return { systems, problems };
}

/**
 * A system's DECLARED FUNCTION (§M-4a): `exports/*.ts(x)`, compiled by
 * the same pass as everything else, into the same `.build` folder, served
 * through the same `/pack-code/<sys_id>/…` door. The FILENAME is the
 * export name — `exports/creation.ts` is `system/creation`, and a pack
 * importing that specifier is asking for this file.
 *
 * The neutral externals only: an export is the bottom of the merge, so
 * it may not import the merged index (`system`) — that is the cycle bare
 * `system` is closed to packs to prevent, and it would be the same cycle
 * here — and it may not import a sibling through `system/…` either. A
 * helper beside it is an ordinary relative import and gets bundled.
 *
 * Trust is the caller's business, as ever: this compiles and reports
 * regardless, and only the folder sweep decides who gets the urls.
 */
export function compileSystemExports(
  dir: string,
  systemId: string,
): { exports?: Record<string, SystemExport>; problems: string[] } {
  const srcDir = join(dir, 'exports');
  if (!existsSync(srcDir)) return { problems: [] };

  const problems: string[] = [];
  const outDir = join(dir, '.build', 'exports');
  const { built, problems: compileProblems } = compileFolder(srcDir, outDir, NEUTRAL_IMPORTS, [
    '.tsx',
    '.ts',
  ]);
  for (const { file, problem } of compileProblems) problems.push(`exports/${file}: ${problem}`);

  const exports: Record<string, SystemExport> = {};
  for (const name of built) {
    const out = join(outDir, `${name}.js`);
    exports[name] = {
      url: `/pack-code/${systemId}/exports/${name}.js${stamp(out)}`,
      names: readBuildMeta(out).exports,
    };
  }
  return { exports: Object.keys(exports).length ? exports : undefined, problems };
}

/**
 * Which folder holds a system's compiled output, for the server's
 * `/pack-code/<id>/…` route — `packDir`'s twin. The route prefix stays
 * `pack-code` on purpose: it is the CONTENT SHELF's code door, one
 * route serving whatever carries presentations, and renaming it would
 * break every url already baked into a `.build` output and the client's
 * import map for no gain.
 */
export function systemDir(dataDir: string, systemId: string): string | undefined {
  const root = join(dataDir, 'systems');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names) {
    const dir = join(root, name);
    const path = join(dir, 'system.json');
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { id?: unknown };
      if (raw && typeof raw === 'object' && raw.id === systemId) return dir;
    } catch {
      // a broken system.json is sweepSystems's problem to report, not this lookup's
    }
  }
  return undefined;
}

/**
 * Which system folder holds a code-carrying PANEL's build, for
 * `/panel-code/<pan_id>/…` to resolve after the table's own `panels/`
 * came up empty. A system's panels are ordinary panels — same id
 * scheme, same trust row — so the only thing the route needs is a
 * second place to look.
 */
export function systemPanelDir(dataDir: string, panelId: string): string | undefined {
  const root = join(dataDir, 'systems');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names.sort()) {
    const hit = panelDirIn(join(root, name, 'panels'), panelId);
    if (hit) return hit;
  }
  return undefined;
}

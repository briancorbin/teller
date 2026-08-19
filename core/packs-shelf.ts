// How a pack reaches the shelf as a FOLDER — rule 4a's "the shelf
// folder IS the authoring copy", ported into the new world (§L phase 1).
//
// The old world swept `~/.teller/packs/` and the new world had nothing:
// pack and system content arrived only as converter-written rows in
// `shelf.db`, so editing WiW's vocabulary meant editing the OLD pack,
// re-running the converter, and restarting. This module is the door
// back — edit `~/.teller-next/packs/wiw-guidebook/system.json`, sweep,
// live.
//
// It mirrors `panels-shelf.ts` deliberately, because that file is the
// house example of a sweep: READ ONLY (bar the art copy below), a
// folder that fails to parse is a problem in the report and never a
// crash, and a missing `packs/` directory is simply an empty shelf.
//
// THE FORMAT (documented in `packs/README.md`, which is the format's
// home — this comment is the mechanism's):
//
//   packs/wiw-guidebook/
//     pack.json      id, system, name, version, rights, books
//     system.json    the SYSTEM half — sys_ id, name, version, and the
//                    record slots inline (dials, pins, accents, …)
//     bestiary.json  ┐
//     catalog.json   │ every other *.json is a SLOT, named by its file
//     sections.json  ┘ — the pack's data blob, one key per file
//     panels/<name>/ ordinary `.panel` folders, swept by `sweepPanelsIn`
//                    — the BOOK's panels, merging above the system's
//                    (§M-2's sort: system = unbranded, pack = branded)
//     art/           the pictures, referenced relative from the slots
//
// **`system.json` in here is now the COMPATIBILITY path** (§M, 2026-08-19).
// A system is its own folder on its own shelf — `systems-shelf.ts`, which
// reads the same file with the same `systemFrom` — and it wins on a
// collision. A pack that still carries its system loads exactly as it
// always did, forever: that is what makes an export written before the
// split keep working, and it costs one map lookup in `boot.ts`.
//
// One folder yields BOTH shelf entities, exactly as the converter
// already produced both from one source: a system row and a pack row.
// That is not a new coupling — a pack has always declared a `system`,
// and the system's records are the vocabulary its content is written
// in. A folder may carry only `pack.json` (a pack for a system that
// arrived some other way) or `pack.json` + `system.json` (the WiW case:
// the system and the book that speaks it, authored together).
//
// The file split is a SERIALIZATION, not a data model (rule 4a): the
// slot files reassemble into the one `data` blob `boot.ts` stacks, so
// nothing downstream learned this happened.
//
// **Why `system.json` carries its slots INLINE** and `pack.json` does
// not: a pack's slots are big lists that want a file each (65 foes do
// not belong beside an id), while a system's are ~20 small records that
// are read and edited together — `dials` is four lines. One file keeps
// the whole vocabulary in one editor buffer, which is what the edit
// recipe actually looks like. The cost is three reserved keys (`id`,
// `name`, `version`); a system slot may not be called those.
//
// ART, and the one write this module makes. `/files/art/…` serves
// bytes from `<dataDir>/art/`, keyed `art/<pak_id>/…` (rule 4a), and
// that route is not going to learn about pack folders. So the sweep
// COPIES a folder's `art/` into `<dataDir>/art/<pak_id>/`, file by
// file, skipping anything whose destination is already newer than its
// source — the same mtime gate `compilePanelCode` uses, for the same
// reason (an untouched folder costs nothing on the next boot).
// Symlinks were considered and rejected: they don't survive a zip, they
// don't survive a copy to a stick, and the serving route would have to
// grow a "follow this out of the data dir" decision that is exactly the
// path-escape check it exists to make.
//
// Inside a pack, art is referenced RELATIVE (`art/logo.png`) and the
// sweep rewrites those strings to the installed key (`art/<pak_id>/…`)
// as it assembles the blob — so a folder installs under any id on any
// host and still finds its own pictures, and nobody types a global key.
//
// CODE (§L phase 2, 2026-08-19). A pack folder may carry
// `presentations/*.tsx` — the system's own components, which is where
// §L says HealthPanel and the Cylinder belong ("data-generic was
// conflated with belongs-to-teller"). They compile through the SAME
// esbuild pass a `.panel`'s blocks do (`core/compile.ts`), into
// `<folder>/.build/presentations/`, mtime-gated, a compile error being
// a `PackProblem` and never a crash.
//
// Three rules, each with a reason:
//
//   * **Trust gates code, not data** (§E's line, applied verbatim). The
//     `pluginTrust` row is keyed by the pack's `pak_` id — one trust
//     table, three kinds of thing riding it now. An untrusted pack's
//     declarations, bestiary and art load exactly as before; only
//     `code` is withheld, and `codePending` says so out loud.
//   * **A presentation may not import `system`** — it IS the system.
//     `PACK_IMPORTS` leaves that specifier out, so esbuild refuses to
//     resolve it and the author reads why in the load report.
//   * **The export name is the FILE name.** `TestFace.tsx` is
//     `TestFace` in `system`, which is what makes the index module
//     (`systemIndexModule`) mechanical and what lets a later pack in
//     precedence order shadow an earlier one's component by restating
//     the filename — the same later-wins law as every other layer.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { compileFolder, PACK_IMPORTS } from './compile.ts';
import { panelDirIn, sweepPanelsIn } from './panels-shelf.ts';
import type { PanelDef } from './panels.ts';
import type { Shelf } from './store.ts';

/** A folder, or one file inside it, that didn't parse — reported, never a crash. */
export type PackProblem = { dir: string; problem: string };

/** A pack as the shelf holds one — the same shape `Shelf#pack` returns. */
export type ShelfPack = {
  id: string;
  system?: string;
  name: string;
  version: number;
  data: Record<string, unknown>;
  /**
   * The system's own presentation code (§L phase 2), attached at SWEEP
   * and only once the pack is TRUSTED — never carried in `pack.json`.
   * One entry per `presentations/*.tsx`, named by its file, pointing at
   * `/pack-code/<pak_id>/presentations/<name>.js`.
   */
  code?: { presentations: Record<string, string> };
  /**
   * Set instead of `code` when a folder compiled presentations but no
   * human has enabled the pack yet — the console's cue to say "this
   * pack carries code awaiting enablement". Its DATA loaded regardless.
   */
  codePending?: boolean;
};

/** A system as the shelf holds one — the same shape `Shelf#system` returns. */
export type ShelfSystem = {
  id: string;
  name: string;
  version: number;
  data: Record<string, unknown>;
};

export type PackSweep = {
  systems: ShelfSystem[];
  packs: ShelfPack[];
  problems: PackProblem[];
};

/** `pack.json`'s own keys — never slots. */
const PACK_KEYS = new Set(['id', 'system', 'name', 'version', 'rights', 'books']);
/** `system.json`'s reserved keys — everything else in that file is a slot. */
const SYSTEM_KEYS = new Set(['id', 'name', 'version']);

function readJson(path: string): { value?: unknown; problem?: string } {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (err) {
    return { problem: String((err as Error).message ?? err) };
  }
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/**
 * A relative art reference (`art/logo.png`) as the key `/files/art/…`
 * serves (`art/<pak_id>/logo.png`). Idempotent: a string that already
 * names this pack's id is left alone, so a sweep of a folder someone
 * exported with installed keys doesn't double-prefix.
 */
export function installedArtKey(packId: string, rel: string): string {
  const bare = rel.replace(/^art\//, '');
  return bare.startsWith(`${packId}/`) ? `art/${bare}` : `art/${packId}/${bare}`;
}

/** The reverse — what export writes back into a folder. */
export function relativeArtKey(packId: string, key: string): string {
  return key.startsWith(`art/${packId}/`)
    ? `art/${key.slice(`art/${packId}/`.length)}`
    : key;
}

/** Deep-rewrite every `art/…` string in a slot blob to the installed key. */
export function withInstalledArt(value: unknown, packId: string): unknown {
  if (typeof value === 'string') {
    return /^art\//.test(value) ? installedArtKey(packId, value) : value;
  }
  if (Array.isArray(value)) return value.map((v) => withInstalledArt(v, packId));
  const record = asRecord(value);
  if (!record) return value;
  const out: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(record)) {
    out[key] = withInstalledArt(held, packId);
  }
  return out;
}

/**
 * One `system.json` object, read as the shelf's system entity — the
 * reserved three off the top, everything else a slot.
 *
 * Exported because `systems-shelf.ts` reads the SAME file out of
 * `~/.teller-next/systems/<name>/` (§M's split): a system.json is a
 * system.json wherever it sits, and the reserved-keys rule is one rule
 * with one implementation. `artOwner` is whose id an `art/…` string
 * resolves against — the pack's, for one embedded in a pack folder; the
 * system's own, for a folder that carries its own pictures.
 */
export function systemFrom(
  record: Record<string, unknown>,
  artOwner: string,
): { system?: ShelfSystem; problem?: string } {
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    return { problem: 'system.json has no id — a system is named by its sys_ id' };
  }
  const data: Record<string, unknown> = {};
  for (const [key, held] of Object.entries(record)) {
    if (!SYSTEM_KEYS.has(key)) data[key] = withInstalledArt(held, artOwner);
  }
  return {
    system: {
      id,
      name: typeof record.name === 'string' ? record.name : id,
      version: Number(record.version) || 1,
      data,
    },
  };
}

/** Copy one tree, skipping any file whose destination is already newer. */
export function copyNewer(from: string, to: string): void {
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dest = join(to, name);
    if (statSync(src).isDirectory()) {
      copyNewer(src, dest);
      continue;
    }
    if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) continue;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

/** A JS identifier, because the index module re-exports under this name. */
const IMPORTABLE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Compile one pack folder's `presentations/*.tsx` into
 * `<dir>/.build/presentations/`. Returns the urls the client should be
 * given — trust is the caller's decision, not this function's, so it
 * runs unconditionally and reports what it found regardless of who
 * eventually gets to see it. (`compilePanelCode`'s posture, and the
 * same shape of answer.)
 */
export function compilePackCode(
  dir: string,
  packId: string,
): { presentations?: Record<string, string>; problems: string[] } {
  const srcDir = join(dir, 'presentations');
  if (!existsSync(srcDir)) return { problems: [] };

  const problems: string[] = [];
  const { built, problems: compileProblems } = compileFolder(
    srcDir,
    join(dir, '.build', 'presentations'),
    PACK_IMPORTS,
  );
  for (const { file, problem } of compileProblems) {
    problems.push(`presentations/${file}: ${problem}`);
  }

  const presentations: Record<string, string> = {};
  for (const name of built) {
    if (!IMPORTABLE.test(name)) {
      problems.push(
        `presentations/${name}.tsx: the file name is the export name, and this one isn't a JS identifier`,
      );
      continue;
    }
    presentations[name] = `/pack-code/${packId}/presentations/${name}.js`;
  }
  return {
    presentations: Object.keys(presentations).length ? presentations : undefined,
    problems,
  };
}

/**
 * Which folder holds a pack's compiled output, for the server's
 * `/pack-code/<pak_id>/…` route to resolve — `panelDir`'s twin, and a
 * linear scan for the same reason (a shelf holds a handful of packs).
 */
export function packDir(dataDir: string, packId: string): string | undefined {
  const root = join(dataDir, 'packs');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const name of names) {
    const dir = join(root, name);
    const path = join(dir, 'pack.json');
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { id?: unknown };
      if (raw && typeof raw === 'object' && raw.id === packId) return dir;
    } catch {
      // a broken pack.json is sweepPacks's problem to report, not this lookup's
    }
  }
  return undefined;
}

/**
 * Which pack folder holds a code-carrying PANEL's build, for
 * `/panel-code/<pan_id>/…` to resolve after the table's own `panels/`
 * and the systems' came up empty. `systemPanelDir`'s twin: a pack's
 * panels are ordinary panels — same id scheme, same trust row — so the
 * only thing the route needs is a third place to look.
 */
export function packPanelDir(dataDir: string, panelId: string): string | undefined {
  const root = join(dataDir, 'packs');
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

/**
 * The `system` specifier's body: one re-export per presentation the
 * campaign's trusted packs supplied, named by its file.
 *
 * With nothing to re-export this is a VALID EMPTY MODULE, deliberately
 * — importing `system` from panel code must never 404 a panel, and a
 * system with no code of its own is the ordinary case, not an error.
 * The degradation is the panel finding no such export and saying so,
 * which is a thing the client can render; a failed module fetch is not.
 */
export function systemIndexModule(presentations: Record<string, string>): string {
  const lines = Object.entries(presentations).map(
    ([name, url]) => `export { default as ${name} } from '${url}';`,
  );
  return lines.length ? `${lines.join('\n')}\n` : 'export {};\n';
}

/**
 * Every pack folder on the shelf, read back in folder-name order.
 *
 * A folder with no `pack.json` is not a pack and is skipped in silence
 * (a `.pack` archive sitting beside the folders, a stray directory) —
 * `sweepPanels`'s posture for a folder with no `panel.json`. A
 * `pack.json` that doesn't parse, or carries no id, is a PROBLEM and
 * the folder contributes nothing. A single SLOT file that doesn't parse
 * is a problem too, and only that slot is lost: the pack loads what
 * parses.
 */
export function sweepPacks(dataDir: string, shelf?: Shelf): PackSweep {
  const systems: ShelfSystem[] = [];
  const packs: ShelfPack[] = [];
  const problems: PackProblem[] = [];
  const root = join(dataDir, 'packs');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { systems, packs, problems };
  }

  for (const name of names.sort()) {
    const dir = join(root, name);
    const manifestPath = join(dir, 'pack.json');
    if (!existsSync(manifestPath)) continue;

    const read = readJson(manifestPath);
    const manifest = asRecord(read.value);
    if (!manifest) {
      problems.push({ dir, problem: `pack.json is not a pack (${read.problem ?? 'not an object'})` });
      continue;
    }
    const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
    if (!id) {
      problems.push({ dir, problem: 'pack.json has no id — identity is the id, never the name' });
      continue;
    }

    // Art first: the copy has to land before anything reads a rewritten
    // key, and a failure here costs the pictures, never the pack.
    const artDir = join(dir, 'art');
    if (existsSync(artDir)) {
      try {
        copyNewer(artDir, join(dataDir, 'art', id));
      } catch (err) {
        problems.push({ dir, problem: `art/ did not install: ${String(err)}` });
      }
    }

    // Every other *.json is a slot named by its file.
    const data: Record<string, unknown> = {};
    let systemFile: Record<string, unknown> | undefined;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.json') || file === 'pack.json') continue;
      const slot = file.slice(0, -'.json'.length);
      const held = readJson(join(dir, file));
      if (held.problem !== undefined) {
        problems.push({ dir, problem: `${file} did not parse: ${held.problem}` });
        continue;
      }
      if (file === 'system.json') {
        const record = asRecord(held.value);
        if (!record) {
          problems.push({ dir, problem: 'system.json is not a system (needs an object)' });
          continue;
        }
        systemFile = record;
        continue;
      }
      data[slot] = withInstalledArt(held.value, id);
    }

    if (systemFile) {
      const { system, problem } = systemFrom(systemFile, id);
      if (problem) problems.push({ dir, problem });
      if (system) systems.push(system);
    }

    // Anything unrecognised in `pack.json` rides along as a slot rather
    // than being dropped — the same "what has no consumer yet stays
    // where it was" posture the converter takes.
    for (const [key, held] of Object.entries(manifest)) {
      if (!PACK_KEYS.has(key)) data[key] = withInstalledArt(held, id);
    }

    // The pack's own panels ride in its data blob, as the `panels` slot
    // every layer merges by name — so a pack panel overrides the
    // system's by restating its name, which is the whole point
    // (branded-over-unbranded, §M-2's sort: the system ships the
    // unbranded furniture, the book ships the book's).
    const swept = sweepPanelsIn(join(dir, 'panels'), shelf);
    for (const p of swept.problems) problems.push(p);
    if (swept.panels.length) {
      const floor = Array.isArray(data.panels) ? (data.panels as PanelDef[]) : [];
      data.panels = [...floor, ...swept.panels];
    }

    const pack: ShelfPack = {
      id,
      name: typeof manifest.name === 'string' ? manifest.name : id,
      version: Number(manifest.version) || 1,
      data,
    };
    if (typeof manifest.system === 'string' && manifest.system.trim()) {
      pack.system = manifest.system.trim();
    }

    // Code last: it neither blocks nor is blocked by the data above.
    const { presentations, problems: codeProblems } = compilePackCode(dir, id);
    for (const problem of codeProblems) problems.push({ dir, problem });
    if (presentations) {
      if (shelf?.pluginTrust(id)?.enabled) {
        pack.code = { presentations };
      } else {
        pack.codePending = true;
      }
    }

    packs.push(pack);
  }

  return { systems, packs, problems };
}

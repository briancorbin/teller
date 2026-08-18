// How a plugin loads. `docs/CORE-NEXT.md` §15.
//
// A plugin is a folder on the shelf — `<dataDir>/plugins/<name>/` —
// manifest beside code: `plugin.json` claims what it is and what it
// wants; `host.mjs` exports implementations keyed by extension point.
//
// The load path is three separate acts, and the separation is the
// security model:
//
//   * DISCOVERY (`discoverPlugins`) reads the folders and reports.
//     It writes nothing, ever — a plugin appearing on disk is a
//     proposal, exactly like a pack arriving in the sweep.
//   * ENABLEMENT is a human act in the console, recorded on the shelf
//     (`shelf.setPluginEnabled`). Content may REQUIRE a plugin by ref;
//     requirement is a claim and cannot grant trust.
//   * LOADING (`loadPlugins`) imports only what a human enabled, keeps
//     only the provides whose points exist in the registry, and reports
//     everything it refused — a provide against a point this build has
//     never heard of is refused OUT LOUD, not dropped.
//
// The call boundary is async and message-shaped from day one:
// serializable snapshots in, serializable proposals out, no live
// objects — enforced here by structuredClone on both sides of every
// call, so moving a plugin out of process later is a transport change,
// not an API break. Stated honestly: in-process code is NOT sandboxed;
// pre-alpha, the enable gate is the security model.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPoint, type Point } from './registry.ts';
import type { Shelf } from './store.ts';

export type PluginManifest = {
  /** `plg_…`, minted at authoring. Identity is the id, never the folder name. */
  id: string;
  name: string;
  version: number;
  /** Extension points it claims to implement. Checked against the registry at load. */
  provides: string[];
  /** What it wants from the host — app-permissions style, shown at enable. `[]` is a meaningful, checkable claim. */
  needs: string[];
};

export type Discovered = {
  dir: string;
  manifest: PluginManifest;
  enabled: boolean;
};

/** A folder that didn't parse, a provide that isn't a point — reported, never silently dropped. */
export type PluginProblem = { dir: string; problem: string };

export type LoadedPlugin = {
  manifest: PluginManifest;
  provides: Partial<Record<Point, (payload: unknown) => Promise<unknown>>>;
};

function toManifest(raw: unknown): PluginManifest | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  const name = String(o.name ?? '').trim();
  if (!id.startsWith('plg_') || !name) return undefined;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];
  return {
    id,
    name,
    version: typeof o.version === 'number' ? o.version : 1,
    provides: strings(o.provides),
    needs: strings(o.needs),
  };
}

/**
 * What's on the shelf, and what a human has said about it. Reads disk
 * and the trust table; writes neither.
 */
export function discoverPlugins(
  dataDir: string,
  shelf: Shelf,
): { found: Discovered[]; problems: PluginProblem[] } {
  const found: Discovered[] = [];
  const problems: PluginProblem[] = [];
  const root = join(dataDir, 'plugins');
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return { found, problems };
  }
  for (const name of names.sort()) {
    const dir = join(root, name);
    const manifestPath = join(dir, 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: PluginManifest | undefined;
    try {
      manifest = toManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
    } catch {
      manifest = undefined;
    }
    if (!manifest) {
      problems.push({
        dir,
        problem: 'plugin.json is not a manifest (needs plg_ id and a name)',
      });
      continue;
    }
    found.push({
      dir,
      manifest,
      enabled: shelf.pluginTrust(manifest.id)?.enabled ?? false,
    });
  }
  return { found, problems };
}

/**
 * The message-shaped boundary, applied to one function: both the
 * snapshot going in and the proposal coming out must survive
 * structuredClone, which is the cheapest honest way to say "no live
 * objects cross". A plugin that returns something unclonable fails
 * HERE, today, in process — not the day the transport changes.
 */
function messageShaped(
  fn: (payload: unknown, config: unknown) => unknown,
  config: unknown,
): (payload: unknown) => Promise<unknown> {
  return async (payload) => {
    const sent = structuredClone(payload);
    const result = await fn(sent, structuredClone(config ?? null));
    return result === undefined ? undefined : structuredClone(result);
  };
}

/**
 * Import every ENABLED plugin and wire its provides to the registry.
 * Missing entry file, a throw on import, a provide against no point —
 * each is a problem in the report and never a crash: a broken plugin
 * degrades like a missing pack, and the table plays on.
 */
export async function loadPlugins(
  dataDir: string,
  shelf: Shelf,
): Promise<{ loaded: LoadedPlugin[]; problems: PluginProblem[] }> {
  const { found, problems } = discoverPlugins(dataDir, shelf);
  const loaded: LoadedPlugin[] = [];
  for (const { dir, manifest, enabled } of found) {
    if (!enabled) continue;
    const entry = join(dir, 'host.mjs');
    if (!existsSync(entry)) {
      problems.push({ dir, problem: 'enabled but has no host.mjs' });
      continue;
    }
    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(entry).href)) as Record<
        string,
        unknown
      >;
    } catch (err) {
      problems.push({ dir, problem: `failed to import: ${String(err)}` });
      continue;
    }
    const provides = module.provides;
    if (!provides || typeof provides !== 'object') {
      problems.push({ dir, problem: 'host.mjs exports no `provides`' });
      continue;
    }
    const wired: LoadedPlugin['provides'] = {};
    for (const [point, fn] of Object.entries(
      provides as Record<string, unknown>,
    )) {
      if (typeof fn !== 'function') continue;
      if (!isPoint(point)) {
        problems.push({
          dir,
          problem: `provides '${point}', which is not a point in the registry`,
        });
        continue;
      }
      // Config rides into every call as a cloned second argument — the
      // plugin never reads the shelf, and the same clone boundary that
      // guards payloads guards what a human configured.
      wired[point] = messageShaped(
        fn as (payload: unknown, config: unknown) => unknown,
        shelf.pluginTrust(manifest.id)?.config,
      );
    }
    loaded.push({ manifest, provides: wired });
  }
  return { loaded, problems };
}

/**
 * Every implementation of one point, in discovery order — the shape a
 * caller fans a snapshot out to. Proposals come back; a human picks or
 * ignores (rule 1 is the whole API).
 */
export function providersOf(
  loaded: LoadedPlugin[],
  point: Point,
): { id: string; call: (payload: unknown) => Promise<unknown> }[] {
  const out: { id: string; call: (payload: unknown) => Promise<unknown> }[] =
    [];
  for (const plugin of loaded) {
    const fn = plugin.provides[point];
    if (fn) out.push({ id: plugin.manifest.id, call: fn });
  }
  return out;
}

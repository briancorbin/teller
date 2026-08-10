import type { Env } from './db';
import type { SystemTemplate } from './types';
import { templates as builtins } from './templates';

// Systems, read from storage instead of from the source tree.
//
// `templates.ts` still holds the ones teller ships with, but only as
// SEED data — the authority is the `systems` table. That's what rule 4
// meant by "templates are data": a template is a document, so it can be
// exported into a `.story` file, carried on a stick, and imported into
// someone else's instance without a pull request.
//
// What a template may contain is unchanged and non-negotiable: structure
// and vocabulary. Field lists, counter names, "Warden" instead of "DM".
// Never rules text, never stat blocks.

type SystemRow = {
  system: string;
  name: string;
  version: number;
  data: string;
  builtin: number;
};

function toTemplate(row: SystemRow): SystemTemplate {
  // `data` is the whole template; the columns beside it exist so the
  // list can be read without parsing every blob.
  const parsed = JSON.parse(row.data) as SystemTemplate;
  return { ...parsed, system: row.system, name: row.name, version: row.version };
}

/**
 * Put the built-ins in the table if they aren't there.
 *
 * Insert-or-ignore rather than replace: once a system is stored it
 * belongs to the instance, and someone who renamed a counter on their
 * own copy of D&D shouldn't have it silently undone on next boot. That's
 * rule 1 — the stored value is authoritative — applied to templates.
 */
export async function seedSystems(env: Env): Promise<void> {
  await env.DB.batch(
    builtins.map((t) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO systems (system, name, version, data, builtin)
         VALUES (?, ?, ?, ?, 1)`,
      ).bind(t.system, t.name, t.version, JSON.stringify(t)),
    ),
  );
}

export async function listSystems(env: Env): Promise<SystemTemplate[]> {
  const rows = await env.DB.prepare(
    'SELECT * FROM systems ORDER BY builtin DESC, name',
  ).all();
  if (!rows.results.length) {
    // First run, or someone cleared the table. Seeding here rather than
    // at boot keeps the worker stateless — there's no startup hook on
    // Cloudflare, and the host would need one anyway.
    await seedSystems(env);
    const seeded = await env.DB.prepare(
      'SELECT * FROM systems ORDER BY builtin DESC, name',
    ).all();
    return seeded.results.map((r) => toTemplate(r as never));
  }
  return rows.results.map((r) => toTemplate(r as never));
}

export async function getSystem(
  env: Env,
  system: string,
): Promise<SystemTemplate | undefined> {
  const row = await env.DB.prepare('SELECT * FROM systems WHERE system = ?')
    .bind(system)
    .first();
  if (row) return toTemplate(row as never);
  // Might be a built-in that hasn't been seeded yet.
  if (!builtins.some((t) => t.system === system)) return undefined;
  await seedSystems(env);
  const seeded = await env.DB.prepare('SELECT * FROM systems WHERE system = ?')
    .bind(system)
    .first();
  return seeded ? toTemplate(seeded as never) : undefined;
}

/** Store a template — how a system arrives from a `.story` bundle. */
export async function saveSystem(env: Env, template: SystemTemplate): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO systems (system, name, version, data, builtin)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (system) DO UPDATE SET
       name = excluded.name, version = excluded.version, data = excluded.data`,
  )
    .bind(
      template.system,
      template.name,
      template.version ?? 1,
      JSON.stringify(template),
    )
    .run();
}

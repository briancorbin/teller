import { newId, toPackRecord, type Env } from './db';
import type { Campaign, PackRecord, RulesPack } from './types';

// Where packs live, and who is allowed to overwrite one.
//
// A pack is the unit of content (rule 4a) and, since TEL-62, an artifact
// with its own identity and lifecycle: minted id, version, its own file.
// That makes "should this write win?" a real question with three
// different answers depending on who is asking, so the answer lives here
// once instead of being re-decided at every call site.
//
// The short version: a person uploading a pack MEANS it. A file
// appearing on disk, or a bundle carrying a reference, is a proposal —
// and a proposal never beats what's already stored unless it is
// demonstrably newer. That's rule 1 with a version number attached.

/** A pack that has been through ingest always has its id. */
export type IdentifiedPack = RulesPack & { id: string };

/**
 * Give a pack its permanent name if it doesn't have one.
 *
 * Minted, not hashed. See the comment on `RulesPack.id`: a pack is
 * edited, and hashing would rename it on every correction.
 */
export function identify(pack: RulesPack): IdentifiedPack {
  return pack.id ? (pack as IdentifiedPack) : { ...pack, id: newId('pak') };
}

/**
 * How a pack got here, which decides whether it may overwrite.
 *
 * `upload` — a person chose this file and pressed the button. Intent.
 *   It replaces, because refusing to would mean the only way to fix a
 *   pack is to delete it first.
 * `propose` — a file found in the packs folder, or a pack arriving
 *   inside something else. It may INSTALL, and it may UPGRADE, but it
 *   may never quietly downgrade or clobber. An adventure module bundling
 *   a stale copy of the core pack must not eat an evening's worth of
 *   page references.
 */
export type PackOrigin = 'upload' | 'propose';

export type SaveOutcome = 'added' | 'updated' | 'kept';

/**
 * Store a pack, and say what actually happened to it.
 *
 * The caller needs the outcome, not just success: "3 packs added, 1 you
 * already had — yours kept" is the whole reason import is trustworthy.
 */
export async function savePack(
  env: Env,
  incoming: RulesPack,
  origin: PackOrigin,
): Promise<{ pack: IdentifiedPack; outcome: SaveOutcome }> {
  const pack = identify(incoming);
  const existing = await env.DB.prepare('SELECT data FROM packs WHERE id = ?')
    .bind(pack.id)
    .first<{ data: string }>();

  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO packs (id, system, name, data) VALUES (?, ?, ?, ?)',
    )
      .bind(pack.id, pack.system, pack.name, JSON.stringify(pack))
      .run();
    return { pack, outcome: 'added' };
  }

  if (origin === 'propose') {
    const stored = JSON.parse(existing.data) as RulesPack;
    // Equal versions do NOT overwrite. Two packs claiming to be v3 are
    // the same pack as far as anyone can tell, and the stored one may
    // have been edited here — which is precisely what version numbers
    // can't detect and rule 1 says to protect.
    if (!(pack.version > (stored.version ?? 0))) {
      return { pack: { ...stored, id: pack.id }, outcome: 'kept' };
    }
  }

  await env.DB.prepare(
    `UPDATE packs SET system = ?, name = ?, data = ?, updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(pack.system, pack.name, JSON.stringify(pack), pack.id)
    .run();
  return { pack, outcome: 'updated' };
}

/**
 * Every pack on this host, or just one system's, **in arrival order**.
 *
 * Not alphabetical, and that's a fix rather than a preference. This list
 * is the default precedence for a campaign that hasn't declared one, so
 * its order decides which printing of a shared foe wins — and sorting by
 * name settled that by where a name happened to fall. "The Unlikely Duo"
 * beat "WiW Guidebook" for no better reason than T < W.
 *
 * Arrival order at least MEANS something: you install the core book,
 * then the adventure that builds on it, and later wins. It matches how
 * the shelf actually filled up.
 */
export async function listPacks(env: Env, system?: string): Promise<PackRecord[]> {
  const rows = system
    ? await env.DB.prepare(
        'SELECT * FROM packs WHERE system = ? ORDER BY created_at, name',
      )
        .bind(system)
        .all()
    : await env.DB.prepare('SELECT * FROM packs ORDER BY system, created_at, name').all();
  return rows.results.map((r) => toPackRecord(r as never));
}

/**
 * The packs a campaign runs on, in precedence order.
 *
 * The list is the campaign's claim — "I run the Guidebook, then the Duo
 * on top" — and its ORDER is the answer to a question that used to be
 * settled by accident: when two packs print the same foe and the Warden
 * hasn't picked one, today's winner is whichever pack sorts first by
 * name. The Duo beat the Guidebook because "The…" < "WiW…". That is a
 * coin toss wearing a rule's clothes.
 *
 * **Later wins**, matching how an import layers: you name the base, then
 * what goes on top of it.
 *
 * A campaign with no claim yet falls back to every pack for its system,
 * which is exactly the behaviour that shipped before this existed. The
 * fallback is deliberate and permanent, not a migration waiting to
 * happen: a host with one pack should never make anyone tick a box.
 */
export async function packsFor(env: Env, campaign: Campaign): Promise<PackRecord[]> {
  const available = await listPacks(env, campaign.system);
  const claim = campaign.data?.packs;
  if (!claim?.length) return available;

  const byId = new Map(available.map((p) => [p.id, p]));
  return claim.map((id) => byId.get(id)).filter((p): p is PackRecord => Boolean(p));
}

/**
 * What a campaign says it needs but this host doesn't hold.
 *
 * Named, never silently dropped — the books precedent. "You don't have
 * this" beats an encounter that deploys half-empty at the table.
 */
export async function missingPacks(env: Env, campaign: Campaign): Promise<string[]> {
  const claim = campaign.data?.packs;
  if (!claim?.length) return [];
  const here = new Set((await listPacks(env)).map((p) => p.id));
  return claim.filter((id) => !here.has(id));
}

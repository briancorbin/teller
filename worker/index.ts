import { CampaignDO } from './campaign-do';
import {
  logEvent,
  newId,
  publicCounters,
  publicScene,
  toCampaign,
  toCharacter,
  toPackRecord,
  toPublicCharacter,
  type Env,
} from './db';
import {
  actorOf,
  canDm,
  canEditCharacter,
  canWatch,
  displayRoutes,
  resolveDisplay,
  type Auth,
} from './displays';
import { bookRoutes } from './books';
import { getSystem, listSystems } from './systems';
import { bundleFilename, exportCampaign } from './bundle';
import { bestiaryFor, findBlueprint, stamp } from './bestiary';
import {
  installPack,
  listPacks,
  looksLikeArchive,
  missingPacks,
  packArchive,
  packsFor,
  readPackArchive,
  type IncomingPack,
} from './packs';
import { rollInitiative } from './dice';
import { assistantInfo, assistantConfigured, narrateOutcome, suggestTurn } from './assistant';
import { checkTicket, mintTicket, STREAM_MINUTES } from './tickets';
import { apply as applyBundle, inspect as inspectBundle } from './import';
import type {
  Calibration,
  CameraOverlay,
  Campaign,
  Character,
  CharacterData,
  ResolvedTurn,
  TokenMove,
  Counter,
  RulesPack,
  SessionOp,
  SessionState,
  Token,
} from './types';
import { tokenColor } from './tokens';

export { CampaignDO };

// For the host shim, which reads the pack shelf off a real disk before
// any request has happened and so can't go through a route.
//
// Re-exported rather than reimplemented in `host/*.mjs`: a pack's file
// layout is one set of rules, and the two-runtime contract only holds
// while the shims supply plumbing rather than second opinions. The host
// owns the folder; it does not own the format.
export { readZip } from './unzip';
export {
  ART_PREFIX,
  absolutizeArt,
  artKey,
  artPaths,
  assemble,
  parts,
  relativizeArt,
} from './packfile';

// --- helpers ---------------------------------------------------------------

/**
 * Every JSON answer, and **none of them may be cached**.
 *
 * A response with no freshness information is one a browser is allowed
 * to cache by guesswork (RFC 9111's heuristic freshness), and Safari
 * takes that offer readily. The symptom is a screen that reloads into
 * the PAST: an iPad seat came back holding a template from before the
 * system declared a store, so its Store screen was missing while every
 * other screen — rendered from that same stale template — looked
 * perfectly normal (Brian, 2026-08-14).
 *
 * Nothing behind `/api` is ever safely stale: it is all live table
 * state. Images and book bytes are served elsewhere and keep their own
 * caching, which is where caching actually earns something.
 */
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const err = (message: string, status: number) => json({ error: message }, status);

function hasKey(request: Request, env: Env): boolean {
  const key = request.headers.get('x-teller-key');
  return Boolean(env.DM_KEY && key === env.DM_KEY);
}

function sessionStub(env: Env, campaignId: string) {
  return env.CAMPAIGN.get(env.CAMPAIGN.idFromName(campaignId));
}

async function poke(env: Env, campaignId: string, characterId: string) {
  await sessionStub(env, campaignId).fetch('https://do/broadcast', {
    method: 'POST',
    body: JSON.stringify({ type: 'character', characterId }),
  });
}

function countersFrom(
  defs: {
    name: string;
    current?: number;
    max?: number | null;
    display?: Counter['display'];
    symbol?: string;
  }[],
): Counter[] {
  return defs.map((c) => ({
    id: newId('ctr'),
    name: c.name,
    current: c.current ?? 0,
    max: c.max ?? null,
    ...(c.display ? { display: c.display } : {}),
    ...(c.symbol ? { symbol: c.symbol } : {}),
  }));
}


// --- routes ----------------------------------------------------------------

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  // Two ways to be the DM: hold the key, or be a screen the DM pointed
  // at the console. Everything else is a screen doing its assigned job.
  const auth: Auth = { key: hasKey(request, env), display: await resolveDisplay(env, request) };
  const dm = (campaignId?: string) => canDm(auth, campaignId);
  let m: RegExpMatchArray | null;

  const displayed = await displayRoutes(request, env, url, auth);
  if (displayed) return displayed;

  const booked = await bookRoutes(request, env, url, dm());
  if (booked) return booked;

  if (pathname === '/api/health') {
    return json({ ok: true, name: 'teller' });
  }

  if (pathname === '/api/templates' && method === 'GET') {
    return json(await listSystems(env));
  }

  // Rules packs — uploaded reference content, DM-gated both ways.
  if (pathname === '/api/packs' && method === 'GET') {
    if (!dm()) return err('DM key required', 401);
    return json(await listPacks(env, url.searchParams.get('system') ?? undefined));
  }

  if (pathname === '/api/packs' && method === 'PUT') {
    if (!dm()) return err('DM key required', 401);

    // A `.pack` is an archive (TEL-88), and that's what the console
    // sends when someone adds one. JSON is still accepted because this
    // is an API rather than a file format — it's the shape everything
    // internal already speaks, and a pack with no art has nothing an
    // archive would carry.
    const buffer = await request.arrayBuffer();
    let incoming: IncomingPack;
    if (looksLikeArchive(new Uint8Array(buffer.slice(0, 4)))) {
      try {
        incoming = await readPackArchive(buffer);
      } catch (e) {
        return err((e as Error).message, 400);
      }
    } else {
      let pack: RulesPack;
      try {
        pack = JSON.parse(new TextDecoder().decode(buffer)) as RulesPack;
      } catch {
        return err("that isn't a pack — expected a .pack archive or JSON", 400);
      }
      if (!pack.system || !pack.name) return err('pack requires system and name', 400);
      incoming = { pack, art: new Map() };
    }

    // Uploading is intent, so it replaces — see `PackOrigin`. The saved
    // pack comes back carrying its id, which is how a file that was
    // written without one learns its permanent name.
    const { pack: saved } = await installPack(env, incoming, 'upload');
    const row = await env.DB.prepare('SELECT * FROM packs WHERE id = ?')
      .bind(saved.id)
      .first();
    return json(toPackRecord(row as never), 201);
  }

  // The file you hand someone: the pack, its parts, and its art.
  m = pathname.match(/^\/api\/packs\/([^/]+)\/file$/);
  if (m && method === 'GET') {
    if (!dm()) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM packs WHERE id = ?').bind(m[1]).first();
    if (!row) return err('not found', 404);
    const record = toPackRecord(row as never);
    const pack = { ...record.pack, id: record.id };
    const name = `${record.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pack`;
    return new Response(packArchive(env, pack), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${name}"`,
      },
    });
  }

  m = pathname.match(/^\/api\/packs\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!dm()) return err('DM key required', 401);
    await env.DB.prepare('DELETE FROM packs WHERE id = ?').bind(m[1]).run();
    return json({ ok: true });
  }

  // The assistant (TEL-85/86). Whether one is configured is all the
  // console may ask; the key never travels, and an unconfigured host
  // simply has no button — never a nag (rule 7: allowed, not required).
  if (pathname === '/api/assistant' && method === 'GET') {
    if (!dm()) return err('DM key required', 401);
    return json(assistantInfo(env));
  }

  // The assistant's two asks — both read everything and write NOTHING,
  // not even an event (rule 3 logs mutations; words the Warden may
  // ignore aren't one). /turn proposes; /narrate dresses results the
  // table's real dice already decided.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/assistant\/(turn|narrate)$/);
  if (m && method === 'POST') {
    if (!dm()) return err('DM key required', 401);
    if (!assistantConfigured(env)) {
      return err('no assistant configured — see ~/.teller/assistant.json', 503);
    }
    const campaignId = m[1];
    const ask = m[2];
    const { characterId, action, result, preface } = await request.json<{
      characterId?: string;
      action?: string;
      result?: string;
      preface?: string;
    }>();
    if (!characterId) return err('characterId required', 400);
    if (ask === 'narrate' && (!action || !result)) {
      return err('narrate needs the action run and what the dice said', 400);
    }

    const campaignRow = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(campaignId)
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const characterRows = await env.DB.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at',
    )
      .bind(campaignId)
      .all();
    const characters = characterRows.results.map((r) => toCharacter(r as never));
    const foe = characters.find((c) => c.id === characterId);
    if (!foe) return err('character not found', 404);
    // The posse is not the assistant's business (TEL-86) — enforced
    // here, not in the prompt, so no client can ask on a player's behalf.
    if (foe.kind === 'pc') return err('teller does not play player characters', 400);

    const session = await (
      await sessionStub(env, campaignId).fetch('https://do/session')
    ).json<SessionState>();

    // The map's true height: width × the art's aspect ratio, read off
    // the PNG header (8 bytes at offset 16) rather than stored — the
    // image already knows its own shape. Non-PNG art quietly degrades
    // to the old square assumption.
    const campaign = toCampaign(campaignRow as never);
    let heightInches: number | undefined;
    const scene =
      campaign.data.maps?.find((s) => s.id === campaign.data.activeMapId) ??
      campaign.data.maps?.[0];
    if (scene?.key && scene.widthInches) {
      const head = await env.MAPS.get(scene.key, { range: { offset: 0, length: 32 } });
      if (head) {
        const bytes = new Uint8Array(await head.arrayBuffer()).slice(0, 32);
        const isPng =
          bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        if (isPng && bytes.length >= 24) {
          const view = new DataView(bytes.buffer, bytes.byteOffset);
          const w = view.getUint32(16);
          const h = view.getUint32(20);
          if (w > 0 && h > 0) heightInches = (scene.widthInches * h) / w;
        }
      }
    }

    // What has already happened, attributed and oldest-first.
    //
    // SELECTION, not a bigger window (Brian, 2026-08-15: "I'd not want
    // something important involving the current actor to get lost").
    // A flat recency cap ages out in the worst possible order — eight
    // combatants trading blows will bury this creature's own grapple
    // from round one under eleven exchanges between strangers, and the
    // grapple is the single most load-bearing fact for its turn.
    //
    // So two reads: everything involving THIS combatant, which can
    // never fall off, plus the recent past for situational awareness.
    // `entity_id` is the target, and the actor is in the payload.
    const [own, latest] = await Promise.all([
      env.DB.prepare(
        `SELECT id, payload FROM events
           WHERE campaign_id = ? AND kind = 'turn.resolved'
             AND (entity_id = ? OR json_extract(payload, '$.by') = ?)
           ORDER BY id DESC LIMIT 10`,
      )
        .bind(campaignId, characterId, characterId)
        .all(),
      env.DB.prepare(
        `SELECT id, payload FROM events
           WHERE campaign_id = ? AND kind = 'turn.resolved'
           ORDER BY id DESC LIMIT 10`,
      )
        .bind(campaignId)
        .all(),
    ]);
    const seen = new Map<number, ResolvedTurn>();
    for (const row of [...own.results, ...latest.results]) {
      const { id, payload } = row as { id: number; payload: string };
      if (seen.has(id)) continue;
      try {
        const parsed = JSON.parse(String(payload)) as ResolvedTurn;
        if (parsed?.byName && parsed?.targetName) seen.set(id, parsed);
      } catch {
        // A payload we can't read is one line of history, not an error.
      }
    }
    // History outlives the creatures in it, and shouldn't.
    //
    // Clear the table and redeploy and you get NEW characters wearing
    // the old names, while the log still describes the dead ones — so
    // the board says a foe is at full health and the history says it
    // took two, which is exactly the contradiction the model caught
    // and flagged ("Board lists 34/34; log shows 32 — check tracker").
    // A line about somebody who no longer exists isn't context, it's a
    // ghost; drop it and let the board speak.
    const alive = new Set(characters.map((c) => c.id));
    const recent = [...seen.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, r]) => r)
      .filter((r) => alive.has(r.by) && alive.has(r.target));

    // Movement, same selection rule: this creature's own crossings
    // never age out, and the rest is whoever moved lately.
    const [ownMoves, lateMoves] = await Promise.all([
      env.DB.prepare(
        `SELECT id, payload FROM events
           WHERE campaign_id = ? AND kind = 'token.moved' AND entity_id = ?
           ORDER BY id DESC LIMIT 6`,
      )
        .bind(campaignId, characterId)
        .all(),
      env.DB.prepare(
        `SELECT id, payload FROM events
           WHERE campaign_id = ? AND kind = 'token.moved'
           ORDER BY id DESC LIMIT 10`,
      )
        .bind(campaignId)
        .all(),
    ]);
    const movesById = new Map<number, TokenMove>();
    for (const row of [...ownMoves.results, ...lateMoves.results]) {
      const { id, payload } = row as { id: number; payload: string };
      if (movesById.has(id)) continue;
      try {
        const parsed = JSON.parse(String(payload)) as TokenMove;
        if (parsed?.tokenId && parsed.to) movesById.set(id, parsed);
      } catch {
        // One unreadable line of history, not an error.
      }
    }
    // Same for movement: a token that belonged to a cleared creature
    // is a ghost walking. A move with no character at all (a marker,
    // a prop) is kept — nobody's health contradicts it.
    const moves = [...movesById.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, m]) => m)
      .filter((m) => !m.characterId || alive.has(m.characterId));

    try {
      const template = await getSystem(env, campaign.system);
      return json(
        ask === 'narrate'
          ? await narrateOutcome(
              env,
              campaign,
              characters,
              session,
              foe,
              action!,
              result!,
              heightInches,
              template?.space,
              recent,
              moves,
              preface,
            )
          : await suggestTurn(
              env,
              campaign,
              characters,
              session,
              foe,
              heightInches,
              template?.space,
              recent,
              moves,
            ),
      );
    } catch (e) {
      return err((e as Error).message, 502);
    }
  }

  if (pathname === '/api/campaigns' && method === 'GET') {
    if (!dm()) return err('DM key required', 401);
    const rows = await env.DB.prepare(
      'SELECT * FROM campaigns ORDER BY created_at DESC',
    ).all();
    return json(rows.results.map((r) => toCampaign(r as never)));
  }

  if (pathname === '/api/campaigns' && method === 'POST') {
    if (!dm()) return err('DM key required', 401);
    const body = await request.json<{ name?: string; system?: string }>();
    if (!body.name) return err('name required', 400);
    const template = await getSystem(env, body.system ?? '');
    if (!template) return err(`unknown system: ${body.system}`, 400);

    const id = newId('cmp');
    const data = {
      vocabulary: template.vocabulary,
      counters: countersFrom(template.campaign.counters),
      states: template.states ?? [],
    };
    await env.DB.prepare(
      'INSERT INTO campaigns (id, name, system, data) VALUES (?, ?, ?, ?)',
    )
      .bind(id, body.name, template.system, JSON.stringify(data))
      .run();
    await logEvent(env, id, null, 'dm', 'campaign.created', {
      name: body.name,
      system: template.system,
    });

    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(id)
      .first();
    return json(toCampaign(row as never), 201);
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (m && method === 'GET') {
    if (!dm(m[1])) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('campaign not found', 404);
    const chars = await env.DB.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at',
    )
      .bind(m[1])
      .all();
    const campaign = toCampaign(row as never);
    return json({
      campaign,
      characters: chars.results.map((r) => toCharacter(r as never)),
      // The whole shelf: what your packs bring plus what this campaign
      // wrote itself, with the campaign's own version winning.
      bestiary: await bestiaryFor(env, campaign),
      // Packs this campaign claims but this host doesn't hold. Named
      // here rather than discovered when a deploy comes up short.
      missingPacks: await missingPacks(env, campaign),
    });
  }

  // Undo: restore the `before` snapshot of the most recent un-reverted
  // mutation event. The event log is the source; a revert logs its own
  // event pointing at what it undid, so repeated undos walk backward.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/undo$/);
  if (m && method === 'POST') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignId = m[1];
    type EventRow = { id: number; entity_id: string | null; kind: string; payload: string };
    const reverts = await env.DB.prepare(
      "SELECT payload FROM events WHERE campaign_id = ? AND kind = 'revert'",
    )
      .bind(campaignId)
      .all();
    const revertedIds = new Set(
      reverts.results.map(
        (r) =>
          (JSON.parse((r as { payload: string }).payload) as { revertedEventId?: number })
            .revertedEventId,
      ),
    );
    const rows = await env.DB.prepare(
      `SELECT id, entity_id, kind, payload FROM events
       WHERE campaign_id = ? AND kind IN ('character.updated','campaign.updated','character.deleted')
       ORDER BY id DESC LIMIT 200`,
    )
      .bind(campaignId)
      .all();
    type Before = { name: string; kind?: string; data: unknown };
    let target: (EventRow & { before: Before }) | null = null;
    for (const raw of rows.results as EventRow[]) {
      if (revertedIds.has(raw.id)) continue;
      const payload = JSON.parse(raw.payload) as { before?: Before };
      if (payload.before) {
        target = { ...raw, before: payload.before };
        break;
      }
    }
    if (!target) return err('nothing to undo', 404);

    if (target.kind === 'campaign.updated') {
      await env.DB.prepare('UPDATE campaigns SET name = ?, data = ? WHERE id = ?')
        .bind(target.before.name, JSON.stringify(target.before.data), campaignId)
        .run();
    } else if (target.kind === 'character.deleted') {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO characters (id, campaign_id, name, kind, data) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          target.entity_id,
          campaignId,
          target.before.name,
          target.before.kind ?? 'pc',
          JSON.stringify(target.before.data),
        )
        .run();
    } else {
      await env.DB.prepare(
        "UPDATE characters SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(target.before.name, JSON.stringify(target.before.data), target.entity_id)
        .run();
    }
    await logEvent(env, campaignId, target.entity_id, 'dm', 'revert', {
      revertedEventId: target.id,
      kind: target.kind,
    });
    await poke(env, campaignId, target.entity_id ?? 'campaign');
    return json({ undid: target.kind, entityId: target.entity_id });
  }

  // Look inside a .story file without unpacking it — what's in the box,
  // with counts, so the choice of what to take is an informed one.
  if (pathname === '/api/bundles/inspect' && method === 'POST') {
    if (!dm()) return err('DM key required', 401);
    try {
      return json(await inspectBundle(await request.arrayBuffer(), env));
    } catch (e) {
      return err(e instanceof Error ? e.message : 'could not read that file', 400);
    }
  }

  // Unpack one. `campaign` merges into an existing table; without it a
  // new campaign is made from the bundle.
  if (pathname === '/api/bundles/import' && method === 'POST') {
    if (!dm(url.searchParams.get('campaign') ?? undefined)) {
      return err('DM key required', 401);
    }
    try {
      const sections = url.searchParams.get('sections');
      const result = await applyBundle(env, await request.arrayBuffer(), {
        campaignId: url.searchParams.get('campaign') ?? undefined,
        sections: sections ? sections.split(',').filter(Boolean) : undefined,
        name: url.searchParams.get('name') ?? undefined,
      });
      await logEvent(env, result.campaignId, null, 'dm', 'bundle.imported', {
        applied: result.applied,
      });
      return json(result);
    } catch (e) {
      return err(e instanceof Error ? e.message : 'import failed', 400);
    }
  }

  // Export the whole campaign as a .story bundle.
  //
  // Also the backup. Once teller runs on a host under your table there
  // is no copy anywhere else, so this file is the only thing standing
  // between a dead drive and a dead campaign.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/export$/);
  if (m && method === 'GET') {
    if (!dm(m[1])) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('campaign not found', 404);
    const campaign = toCampaign(row as never);
    const chars = await env.DB.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at',
    )
      .bind(m[1])
      .all();
    const all = chars.results.map((r) => toCharacter(r as never));
    const template = await getSystem(env, campaign.system);

    // Sections are opt-out, so you can take the structure without the
    // hundred megabytes of art when all you want is the shape.
    const want = (name: string) => url.searchParams.get(name) !== '0';

    // A bundle's job is to START a table, not to preserve one — the
    // host's database is where a campaign continues to live. So by
    // default this exports the module shape: the cast, the prepared
    // fights, the maps. NPCs currently on the table are a fight in
    // progress and belong to this table only; `?live=1` takes them
    // anyway, for handing your actual game to someone else.
    const live = url.searchParams.get('live') === '1';
    const characters = live ? all : all.filter((c) => c.kind === 'pc');

    const body = exportCampaign(env, campaign, characters, template, {
      books: want('books'),
      assets: want('assets'),
    });
    return new Response(body, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${bundleFilename(campaign)}"`,
        'cache-control': 'no-store',
      },
    });
  }

  // Battle map: PUT raw image → R2, pointer on campaign.data.map.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/map$/);
  if (m) {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignRow = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);

    if (method === 'PUT') {
      const contentType = request.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) return err('image body required', 400);
      const ext = contentType.split('/')[1]?.split('+')[0] ?? 'img';
      const key = `map/${campaign.id}/${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${ext}`;
      await env.MAPS.put(key, request.body, { httpMetadata: { contentType } });
      const next = { ...campaign.data, map: { key } };
      await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
        .bind(JSON.stringify(next), campaign.id)
        .run();
      await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
        patch: { map: { key } },
        before: { name: campaign.name, data: campaign.data },
      });
      await poke(env, campaign.id, 'campaign');
      return json({ map: { key } }, 201);
    }

    if (method === 'DELETE') {
      // Pointer only — objects stay (undo-safe; storage is trivial here).
      const next = { ...campaign.data, map: undefined };
      await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
        .bind(JSON.stringify(next), campaign.id)
        .run();
      await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
        patch: { map: null },
        before: { name: campaign.name, data: campaign.data },
      });
      await poke(env, campaign.id, 'campaign');
      return json({ ok: true });
    }
  }

  // Scene library: named battle maps / splash art for the table TV.
  // Same shape as handouts; the active one renders on /table.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/maps$/);
  if (m && method === 'POST') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignRow = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return err('image body required', 400);
    const ext = contentType.split('/')[1]?.split('+')[0] ?? 'img';
    const key = `map/${campaign.id}/${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${ext}`;
    await env.MAPS.put(key, request.body, { httpMetadata: { contentType } });
    const name = new URL(request.url).searchParams.get('name')?.trim() || 'Scene';
    const scene = {
      id: `scn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      key,
      name,
    };
    const next = {
      ...campaign.data,
      maps: [...(campaign.data.maps ?? []), scene],
    };
    await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
      .bind(JSON.stringify(next), campaign.id)
      .run();
    await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
      patch: { scene },
      before: { name: campaign.name, data: campaign.data },
    });
    await poke(env, campaign.id, 'campaign');
    return json({ scene }, 201);
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/maps\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignRow = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);
    const sceneId = m[2];
    // Pointer only — objects stay (undo-safe; storage is trivial here).
    const next = {
      ...campaign.data,
      maps: (campaign.data.maps ?? []).filter((s) => s.id !== sceneId),
      activeMapId:
        campaign.data.activeMapId === sceneId ? null : campaign.data.activeMapId,
    };
    await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
      .bind(JSON.stringify(next), campaign.id)
      .run();
    await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
      patch: { removeScene: sceneId },
      before: { name: campaign.name, data: campaign.data },
    });
    await poke(env, campaign.id, 'campaign');
    return json({ ok: true });
  }

  // Handouts: an image library the DM pushes to player-facing surfaces.
  // Library is DM-only; only the ACTIVE handout leaves via /public.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/handouts$/);
  if (m && method === 'POST') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignRow = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return err('image body required', 400);
    const ext = contentType.split('/')[1]?.split('+')[0] ?? 'img';
    const key = `handout/${campaign.id}/${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${ext}`;
    await env.MAPS.put(key, request.body, { httpMetadata: { contentType } });
    const name =
      new URL(request.url).searchParams.get('name')?.trim() || 'Handout';
    const handout = {
      id: `hnd_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      key,
      name,
    };
    const next = {
      ...campaign.data,
      handouts: [...(campaign.data.handouts ?? []), handout],
    };
    await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
      .bind(JSON.stringify(next), campaign.id)
      .run();
    await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
      patch: { handout },
      before: { name: campaign.name, data: campaign.data },
    });
    await poke(env, campaign.id, 'campaign');
    return json({ handout }, 201);
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/handouts\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignRow = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);
    const handoutId = m[2];
    // Pointer only — objects stay (undo-safe; storage is trivial here).
    const next = {
      ...campaign.data,
      handouts: (campaign.data.handouts ?? []).filter((h) => h.id !== handoutId),
      activeHandoutId:
        campaign.data.activeHandoutId === handoutId
          ? null
          : campaign.data.activeHandoutId,
    };
    await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
      .bind(JSON.stringify(next), campaign.id)
      .run();
    await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
      patch: { removeHandout: handoutId },
      before: { name: campaign.name, data: campaign.data },
    });
    await poke(env, campaign.id, 'campaign');
    return json({ ok: true });
  }

  // Serve object-store images.
  //
  // Two kinds of key live in here and they deserve different answers.
  // A MINTED key (`map/…`, `handout/…`) is a fresh random string per
  // upload, and a book's is the sha-256 of its own bytes — in both
  // cases the key NAMES the bytes, so re-editing means a new URL and
  // `immutable` is simply true. An AUTHORED key is a path a person
  // chose (`art/wiw/trd_marshal.png`), and the whole point of such a
  // name is that it survives the file being corrected. Serving that as
  // immutable promises something the key can't keep: the portraits
  // were cleaned up on disk and every panel that had already loaded
  // them would have gone on showing the old ones for a year.
  //
  // So: named-by-content caches forever, named-by-hand revalidates.
  // The validator makes that cheap — a panel re-asks and gets a
  // bodiless 304 unless the bytes really moved.
  m = pathname.match(/^\/api\/maps\/(.+)$/);
  if (m && method === 'GET') {
    const key = decodeURIComponent(m[1]);
    const object = await env.MAPS.get(key);
    if (!object) return err('not found', 404);
    const minted = /^(map|handout|books)\//.test(key);
    const headers: Record<string, string> = {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': minted
        ? 'public, max-age=31536000, immutable'
        : 'public, no-cache',
    };
    // R2 spells it `httpEtag` (already quoted); the host shim supplies
    // the same field, so the route never learns which one answered.
    const etag = object.httpEtag ?? undefined;
    if (!minted && etag) {
      headers.etag = etag;
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers });
      }
    }
    return new Response(object.body, { headers });
  }

  // Player-safe campaign snapshot for the passive displays (board,
  // table). No auth: everything here is table-visible by design.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/public$/);
  if (m && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('campaign not found', 404);
    const chars = await env.DB.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at',
    )
      .bind(m[1])
      .all();
    const campaign = toCampaign(row as never);
    return json({
      // Reference (Warden's notes/rules text) never leaves via /public,
      // hidden counters stay behind the screen until revealed, and the
      // handout LIBRARY stays private — only the active handout shows.
      campaign: {
        ...campaign,
        data: {
          vocabulary: campaign.data.vocabulary,
          counters: publicCounters(campaign.data.counters),
          // Vocabulary, so the table can turn a tag into a visual. The
          // tags themselves are already table-safe; numbers are not and
          // never come with them.
          states: campaign.data.states ?? [],
          grid: campaign.data.grid,
          // Active scene (with view/scale metadata); legacy single-map
          // pointer keeps old campaigns rendering.
          // Hidden tokens and painted zones are stripped here, not
          // merely styled away: what's behind the screen never reaches
          // the table client at all.
          scene: publicScene(campaign.data),
          map: campaign.data.map ?? null,
          handout:
            (campaign.data.handouts ?? []).find(
              (h) => h.id === campaign.data.activeHandoutId,
            ) ?? null,
        },
      },
      characters: chars.results.map((r) => toPublicCharacter(r as never)),
    });
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignId = m[1];
    await env.DB.prepare('DELETE FROM events WHERE campaign_id = ?').bind(campaignId).run();
    await env.DB.prepare('DELETE FROM characters WHERE campaign_id = ?').bind(campaignId).run();
    await env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(campaignId).run();
    return json({ ok: true });
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (m && method === 'PATCH') {
    if (!dm(m[1])) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('campaign not found', 404);
    const campaign = toCampaign(row as never);
    const body = await request.json<{
      name?: string;
      data?: Partial<Campaign['data']>;
    }>();
    // Carry the full stored blob forward; only these keys are patchable
    // here (map/handouts change only via their own endpoints).
    const next = {
      ...campaign.data,
      vocabulary: body.data?.vocabulary ?? campaign.data.vocabulary,
      counters: body.data?.counters ?? campaign.data.counters,
      states: body.data?.states ?? campaign.data.states,
      npcs: body.data?.npcs ?? campaign.data.npcs,
      encounters: body.data?.encounters ?? campaign.data.encounters,
      books: body.data?.books ?? campaign.data.books,
      packs: body.data?.packs ?? campaign.data.packs,
      foePicks: body.data?.foePicks ?? campaign.data.foePicks,
      reference: body.data?.reference ?? campaign.data.reference,
      // This table's own gear. Second time this allowlist has silently
      // eaten a new key — a patch carrying it returns 200 and writes
      // nothing, which reads as a client bug for as long as it takes to
      // find. If you add a patchable key to `CampaignData`, add it here
      // in the same commit.
      catalog: body.data?.catalog ?? campaign.data.catalog,
      vendors: body.data?.vendors ?? campaign.data.vendors,
      activeHandoutId:
        body.data?.activeHandoutId !== undefined
          ? body.data.activeHandoutId
          : campaign.data.activeHandoutId,
      activeMapId:
        body.data?.activeMapId !== undefined
          ? body.data.activeMapId
          : campaign.data.activeMapId,
      grid: body.data?.grid !== undefined ? body.data.grid : campaign.data.grid,
      // Scene metadata edits (widthInches/view; later fog/tokens) patch
      // the whole array, counters-style. Upload/delete have their own
      // endpoints.
      maps: body.data?.maps ?? campaign.data.maps,
    };
    await env.DB.prepare('UPDATE campaigns SET name = ?, data = ? WHERE id = ?')
      .bind(body.name ?? campaign.name, JSON.stringify(next), campaign.id)
      .run();
    await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
      patch: body,
      before: { name: campaign.name, data: campaign.data },
    });
    await poke(env, campaign.id, 'campaign');
    const updated = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(campaign.id)
      .first();
    return json(toCampaign(updated as never));
  }

  m = pathname.match(/^\/api\/characters\/([^/]+)$/);
  if (m && method === 'DELETE') {
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const character = toCharacter(row as never);
    // Scoped to the character's own campaign — a console is a console
    // for the table it was claimed into, not for every table.
    if (!dm(character.campaignId)) return err('DM key required', 401);
    await env.DB.prepare('DELETE FROM characters WHERE id = ?')
      .bind(character.id)
      .run();
    await logEvent(
      env,
      character.campaignId,
      character.id,
      'dm',
      'character.deleted',
      {
        name: character.name,
        before: { name: character.name, kind: character.kind, data: character.data },
      },
    );
    await poke(env, character.campaignId, character.id);
    return json({ ok: true });
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/characters$/);
  if (m && method === 'POST') {
    if (!dm(m[1])) return err('DM key required', 401);
    const campaignId = m[1];
    const campaignRow = await env.DB.prepare(
      'SELECT * FROM campaigns WHERE id = ?',
    )
      .bind(campaignId)
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);
    const template = await getSystem(env, campaign.system);

    const body = await request.json<{ name?: string; kind?: string }>();
    if (!body.name) return err('name required', 400);
    const kind = body.kind === 'npc' ? 'npc' : 'pc';
    const kit =
      (kind === 'npc' ? template?.npc : undefined) ?? template?.character;

    const id = newId('chr');
    const data: CharacterData = {
      fields: (kit?.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        value: f.value ?? '',
      })),
      counters: countersFrom(kit?.counters ?? []),
      tags: [...(kit?.tags ?? [])],
      notes: '',
    };
    await env.DB.prepare(
      'INSERT INTO characters (id, campaign_id, name, kind, data) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, campaignId, body.name, kind, JSON.stringify(data))
      .run();
    await logEvent(env, campaignId, id, 'dm', 'character.created', {
      name: body.name,
    });
    await poke(env, campaignId, id);

    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(id)
      .first();
    return json(toCharacter(row as never), 201);
  }

  // Duplicate a character: same sheet, fresh identity.
  // The workhorse for NPC packs — make one Coyote, stamp out five.
  m = pathname.match(/^\/api\/characters\/([^/]+)\/duplicate$/);
  if (m && method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const source = toCharacter(row as never);
    if (!dm(source.campaignId)) return err('DM key required', 401);
    const id = newId('chr');
    const data: CharacterData = structuredClone(source.data);
    const name = `${source.name} (copy)`;
    await env.DB.prepare(
      'INSERT INTO characters (id, campaign_id, name, kind, data) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(id, source.campaignId, name, source.kind, JSON.stringify(data))
      .run();
    await logEvent(env, source.campaignId, id, 'dm', 'character.created', {
      name,
      duplicatedFrom: source.id,
    });
    await poke(env, source.campaignId, id);
    const created = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(id)
      .first();
    return json(toCharacter(created as never), 201);
  }

  m = pathname.match(/^\/api\/characters\/([^/]+)$/);
  if (m && method === 'PATCH') {
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const character = toCharacter(row as never);

    // The DM may edit anyone; a seat may edit the one character it was
    // pointed at. Nothing here consults a secret — only the assignment.
    if (!canEditCharacter(auth, character.campaignId, character.id)) {
      return err('not your character', 401);
    }

    const body = await request.json<{ name?: string; data?: Partial<CharacterData> }>();
    const patch = body.data ?? {};
    // Spread FIRST, then overlay the editable keys.
    //
    // This used to enumerate the four editable fields and rebuild `data`
    // from them, which silently dropped everything else on every edit —
    // `encounterId` and `blueprintId` in particular. Damaging a deployed
    // monster orphaned it from its fight, so `clear` walked straight
    // past it and left a creature on the table that only a hand-delete
    // could remove. Provenance is not editable, but it must SURVIVE an
    // edit.
    //
    // The overlay below is an ALLOWLIST of what a client may change, and
    // that is deliberate — provenance must survive an edit and must not
    // be settable by one. The cost is that **a new editable key has to
    // be added here or it is silently ignored**: `items` was, and a
    // patch carrying three weapons returned 200 with nothing written.
    // If you add something to `CharacterData` that a person edits, add
    // it here in the same commit.
    const next: CharacterData = {
      ...character.data,
      fields: patch.fields ?? character.data.fields,
      counters: patch.counters ?? character.data.counters,
      tags: patch.tags ?? character.data.tags,
      notes: patch.notes ?? character.data.notes,
      items: patch.items ?? character.data.items,
      // `draft` is flow state, not provenance — the builder's last step
      // clears it, so an explicit false must land (?? would eat it).
      draft: patch.draft !== undefined ? patch.draft : character.data.draft,
    };
    // A player may name their OWN character — the builder's last step
    // asks "what do they call ya?" from the seat, and the seat already
    // holds edit rights over exactly this one character (rule 7).
    const name = body.name ?? character.name;

    await env.DB.prepare(
      "UPDATE characters SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(name, JSON.stringify(next), character.id)
      .run();
    await logEvent(
      env,
      character.campaignId,
      character.id,
      actorOf(auth),
      'character.updated',
      { patch, before: { name: character.name, data: character.data } },
    );
    await poke(env, character.campaignId, character.id);

    const updated = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(character.id)
      .first();
    return json(toCharacter(updated as never));
  }

  // Public single-character snapshot — powers the table-facing player
  // badge. Same redaction rules as the campaign /public endpoint.
  m = pathname.match(/^\/api\/characters\/([^/]+)\/public$/);
  if (m && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const character = toPublicCharacter(row as never);
    const campaignRow = await env.DB.prepare(
      'SELECT * FROM campaigns WHERE id = ?',
    )
      .bind(character.campaignId)
      .first();
    const campaign = campaignRow ? toCampaign(campaignRow as never) : null;
    return json({
      character,
      campaign: campaign
        ? {
            id: campaign.id,
            name: campaign.name,
            vocabulary: campaign.data.vocabulary,
          }
        : null,
    });
  }

  // Seat view: character + campaign vocabulary. Gated by assignment —
  // this screen is Ragnar's because the DM said so, not because it
  // knows a string.
  m = pathname.match(/^\/api\/seat\/([^/]+)$/);
  if (m && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const character = toCharacter(row as never);
    if (!canEditCharacter(auth, character.campaignId, character.id)) {
      return err('not your character', 401);
    }
    const campaignRow = await env.DB.prepare(
      'SELECT * FROM campaigns WHERE id = ?',
    )
      .bind(character.campaignId)
      .first();
    const campaign = campaignRow ? toCampaign(campaignRow as never) : null;
    // Seats get the rules packs too — a seat at the table is a seat at
    // the table, and the table gets to read the rules. The campaign's
    // own list, not every pack for the system: a player looking
    // something up should see what THIS table runs on.
    return json({
      character,
      campaign,
      packs: campaign ? await packsFor(env, campaign) : [],
    });
  }

  // Calibration pattern for the table screen. Transient and never
  // stored: it goes straight out over SSE and the table forgets it the
  // moment the console sends null.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/calibration$/);
  if (m && method === 'POST') {
    if (!dm(m[1])) return err('DM key required', 401);
    const body = await request.json<{ calibration: Calibration | null }>();
    await sessionStub(env, m[1]).fetch('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'calibration',
        calibration: body.calibration ?? null,
      }),
    });
    return json({ ok: true });
  }


  // The overhead camera's overlay for the table screen. Same transient
  // contract as calibration: straight out over SSE, nothing stored.
  // The camera daemon (rnd/camera, holding the DM key locally) posts
  // one of these per processed frame; the table clears itself when
  // they stop coming.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/camera$/);
  if (m && method === 'POST') {
    if (!dm(m[1])) return err('DM key required', 401);
    const body = await request.json<{ camera: CameraOverlay | null }>();
    await sessionStub(env, m[1]).fetch('https://do/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        type: 'camera',
        camera: body.camera ?? null,
      }),
    });
    return json({ ok: true });
  }

  // Put a prepared fight on the table.
  //
  // Deploying is a RESET, not an append: it clears any creatures this
  // encounter previously put out, then stamps a fresh set. So running it
  // twice is "start this fight again" — which is what a TPK retry wants —
  // rather than silently doubling every foe.
  //
  // A placement whose blueprint can't be resolved is reported, never
  // skipped in silence: a fight that comes up half-empty because a pack
  // is missing must say so.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/encounters\/([^/]+)\/deploy$/);
  if (m && method === 'POST') {
    const [, campaignId, encounterId] = m;
    if (!dm(campaignId)) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(campaignId)
      .first();
    if (!row) return err('campaign not found', 404);
    const campaign = toCampaign(row as never);
    const encounter = (campaign.data.encounters ?? []).find((e) => e.id === encounterId);
    if (!encounter) return err('encounter not found', 404);

    const bestiary = await bestiaryFor(env, campaign);
    const byId = new Map(bestiary.map((n) => [n.id, n]));

    // Number only what repeats: three of one blueprint become "1..3",
    // but a placement you named yourself keeps its name, and a lone foe
    // is never "Bloodsucker 1".
    const counts = new Map<string, number>();
    for (const foe of encounter.foes) {
      if (foe.name) continue;
      counts.set(foe.blueprintId, (counts.get(foe.blueprintId) ?? 0) + 1);
    }
    const seen = new Map<string, number>();

    const created: Character[] = [];
    const missing: string[] = [];
    const tokens: Token[] = [];
    // What each foe rolled for turn order, keyed by the character it
    // made. The caller puts them in the list — the roll is the part a
    // human doesn't want to do, the ordering is still theirs to change.
    const rolls: Record<string, { total: number; faces: string[] }> = {};
    const template = await getSystem(env, campaign.system);

    for (const [index, foe] of encounter.foes.entries()) {
      const blueprint = byId.get(foe.blueprintId);
      if (!blueprint) {
        missing.push(foe.name ?? foe.blueprintId);
        continue;
      }
      let name = foe.name ?? blueprint.name;
      if (!foe.name && (counts.get(foe.blueprintId) ?? 0) > 1) {
        const n = (seen.get(foe.blueprintId) ?? 0) + 1;
        seen.set(foe.blueprintId, n);
        name = `${blueprint.name} ${n}`;
      }

      const id = newId('chr');
      const data: CharacterData = stamp(blueprint, foe);
      await env.DB.prepare(
        'INSERT INTO characters (id, campaign_id, name, kind, data) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(id, campaignId, name, 'npc', JSON.stringify(data))
        .run();
      await logEvent(env, campaignId, id, actorOf(auth), 'character.created', {
        name,
        spawnedFrom: blueprint.id,
      });
      const fresh = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
        .bind(id)
        .first();
      created.push(toCharacter(fresh as never));
      const roll = rollInitiative(template, data.fields);
      if (roll) rolls[id] = { total: roll.total, faces: roll.faces };

      // A placement only becomes a token when there's a board to put it
      // on AND somewhere to put it. Mapless fights make none, which is
      // the common case and not a degraded one.
      if (encounter.sceneId && foe.u !== undefined && foe.v !== undefined) {
        tokens.push({
          id: newId('tok'),
          label: name,
          u: foe.u,
          v: foe.v,
          sizeInches: foe.sizeInches ?? 1,
          color: tokenColor(index),
          characterId: id,
          hidden: foe.hidden ?? false,
        });
      }
    }

    if (tokens.length) {
      const maps = (campaign.data.maps ?? []).map((scene) =>
        scene.id === encounter.sceneId
          ? { ...scene, tokens: [...(scene.tokens ?? []), ...tokens] }
          : scene,
      );
      await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
        .bind(JSON.stringify({ ...campaign.data, maps }), campaignId)
        .run();
    }

    await logEvent(env, campaignId, encounterId, actorOf(auth), 'encounter.deployed', {
      name: encounter.name,
      foes: created.length,
      missing,
    });
    await poke(env, campaignId, 'campaign');
    return json({ characters: created, missing, rolls }, 201);
  }


  // Stamp a blueprint out into real characters. One request so a group
  // arrives together; what comes back is ordinary characters — editable,
  // deletable, and no longer linked to the blueprint.
  /**
   * One exchange, landed and RECORDED AS ONE ACT.
   *
   * The client could apply damage with an ordinary character PATCH —
   * it used to — but then the state change and the story of it are two
   * writes that can drift, and the log ends up saying "the dm changed
   * some counters" about the moment a monster got someone by the legs.
   * Applying here means the event cannot disagree with the state it
   * describes, and the assistant gets a history worth reading.
   *
   * Still nothing automatic: this runs because a human pressed apply
   * on arithmetic teller had already shown them (rule 1).
   */
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/resolve$/);
  if (m && method === 'POST') {
    const campaignId = m[1];
    if (!dm(campaignId)) return err('DM key required', 401);
    const body = await request.json<{
      actorId?: string;
      targetId?: string;
      action?: string;
      hits?: number;
      blocked?: number;
      damage?: number;
      statuses?: { name: string; severity: number }[];
      spend?: { counter: string; amount: number };
    }>();
    if (!body.actorId || !body.targetId) return err('actorId and targetId required', 400);

    const rows = await env.DB.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? AND id IN (?, ?)',
    )
      .bind(campaignId, body.actorId, body.targetId)
      .all();
    const found = rows.results.map((r) => toCharacter(r as never));
    const actor = found.find((c) => c.id === body.actorId);
    const target = found.find((c) => c.id === body.targetId);
    if (!actor || !target) return err('actor or target not in this campaign', 404);

    const damage = Math.max(0, Math.round(body.damage ?? 0));
    const statuses = (body.statuses ?? []).filter(
      (s) => s && typeof s.name === 'string' && s.name.trim(),
    );

    // The vital counter is the first bounded one, exactly as every
    // other surface decides it.
    const vitalIndex = target.data.counters.findIndex((c) => c.max !== null && c.max > 0);
    const vital = vitalIndex >= 0 ? target.data.counters[vitalIndex] : undefined;
    const counters = target.data.counters.map((c, i) =>
      i === vitalIndex ? { ...c, current: Math.max(0, c.current - damage) } : c,
    );
    const tags = [...target.data.tags];
    for (const s of statuses) {
      const tag = `${s.name} ${s.severity}`.trim();
      if (!tags.includes(tag)) tags.push(tag);
    }

    const next: CharacterData = { ...target.data, counters, tags };
    await env.DB.prepare(
      "UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(JSON.stringify(next), target.id)
      .run();

    // The ACTOR pays for the turn (Brian, 2026-08-15: "it didn't deduct
    // grit from the npc"). An exchange was only ever half-written down:
    // the target lost health and the thing that swung paid nothing, so
    // a creature could attack every round forever. The counter is NAMED
    // by the caller — read off the attack's own printed cost — because
    // what a turn spends is the system's business, not teller's.
    const spend = body.spend;
    if (spend?.counter && spend.amount > 0) {
      const paid = actor.data.counters.map((c) =>
        c.name.toLowerCase() === spend.counter.toLowerCase()
          ? { ...c, current: Math.max(0, c.current - Math.round(spend.amount)) }
          : c,
      );
      await env.DB.prepare(
        "UPDATE characters SET data = ?, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(JSON.stringify({ ...actor.data, counters: paid }), actor.id)
        .run();
      await poke(env, campaignId, actor.id);
    }

    const session = await (
      await sessionStub(env, campaignId).fetch('https://do/session')
    ).json<SessionState>();

    const resolved: ResolvedTurn = {
      by: actor.id,
      byName: actor.name,
      target: target.id,
      targetName: target.name,
      action: (body.action ?? '').trim() || 'an attack',
      hits: Math.max(0, Math.round(body.hits ?? 0)),
      blocked: Math.max(0, Math.round(body.blocked ?? 0)),
      damage,
      ...(vital
        ? {
            vital: {
              name: vital.name,
              from: vital.current,
              to: Math.max(0, vital.current - damage),
            },
          }
        : {}),
      statuses,
      ...(body.spend && body.spend.amount > 0
        ? { spend: { counter: body.spend.counter, amount: Math.round(body.spend.amount) } }
        : {}),
      round: session?.round ?? 1,
    };
    await logEvent(env, campaignId, target.id, actorOf(auth), 'turn.resolved', resolved);
    await poke(env, campaignId, target.id);

    const updated = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(target.id)
      .first();
    return json({ character: toCharacter(updated as never), resolved });
  }

  /**
   * A token finished crossing ground. Records only — the scene write
   * that moved it already happened, and re-applying it here would make
   * two authorities for one position. If this call is lost, the token
   * is still where the Warden put it and only the history is thinner.
   */
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/moved$/);
  if (m && method === 'POST') {
    const campaignId = m[1];
    if (!dm(campaignId)) return err('DM key required', 401);
    const body = await request.json<Omit<TokenMove, 'round'>>();
    if (!body?.tokenId || !body.from || !body.to) return err('a move needs its ends', 400);

    const session = await (
      await sessionStub(env, campaignId).fetch('https://do/session')
    ).json<SessionState>();
    const move: TokenMove = {
      tokenId: body.tokenId,
      ...(body.characterId ? { characterId: body.characterId } : {}),
      label: String(body.label ?? 'something'),
      from: { x: Number(body.from.x) || 0, y: Number(body.from.y) || 0 },
      to: { x: Number(body.to.x) || 0, y: Number(body.to.y) || 0 },
      distance: Math.round((Number(body.distance) || 0) * 10) / 10,
      round: session?.round ?? 1,
    };
    await logEvent(
      env,
      campaignId,
      move.characterId ?? null,
      actorOf(auth),
      'token.moved',
      move,
    );
    return json({ ok: true });
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/spawn$/);
  if (m && method === 'POST') {
    const campaignId = m[1];
    if (!dm(campaignId)) return err('DM key required', 401);
    const body = await request.json<{ npcId?: string; count?: number }>();
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(campaignId)
      .first();
    if (!row) return err('campaign not found', 404);
    const campaign = toCampaign(row as never);
    // Foes come from the campaign OR from any pack for this system —
    // having the pack means having the monsters.
    const blueprint = await findBlueprint(env, campaign, body.npcId ?? '');
    if (!blueprint) return err('npc not found', 404);
    const count = Math.min(20, Math.max(1, Math.round(body.count ?? 1)));

    const created: Character[] = [];
    for (let i = 0; i < count; i++) {
      const id = newId('chr');
      // Numbered only when there is more than one — "Coyote" alone
      // shouldn't become "Coyote 1".
      const name = count > 1 ? `${blueprint.name} ${i + 1}` : blueprint.name;
      const data: CharacterData = stamp(blueprint);
      await env.DB.prepare(
        'INSERT INTO characters (id, campaign_id, name, kind, data) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(id, campaignId, name, 'npc', JSON.stringify(data))
        .run();
      await logEvent(env, campaignId, id, actorOf(auth), 'character.created', {
        name,
        spawnedFrom: blueprint.id,
      });
      const fresh = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
        .bind(id)
        .first();
      created.push(toCharacter(fresh as never));
    }
    await poke(env, campaignId, 'campaign');
    return json({ characters: created }, 201);
  }

  // A screen asking for permission to listen. Any role the DM adopted
  // into this campaign may have one — a table TV needs turn order as
  // much as the console does.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/stream-ticket$/);
  if (m && method === 'POST') {
    if (!canWatch(auth, m[1])) return err('not part of this table', 401);
    if (!env.DM_KEY) return err('this instance has no key set', 500);
    const ticket = await mintTicket(env.DM_KEY, m[1], STREAM_MINUTES);
    return json({ ticket });
  }

  // Sweep the table: every NPC off, whatever put it there.
  //
  // Per-encounter clear is precise and depends on a foe remembering
  // which fight it came from. This one doesn't care — a stray from an
  // older build, something spawned ad-hoc, a fight cleared while you
  // weren't looking. If it's an NPC it's on the table, and the table is
  // being wiped.
  //
  // PCs are never touched: the party isn't scenery. A recurring NPC
  // belongs in the bestiary as a blueprint and gets deployed when they
  // turn up, so nothing durable lives here to lose.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/table\/clear$/);
  if (m && method === 'POST') {
    const campaignId = m[1];
    if (!dm(campaignId)) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(campaignId)
      .first();
    if (!row) return err('campaign not found', 404);
    const campaign = toCampaign(row as never);

    const rows = await env.DB.prepare(
      "SELECT id, name FROM characters WHERE campaign_id = ? AND kind = 'npc'",
    )
      .bind(campaignId)
      .all();
    const doomed = rows.results as { id: string; name: string }[];

    for (const c of doomed) {
      await env.DB.prepare('DELETE FROM characters WHERE id = ?').bind(c.id).run();
    }

    if (doomed.length) {
      // Their markers go with them — a token pointing at a character
      // that no longer exists is a ghost on the table.
      const gone = new Set(doomed.map((c) => c.id));
      const maps = (campaign.data.maps ?? []).map((scene) => ({
        ...scene,
        tokens: (scene.tokens ?? []).filter(
          (t) => !(t.characterId && gone.has(t.characterId)),
        ),
      }));
      await env.DB.prepare('UPDATE campaigns SET data = ? WHERE id = ?')
        .bind(JSON.stringify({ ...campaign.data, maps }), campaignId)
        .run();

      // And their places in the order, or the turn walks onto a corpse.
      const state = await (
        await sessionStub(env, campaignId).fetch('https://do/session')
      ).json<SessionState>();
      const initiative = state.initiative.filter(
        (e) => !(e.characterId && gone.has(e.characterId)),
      );
      if (initiative.length !== state.initiative.length) {
        await sessionStub(env, campaignId).fetch('https://do/session', {
          method: 'POST',
          body: JSON.stringify({ op: 'set', initiative }),
        });
      }

      await logEvent(env, campaignId, null, actorOf(auth), 'table.cleared', {
        removed: doomed.map((c) => c.name),
      });
      await poke(env, campaignId, 'campaign');
    }

    return json({ cleared: doomed.length });
  }

  // Roll for everything the table isn't rolling for itself.
  //
  // Players roll real dice and report from their seats; nobody wants to
  // do that on behalf of six coyotes. So this fills in a score for every
  // entry pointing at an NPC and leaves the PCs alone — which is also
  // why opening the rolling phase can safely wipe the board: whatever
  // teller rolled, teller can roll again.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/initiative\/roll$/);
  if (m && method === 'POST') {
    const campaignId = m[1];
    if (!dm(campaignId)) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(campaignId)
      .first();
    if (!row) return err('campaign not found', 404);
    const campaign = toCampaign(row as never);
    const template = await getSystem(env, campaign.system);

    const chars = await env.DB.prepare(
      "SELECT * FROM characters WHERE campaign_id = ? AND kind = 'npc'",
    )
      .bind(campaignId)
      .all();
    const foes = new Map(
      chars.results.map((r) => {
        const c = toCharacter(r as never);
        return [c.id, c];
      }),
    );

    const state = await (
      await sessionStub(env, campaignId).fetch('https://do/session')
    ).json<SessionState>();

    let rolled = 0;
    const initiative = state.initiative.map((entry) => {
      const foe = entry.characterId ? foes.get(entry.characterId) : undefined;
      if (!foe) return entry;
      const roll = rollInitiative(template, foe.data.fields);
      if (!roll) return entry;
      rolled += 1;
      return { ...entry, score: roll.total };
    });

    // `set` deliberately does not sort — it's what dragging uses — so
    // the ordering happens here, by the same rule the DO applies when a
    // score lands: highest first, and anyone still to roll waits at the
    // back rather than being assumed to have rolled nothing.
    initiative.sort((a, b) => {
      const x = typeof a.score === 'number' ? a.score : null;
      const y = typeof b.score === 'number' ? b.score : null;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return y - x;
    });

    const next = await sessionStub(env, campaignId).fetch('https://do/session', {
      method: 'POST',
      body: JSON.stringify({ op: 'set', initiative }),
    });
    const saved = await next.json<SessionState>();
    return json({ session: saved, rolled });
  }

  // Live session — SSE stream + initiative ops, forwarded to the DO.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/(stream|session)$/);
  if (m) {
    if (m[2] === 'session' && method === 'POST') {
      const campaignId = m[1];
      const op = await request.json<SessionOp>();

      // Everything about the fight is the DM's, with the exceptions a
      // seat has always had over its own character (rule 7): a player
      // reports their own initiative roll, and fills their own cart at
      // an open shop. Neither rearranges anything of anyone else's —
      // a score is what their dice showed, a cart is what they're
      // holding, and the ruling on both stays the DM's.
      if (!dm(campaignId)) {
        if (op.op === 'score') {
          const current = await (
            await sessionStub(env, campaignId).fetch('https://do/session')
          ).json<SessionState>();
          const entry = current.initiative.find((e) => e.id === op.entryId);
          if (
            !entry?.characterId ||
            !canEditCharacter(auth, campaignId, entry.characterId)
          ) {
            return err('that roll is not yours to report', 403);
          }
        } else if (op.op === 'cart' || op.op === 'offer') {
          if (!canEditCharacter(auth, campaignId, op.characterId)) {
            return err('that cart is not yours to fill', 403);
          }
        } else {
          return err('DM key required', 401);
        }
      }

      return sessionStub(env, campaignId).fetch('https://do/session', {
        method: 'POST',
        body: JSON.stringify(op),
      });
    }
    // Listening requires a ticket.
    //
    // This stream used to be open to anyone who knew a campaign id —
    // a fair trade when the only way to reach it was to be in the room,
    // and an untenable one the moment a host can be exposed through a
    // tunnel. `EventSource` can't send headers, so the proof rides in
    // the URL (see tickets.ts).
    if (!(await checkTicket(env.DM_KEY, m[1], url.searchParams.get('t')))) {
      return err('a ticket is required to listen', 401);
    }
    // The stream carries the caller's opaque handle (never its id), so
    // the DO can aim an event at one screen instead of the whole room.
    const handle = url.searchParams.get('display');
    const who = handle ? `?display=${encodeURIComponent(handle)}` : '';
    return sessionStub(env, m[1]).fetch(`https://do/${m[2]}${who}`);
  }

  return err('not found', 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await api(request, env, url);
    } catch (e) {
      console.error('api error', e);
      return err(e instanceof Error ? e.message : 'internal error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

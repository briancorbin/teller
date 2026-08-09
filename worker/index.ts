import { CampaignDO } from './campaign-do';
import {
  logEvent,
  publicCounters,
  toCampaign,
  toCharacter,
  toPackRecord,
  toPublicCharacter,
  type Env,
} from './db';
import { getTemplate, templates } from './templates';
import type { Campaign, CharacterData, Counter, RulesPack, SessionOp } from './types';

export { CampaignDO };

// --- helpers ---------------------------------------------------------------

const json = (data: unknown, status = 200) => Response.json(data, { status });
const err = (message: string, status: number) => json({ error: message }, status);

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function isDm(request: Request, env: Env): boolean {
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
  defs: { name: string; current?: number; max?: number | null }[],
): Counter[] {
  return defs.map((c) => ({
    id: newId('ctr'),
    name: c.name,
    current: c.current ?? 0,
    max: c.max ?? null,
  }));
}

// --- routes ----------------------------------------------------------------

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  const dm = isDm(request, env);
  let m: RegExpMatchArray | null;

  if (pathname === '/api/health') {
    return json({ ok: true, name: 'teller' });
  }

  if (pathname === '/api/templates' && method === 'GET') {
    return json(templates);
  }

  // Rules packs — uploaded reference content, DM-gated both ways.
  if (pathname === '/api/packs' && method === 'GET') {
    if (!dm) return err('DM key required', 401);
    const system = url.searchParams.get('system');
    const rows = system
      ? await env.DB.prepare('SELECT * FROM packs WHERE system = ? ORDER BY name')
          .bind(system)
          .all()
      : await env.DB.prepare('SELECT * FROM packs ORDER BY system, name').all();
    return json(rows.results.map((r) => toPackRecord(r as never)));
  }

  if (pathname === '/api/packs' && method === 'PUT') {
    if (!dm) return err('DM key required', 401);
    const pack = await request.json<RulesPack>();
    if (!pack.system || !pack.name || !Array.isArray(pack.sections)) {
      return err('pack requires system, name, sections[]', 400);
    }
    await env.DB.prepare(
      `INSERT INTO packs (id, system, name, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(system, name) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    )
      .bind(newId('pack'), pack.system, pack.name, JSON.stringify(pack))
      .run();
    const row = await env.DB.prepare(
      'SELECT * FROM packs WHERE system = ? AND name = ?',
    )
      .bind(pack.system, pack.name)
      .first();
    return json(toPackRecord(row as never), 201);
  }

  m = pathname.match(/^\/api\/packs\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!dm) return err('DM key required', 401);
    await env.DB.prepare('DELETE FROM packs WHERE id = ?').bind(m[1]).run();
    return json({ ok: true });
  }

  if (pathname === '/api/campaigns' && method === 'GET') {
    if (!dm) return err('DM key required', 401);
    const rows = await env.DB.prepare(
      'SELECT * FROM campaigns ORDER BY created_at DESC',
    ).all();
    return json(rows.results.map((r) => toCampaign(r as never)));
  }

  if (pathname === '/api/campaigns' && method === 'POST') {
    if (!dm) return err('DM key required', 401);
    const body = await request.json<{ name?: string; system?: string }>();
    if (!body.name) return err('name required', 400);
    const template = getTemplate(body.system ?? '');
    if (!template) return err(`unknown system: ${body.system}`, 400);

    const id = newId('cmp');
    const data = {
      vocabulary: template.vocabulary,
      counters: countersFrom(template.campaign.counters),
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
    if (!dm) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('campaign not found', 404);
    const chars = await env.DB.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at',
    )
      .bind(m[1])
      .all();
    return json({
      campaign: toCampaign(row as never),
      characters: chars.results.map((r) => toCharacter(r as never)),
    });
  }

  // Undo: restore the `before` snapshot of the most recent un-reverted
  // mutation event. The event log is the source; a revert logs its own
  // event pointing at what it undid, so repeated undos walk backward.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/undo$/);
  if (m && method === 'POST') {
    if (!dm) return err('DM key required', 401);
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

  // Battle map: PUT raw image → R2, pointer on campaign.data.map.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/map$/);
  if (m) {
    if (!dm) return err('DM key required', 401);
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
    if (!dm) return err('DM key required', 401);
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
    if (!dm) return err('DM key required', 401);
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
    if (!dm) return err('DM key required', 401);
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
    if (!dm) return err('DM key required', 401);
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

  // Serve map images (unguessable random keys; cache hard).
  m = pathname.match(/^\/api\/maps\/(.+)$/);
  if (m && method === 'GET') {
    const object = await env.MAPS.get(decodeURIComponent(m[1]));
    if (!object) return err('not found', 404);
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
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
          // Active scene wins; legacy single-map pointer is the fallback.
          map:
            (campaign.data.maps ?? []).find(
              (s) => s.id === campaign.data.activeMapId,
            ) ?? campaign.data.map ?? null,
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
    if (!dm) return err('DM key required', 401);
    const campaignId = m[1];
    await env.DB.prepare('DELETE FROM events WHERE campaign_id = ?').bind(campaignId).run();
    await env.DB.prepare('DELETE FROM characters WHERE campaign_id = ?').bind(campaignId).run();
    await env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(campaignId).run();
    return json({ ok: true });
  }

  m = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (m && method === 'PATCH') {
    if (!dm) return err('DM key required', 401);
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
      reference: body.data?.reference ?? campaign.data.reference,
      activeHandoutId:
        body.data?.activeHandoutId !== undefined
          ? body.data.activeHandoutId
          : campaign.data.activeHandoutId,
      activeMapId:
        body.data?.activeMapId !== undefined
          ? body.data.activeMapId
          : campaign.data.activeMapId,
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
    if (!dm) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const character = toCharacter(row as never);
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
    if (!dm) return err('DM key required', 401);
    const campaignId = m[1];
    const campaignRow = await env.DB.prepare(
      'SELECT * FROM campaigns WHERE id = ?',
    )
      .bind(campaignId)
      .first();
    if (!campaignRow) return err('campaign not found', 404);
    const campaign = toCampaign(campaignRow as never);
    const template = getTemplate(campaign.system);

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
      seatToken: newId('seat'),
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

  // Duplicate a character: same sheet, fresh identity (id + seat token).
  // The workhorse for NPC packs — make one Coyote, stamp out five.
  m = pathname.match(/^\/api\/characters\/([^/]+)\/duplicate$/);
  if (m && method === 'POST') {
    if (!dm) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const source = toCharacter(row as never);
    const id = newId('chr');
    const data: CharacterData = {
      ...structuredClone(source.data),
      seatToken: newId('seat'),
    };
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

    const token = url.searchParams.get('token');
    const isSeat = Boolean(token && token === character.data.seatToken);
    if (!dm && !isSeat) return err('DM key or seat token required', 401);

    const body = await request.json<{ name?: string; data?: Partial<CharacterData> }>();
    const patch = body.data ?? {};
    const next: CharacterData = {
      fields: patch.fields ?? character.data.fields,
      counters: patch.counters ?? character.data.counters,
      tags: patch.tags ?? character.data.tags,
      notes: patch.notes ?? character.data.notes,
      // Seat token is never patchable — not by anyone, v0.
      seatToken: character.data.seatToken,
    };
    const name = (dm ? body.name : undefined) ?? character.name;

    await env.DB.prepare(
      "UPDATE characters SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(name, JSON.stringify(next), character.id)
      .run();
    await logEvent(
      env,
      character.campaignId,
      character.id,
      dm ? 'dm' : `seat:${character.id}`,
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

  // Seat view: character + campaign vocabulary, gated by seat token alone.
  m = pathname.match(/^\/api\/seat\/([^/]+)$/);
  if (m && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('character not found', 404);
    const character = toCharacter(row as never);
    const token = url.searchParams.get('token');
    if (!token || token !== character.data.seatToken) {
      return err('seat token required', 401);
    }
    const campaignRow = await env.DB.prepare(
      'SELECT * FROM campaigns WHERE id = ?',
    )
      .bind(character.campaignId)
      .first();
    const campaign = campaignRow ? toCampaign(campaignRow as never) : null;
    // Seats get the system's rules packs too — a valid seat token is a
    // seat at the table, and the table gets to read the rules.
    const packRows = campaign
      ? await env.DB.prepare('SELECT * FROM packs WHERE system = ? ORDER BY name')
          .bind(campaign.system)
          .all()
      : null;
    return json({
      character,
      campaign,
      packs: packRows ? packRows.results.map((r) => toPackRecord(r as never)) : [],
    });
  }

  // Live session — SSE stream + initiative ops, forwarded to the DO.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/(stream|session)$/);
  if (m) {
    if (m[2] === 'session' && method === 'POST') {
      if (!dm) return err('DM key required', 401);
      const op = await request.json<SessionOp>();
      return sessionStub(env, m[1]).fetch('https://do/session', {
        method: 'POST',
        body: JSON.stringify(op),
      });
    }
    return sessionStub(env, m[1]).fetch(`https://do/${m[2]}`);
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

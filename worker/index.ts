import { CampaignDO } from './campaign-do';
import { logEvent, toCampaign, toCharacter, toPublicCharacter, type Env } from './db';
import { getTemplate, templates } from './templates';
import type { Campaign, CharacterData, Counter, SessionOp } from './types';

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
    return json({
      campaign: toCampaign(row as never),
      characters: chars.results.map((r) => toPublicCharacter(r as never)),
    });
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
    const next = {
      vocabulary: body.data?.vocabulary ?? campaign.data.vocabulary,
      counters: body.data?.counters ?? campaign.data.counters,
    };
    await env.DB.prepare('UPDATE campaigns SET name = ?, data = ? WHERE id = ?')
      .bind(body.name ?? campaign.name, JSON.stringify(next), campaign.id)
      .run();
    await logEvent(env, campaign.id, null, 'dm', 'campaign.updated', {
      patch: body,
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
      { name: character.name },
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
      { patch },
    );
    await poke(env, character.campaignId, character.id);

    const updated = await env.DB.prepare('SELECT * FROM characters WHERE id = ?')
      .bind(character.id)
      .first();
    return json(toCharacter(updated as never));
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
    return json({ character, campaign });
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

import { toDisplay, type Env } from './db';
import { displayHandle } from './types';
import type { Display, DisplayParams, DisplayRole, StreamEvent } from './types';

// Screens, and what they're allowed to do.
//
// There is exactly one secret in teller: the DM key. Everything else is
// an assignment. A screen joins knowing nothing, keeps an id, and the
// DM says what it is; the server looks that up and allows exactly that.
// See CLAUDE.md rule 7.

/** No I/L/O/0/1 — this gets read aloud across a lit room. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_TTL_MIN = 15;

/**
 * The id IS the capability — it's what the server checks — so it gets
 * real entropy and is never rendered anywhere. Contrast the pairing
 * code, which is deliberately tiny and deliberately short-lived.
 */
function newDisplayId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `dsp_${hex}`;
}

function newPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const codeExpiry = () =>
  new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();

async function readDisplay(env: Env, id: string): Promise<Display | null> {
  const row = await env.DB.prepare('SELECT * FROM displays WHERE id = ?')
    .bind(id)
    .first();
  return row ? toDisplay(row as never) : null;
}

/** Mint a fresh screen, retrying if a pairing code happens to collide. */
async function createDisplay(env: Env): Promise<Display> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newDisplayId();
    try {
      await env.DB.prepare(
        'INSERT INTO displays (id, code, code_expires_at) VALUES (?, ?, ?)',
      )
        .bind(id, newPairingCode(), codeExpiry())
        .run();
      return (await readDisplay(env, id))!;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  throw new Error('could not mint a display');
}

/** An unclaimed screen left on overnight shouldn't show a dead code. */
async function refreshCode(env: Env, display: Display): Promise<Display> {
  await env.DB.prepare(
    'UPDATE displays SET code = ?, code_expires_at = ? WHERE id = ?',
  )
    .bind(newPairingCode(), codeExpiry(), display.id)
    .run();
  return (await readDisplay(env, display.id))!;
}

/**
 * Who is calling? Resolves the caller's display from its header. This
 * is the only place a display id is trusted, and it grants nothing on
 * its own — the ROLE decides, and the role is set by the DM.
 */
export async function resolveDisplay(
  env: Env,
  request: Request,
): Promise<Display | null> {
  const id = request.headers.get('x-teller-display');
  if (!id) return null;
  const display = await readDisplay(env, id);
  if (!display) return null;
  await env.DB.prepare(
    "UPDATE displays SET last_seen_at = datetime('now') WHERE id = ?",
  )
    .bind(id)
    .run();
  return display;
}

export type Auth = {
  /** The root of trust: the one key, held by the DM's own console. */
  key: boolean;
  display: Display | null;
};

/**
 * Full authority over a campaign — the DM key, or a screen the DM
 * pointed at the console. Scoped: a console for one campaign is not a
 * console for another.
 */
export function canDm(auth: Auth, campaignId?: string): boolean {
  if (auth.key) return true;
  const d = auth.display;
  if (!d || d.role !== 'console' || !d.campaignId) return false;
  return !campaignId || d.campaignId === campaignId;
}

/**
 * May this caller edit this character? The DM may edit anyone; a seat
 * may edit the one character it was pointed at, and nobody else.
 */
export function canEditCharacter(
  auth: Auth,
  campaignId: string,
  characterId: string,
): boolean {
  if (canDm(auth, campaignId)) return true;
  const d = auth.display;
  return Boolean(
    d &&
      d.role === 'seat' &&
      d.campaignId === campaignId &&
      d.params.characterId === characterId,
  );
}

/** Who did it, for the event log. */
export function actorOf(auth: Auth): string {
  if (auth.key) return 'dm';
  const d = auth.display;
  if (!d) return 'anon';
  if (d.role === 'console') return 'dm';
  return `display:${d.role}`;
}

async function notify(
  env: Env,
  campaignId: string,
  displayId: string,
  event: StreamEvent,
): Promise<void> {
  await env.CAMPAIGN.get(env.CAMPAIGN.idFromName(campaignId)).fetch(
    'https://do/notify',
    {
      method: 'POST',
      body: JSON.stringify({ handle: await displayHandle(displayId), event }),
    },
  );
}

/**
 * Display routes. Returns null when the path isn't ours, so the main
 * router can carry on.
 */
export async function displayRoutes(
  request: Request,
  env: Env,
  url: URL,
  auth: Auth,
): Promise<Response | null> {
  const { pathname } = url;
  const method = request.method;
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const err = (message: string, status: number) => json({ error: message }, status);

  // A screen announcing itself. Unauthenticated on purpose: this is how
  // a screen comes into existence, and it confers nothing — a brand new
  // display is 'blank' and belongs to no campaign until a DM adopts it.
  if (pathname === '/api/displays/hello' && method === 'POST') {
    const body = await request
      .json<{ id?: string }>()
      .catch(() => ({}) as { id?: string });
    let display = body.id ? await readDisplay(env, body.id) : null;
    if (!display) {
      display = await createDisplay(env);
    } else {
      await env.DB.prepare(
        "UPDATE displays SET last_seen_at = datetime('now') WHERE id = ?",
      )
        .bind(display.id)
        .run();
      const expired = await env.DB.prepare(
        "SELECT 1 AS x FROM displays WHERE id = ? AND campaign_id IS NULL AND (code IS NULL OR code_expires_at < datetime('now'))",
      )
        .bind(display.id)
        .first();
      if (expired) display = await refreshCode(env, display);
    }
    // The handle is told, not derived. A screen served over plain HTTP on
    // a table's own network has no `crypto.subtle` — it isn't a secure
    // context — so a client that computed its own sha-256 could never open
    // its stream. The server knows the answer anyway.
    return json({ display, handle: await displayHandle(display.id) });
  }

  // A screen reporting its own viewport. Unauthenticated like hello and
  // clamped hard: it's telemetry about the caller itself, and it only
  // ever writes to the caller's own row. Must be matched before the
  // /api/displays/:id routes below, which would otherwise claim it.
  if (pathname === '/api/displays/viewport' && method === 'POST') {
    const self = auth.display;
    if (!self) return err('display required', 401);
    const body = await request.json<{ w?: number; h?: number }>();
    const clamp = (n: unknown) =>
      typeof n === 'number' && Number.isFinite(n)
        ? Math.min(20000, Math.max(1, Math.round(n)))
        : null;
    const w = clamp(body.w);
    const h = clamp(body.h);
    if (!w || !h) return err('w and h required', 400);
    if (self.viewport?.w !== w || self.viewport?.h !== h) {
      await env.DB.prepare('UPDATE displays SET vw = ?, vh = ? WHERE id = ?')
        .bind(w, h, self.id)
        .run();
    }
    return json({ ok: true });
  }

  // Everything below is the DM arranging the room.
  let m = pathname.match(/^\/api\/campaigns\/([^/]+)\/displays$/);
  if (m && method === 'GET') {
    if (!canDm(auth, m[1])) return err('DM key required', 401);
    const rows = await env.DB.prepare(
      'SELECT * FROM displays WHERE campaign_id = ? ORDER BY created_at',
    )
      .bind(m[1])
      .all();
    return json(rows.results.map((r) => toDisplay(r as never)));
  }

  // Adopt a waiting screen by the code it's showing.
  m = pathname.match(/^\/api\/campaigns\/([^/]+)\/displays\/claim$/);
  if (m && method === 'POST') {
    const campaignId = m[1];
    if (!canDm(auth, campaignId)) return err('DM key required', 401);
    const body = await request.json<{ code?: string; name?: string }>();
    const code = (body.code ?? '').trim().toUpperCase();
    if (!code) return err('pairing code required', 400);
    const row = await env.DB.prepare(
      "SELECT * FROM displays WHERE code = ? AND campaign_id IS NULL AND code_expires_at >= datetime('now')",
    )
      .bind(code)
      .first();
    if (!row) return err('no screen is showing that code', 404);
    const display = toDisplay(row as never);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM displays WHERE campaign_id = ?',
    )
      .bind(campaignId)
      .first<{ n: number }>();
    const name = body.name?.trim() || `Screen ${(count?.n ?? 0) + 1}`;
    await env.DB.prepare(
      'UPDATE displays SET campaign_id = ?, name = ?, code = NULL, code_expires_at = NULL WHERE id = ?',
    )
      .bind(campaignId, name, display.id)
      .run();
    return json({ display: (await readDisplay(env, display.id))! });
  }

  m = pathname.match(/^\/api\/displays\/([^/]+)$/);
  if (m && (method === 'PATCH' || method === 'DELETE')) {
    const display = await readDisplay(env, m[1]);
    if (!display || !display.campaignId) return err('display not found', 404);
    if (!canDm(auth, display.campaignId)) return err('DM key required', 401);

    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM displays WHERE id = ?')
        .bind(display.id)
        .run();
      // It's still connected: tell it to go look at itself and discover
      // it's a stranger again.
      await notify(env, display.campaignId, display.id, { type: 'assign' });
      return json({ ok: true });
    }

    const body = await request.json<{
      name?: string;
      color?: string;
      role?: DisplayRole;
      params?: DisplayParams;
      ppi?: number | null;
      ppiY?: number | null;
    }>();
    const name = body.name?.trim() ?? display.name;
    const color = body.color ?? display.color;
    const role = body.role ?? display.role;
    const params = body.params ?? display.params;
    const ppi = body.ppi === undefined ? display.ppi : body.ppi;
    const ppiY = body.ppiY === undefined ? display.ppiY : body.ppiY;
    await env.DB.prepare(
      'UPDATE displays SET name = ?, color = ?, role = ?, params = ?, ppi = ?, ppi_y = ? WHERE id = ?',
    )
      .bind(name, color, role, JSON.stringify(params), ppi, ppiY, display.id)
      .run();
    await notify(env, display.campaignId, display.id, { type: 'assign' });
    return json({ display: (await readDisplay(env, display.id))! });
  }

  // "Which one of you is Screen 3?"
  m = pathname.match(/^\/api\/displays\/([^/]+)\/identify$/);
  if (m && method === 'POST') {
    const display = await readDisplay(env, m[1]);
    if (!display || !display.campaignId) return err('display not found', 404);
    if (!canDm(auth, display.campaignId)) return err('DM key required', 401);
    await notify(env, display.campaignId, display.id, { type: 'identify' });
    return json({ ok: true });
  }

  return null;
}

// The host — the first server on the new core, now with the one key.
//
// One runtime (§16): `node server/index.ts --data ~/.teller-next
// --campaign <slug>` and nothing else. No build, no bundler, no
// Cloudflare shape anywhere — routes call the Session, the Session
// calls the store, and the store is a file.
//
// Auth is rule 7, ported (server/auth.ts): the DM key is the root of
// trust, screens pair by code and hold role assignments, the stream
// takes a ticket because an EventSource can't send a header. A route
// never re-derives authority from anything but the key or the role.
//
// The client contract is small on purpose: JSON in, JSON out,
// `/api/stream` nudges and the page refetches. Serializers stay at the
// store boundary, so a route never sees a raw row.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize, resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { toEntity } from '../core/entity.ts';
import {
  createCampaign,
  isDisplayRole,
  listCampaigns,
  openCampaign,
  openShelf,
  type EntityDraft,
} from '../core/store.ts';
import {
  actorOf,
  adopted,
  canDm,
  canEditEntity,
  canWatch,
  checkTicket,
  displayHandle,
  loadDmKey,
  mintTicket,
  resolveAuth,
  STREAM_MINUTES,
  type Auth,
} from './auth.ts';
import { discoverPlugins, loadPlugins, providersOf } from '../core/plugins.ts';
import { panelDir, seedPanels } from '../core/panels-shelf.ts';
import { Session, type EntryEdit } from './session.ts';
import type { TurnOp } from './turn.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
// The bundled client (client/ → vite → here). Preferred over PUBLIC
// when built, so the vanilla files remain the fallback until they die.
const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');

type Reply = { status: number; body: unknown };

/** Everything a route may know. The key rides along only for tickets. */
export type Ctx = { session: Session; auth: Auth; key: string };

function reply(status: number, body: unknown): Reply {
  return { status, body };
}

const denied = () => reply(401, { error: 'DM key required' });
const notAtTable = () => reply(401, { error: 'not at this table' });

async function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The API, as one function — testable without a socket, servable with
 * one. Returns undefined for paths that aren't the API's.
 */
export async function handleApi(
  ctx: Ctx,
  method: string,
  url: URL,
  req: IncomingMessage,
): Promise<Reply | undefined> {
  const { session, auth, key } = ctx;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', …]
  if (parts[0] !== 'api') return undefined;
  const [, head, a, b] = parts;

  // -- screens ----------------------------------------------------------

  if (head === 'displays') {
    // A screen announcing itself. Unauthenticated on purpose: this is
    // how a screen comes into existence, and it confers nothing — a
    // brand new display is 'blank' and belongs to nobody until the DM
    // adopts it by the code it shows.
    if (method === 'POST' && a === 'hello' && !b) {
      const body = await bodyOf(req);
      let display =
        typeof body.id === 'string' ? session.shelf.display(body.id) : undefined;
      if (display) {
        session.shelf.touchDisplay(display.id);
        display = session.shelf.refreshCodeIfExpired(display);
      } else {
        display = session.shelf.createDisplay();
      }
      // The handle is told, not derived: a LAN origin is not a secure
      // context, so the client couldn't compute its own sha-256.
      return reply(200, { display, handle: displayHandle(display.id) });
    }

    // A screen reporting its own viewport — telemetry about the caller
    // itself, clamped hard, only ever writes the caller's own row.
    if (method === 'POST' && a === 'viewport' && !b) {
      const self = auth.display;
      if (!self) return reply(401, { error: 'display required' });
      const body = await bodyOf(req);
      const clamp = (n: unknown) =>
        typeof n === 'number' && Number.isFinite(n)
          ? Math.min(20000, Math.max(1, Math.round(n)))
          : null;
      const w = clamp(body.w);
      const h = clamp(body.h);
      if (!w || !h) return reply(400, { error: 'w and h required' });
      if (self.viewport?.w !== w || self.viewport?.h !== h) {
        session.shelf.setDisplayViewport(self.id, w, h);
      }
      return reply(200, { ok: true });
    }

    // Everything below is the DM arranging the room.
    if (!canDm(auth)) return denied();

    if (method === 'GET' && !a) {
      // Listing is the moment truth matters — sweep the ghosts first.
      session.shelf.expireUnclaimedDisplays();
      return reply(200, session.shelf.displays());
    }

    // Adopt a waiting screen by the code it's showing.
    if (method === 'POST' && a === 'claim' && !b) {
      const body = await bodyOf(req);
      const code = String(body.code ?? '').trim();
      if (!code) return reply(400, { error: 'pairing code required' });
      const found = session.shelf.displayByCode(code);
      if (!found) return reply(404, { error: 'no screen is showing that code' });
      const claimed = session.shelf.displays().filter((d) => !d.code).length;
      const name =
        (typeof body.name === 'string' && body.name.trim()) ||
        `Screen ${claimed + 1}`;
      const display = session.shelf.claimDisplay(found.id, name);
      session.changed('displays');
      return reply(200, display);
    }

    // "Which one of you is Screen 3?"
    if (method === 'POST' && a && b === 'identify') {
      const display = session.shelf.display(a);
      if (!adopted(display)) return reply(404, { error: 'display not found' });
      session.notify(displayHandle(display.id), 'identify');
      return reply(200, { ok: true });
    }

    if (a && !b && (method === 'PATCH' || method === 'DELETE')) {
      const display = session.shelf.display(a);
      if (!display) return reply(404, { error: 'display not found' });

      if (method === 'DELETE') {
        session.shelf.removeDisplay(a);
        // It's still connected: tell it to go look at itself and
        // discover it's a stranger again.
        session.notify(displayHandle(a), 'assign');
        session.changed('displays');
        return reply(200, { ok: true });
      }

      const body = await bodyOf(req);
      const patch: Parameters<typeof session.shelf.updateDisplay>[1] = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (typeof body.color === 'string') patch.color = body.color;
      if (body.role !== undefined) {
        if (!isDisplayRole(body.role)) {
          return reply(400, { error: `not a role: ${String(body.role)}` });
        }
        patch.role = body.role;
      }
      if (body.params && typeof body.params === 'object') {
        patch.params = body.params as Record<string, unknown>;
      }
      if (body.ppi === null || typeof body.ppi === 'number') patch.ppi = body.ppi;
      if (body.ppiY === null || typeof body.ppiY === 'number') patch.ppiY = body.ppiY;
      if (typeof body.position === 'number') patch.position = body.position;
      const updated = session.shelf.updateDisplay(a, patch);
      session.notify(displayHandle(a), 'assign');
      session.changed('displays');
      return reply(200, updated);
    }
  }

  // The stream's permission slip. The DM's own device rides as 'dm';
  // an adopted screen gets a ticket for its own handle and nothing else.
  if (method === 'GET' && head === 'ticket' && !a) {
    const slips = (handle: string) => ({
      handle,
      ticket: mintTicket(key, `stream:${handle}`, STREAM_MINUTES),
      // Art and maps ride in <img> tags, which can't send headers
      // either — same law, second subject.
      files: mintTicket(key, `files:${handle}`, STREAM_MINUTES),
    });
    if (adopted(auth.display)) {
      return reply(200, slips(displayHandle(auth.display.id)));
    }
    if (auth.key) return reply(200, slips('dm'));
    return notAtTable();
  }

  // -- the table itself. Watching requires being adopted (or the key). --

  if (!canWatch(auth)) return notAtTable();

  if (method === 'GET' && head === 'campaign' && !a) {
    const { manifest, system, packs, missing } = session.loaded;
    return reply(200, {
      slug: session.campaign.slug,
      manifest,
      system: system ?? null,
      packs,
      missing,
      watching: session.watching,
    });
  }

  if (head === 'entities' && !a) {
    if (method === 'GET') {
      const parent =
        url.searchParams.get('parent') ?? session.loaded.manifest.id;
      return reply(
        200,
        session.campaign
          .children(parent)
          .map(({ id, name, type }) => ({ id, name, type: type ?? null })),
      );
    }
    if (method === 'POST') {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      try {
        const entity = session.create(
          (body.draft ?? {}) as EntityDraft,
          actorOf(auth, String(body.actor ?? '')),
          typeof body.parentId === 'string' ? body.parentId : undefined,
        );
        return reply(201, entity);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  if (method === 'POST' && head === 'stamp' && !a) {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const slot = String(body.slot ?? 'bestiary');
    const templateId = String(body.templateId ?? '');
    const entity = session.stampFrom(
      slot,
      templateId,
      actorOf(auth, String(body.actor ?? '')),
      {
        name: typeof body.name === 'string' ? body.name : undefined,
        thick: body.thick === true,
        parentId: typeof body.parentId === 'string' ? body.parentId : undefined,
      },
    );
    if (!entity)
      return reply(404, {
        error: `no template ${templateId} in ${slot} — missing pack?`,
      });
    return reply(201, entity);
  }

  if (head === 'entities' && a && !b) {
    if (method === 'GET') {
      // Reading a whole entity is the seat's privilege for its own, and
      // the DM's for anyone — a passive surface gets the roster list.
      if (!canEditEntity(auth, a)) return denied();
      const entity = session.campaign.get(a);
      if (!entity) return reply(404, { error: `no entity ${a}` });
      if (url.searchParams.get('resolved') === '1') {
        return reply(200, session.reading(entity));
      }
      return reply(200, entity);
    }
    if (method === 'PUT') {
      if (!canEditEntity(auth, a)) return denied();
      const body = await bodyOf(req);
      const entity = toEntity({ ...((body.entity as object) ?? {}), id: a });
      if (!entity) return reply(400, { error: 'not an entity' });
      try {
        return reply(200, session.save(entity, actorOf(auth, String(body.actor ?? ''))));
      } catch (err) {
        return reply(404, { error: String(err) });
      }
    }
    if (method === 'DELETE') {
      if (!canDm(auth)) return denied();
      session.remove(a, actorOf(auth, url.searchParams.get('actor') ?? ''));
      return reply(200, { ok: true });
    }
  }

  // The seat's one door: edit the reading, store only the touch.
  if (method === 'POST' && head === 'entities' && a && b === 'entry') {
    if (!canEditEntity(auth, a)) return denied();
    const body = await bodyOf(req);
    const list = String(body.list ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!list || !name) return reply(400, { error: 'entry needs a list and a name' });
    const edit: EntryEdit = { list, name };
    if (typeof body.value === 'number' || typeof body.value === 'string') {
      edit.value = body.value;
    }
    if (body.max === null || typeof body.max === 'number') edit.max = body.max;
    if (body.remove === true) edit.remove = true;
    const saved = session.writeEntry(a, edit, actorOf(auth, String(body.actor ?? '')));
    if (!saved) return reply(404, { error: `no entity ${a}` });
    return reply(200, { stored: saved, reads: session.reading(saved) });
  }

  if (method === 'POST' && head === 'entities' && a && b === 'move') {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const parentId = String(body.parentId ?? '');
    if (!parentId) return reply(400, { error: 'move needs a parentId' });
    try {
      session.move(a, parentId, actorOf(auth, String(body.actor ?? '')));
      return reply(200, { ok: true });
    } catch (err) {
      return reply(404, { error: String(err) });
    }
  }

  // -- the shelf, read whole — what this machine holds (DM's business).
  if (method === 'GET' && head === 'shelf' && !a) {
    if (!canDm(auth)) return denied();
    return reply(200, {
      systems: session.shelf.systems(),
      packs: session.shelf.packs(),
      boards: session.shelf.boards().map(({ id, name }) => ({ id, name })),
    });
  }

  // -- plugins over HTTP: §15's "enablement is a human act in the
  // console", finally in the console. Toggle and config reload the
  // load path live, so the enable gate and the running set never drift.
  //
  // The trust table this reads and writes is the same one a code-
  // carrying `.panel` rides (§E: "trust rides the plugins table") — so
  // this route doubles as the panel-code enablement endpoint. A `pan_`
  // id reloads the CONTENT stack (panel code is attached there, at
  // sweep); anything else reloads the PLUGIN load path, as before.
  if (head === 'plugins') {
    if (!canDm(auth)) return denied();
    const dataDir = session.dataDir;
    if (!dataDir) return reply(501, { error: 'this host has no data dir' });
    if (method === 'GET' && !a) {
      const { found, problems } = discoverPlugins(dataDir, session.shelf);
      return reply(200, {
        found,
        problems: [...problems, ...session.pluginProblems],
        running: session.plugins.map((p) => p.manifest.id),
      });
    }
    const reloadPlugins = async () => {
      const result = await loadPlugins(dataDir, session.shelf);
      session.plugins = result.loaded;
      session.pluginProblems = result.problems;
      session.changed('plugins');
    };
    if (method === 'POST' && a && !b) {
      const body = await bodyOf(req);
      if (typeof body.enabled !== 'boolean') {
        return reply(400, { error: 'enabled must be true or false' });
      }
      session.shelf.setPluginEnabled(a, body.enabled);
      if (a.startsWith('pan_')) {
        // Panel code isn't a plugin's `provides` — it's attached to the
        // panel's declaration by the sweep, so what needs re-running is
        // the content stack, not the plugin load path.
        session.reload();
      } else {
        await reloadPlugins();
      }
      return reply(200, { ok: true, running: session.plugins.map((p) => p.manifest.id) });
    }
    if (method === 'PUT' && a && b === 'config') {
      const body = await bodyOf(req);
      session.shelf.setPluginConfig(a, body.config);
      await reloadPlugins();
      return reply(200, { ok: true });
    }
  }

  // -- proposals (§15). The host assembles the snapshot, fans it out to
  // every enabled provider, and returns words. Playing any of it is the
  // DM's act — a proposal lands nowhere a human didn't put it (rule 1).
  if (method === 'POST' && head === 'propose' && a && !b) {
    if (!canDm(auth)) return denied();
    const point = a === 'turn' ? 'propose.turn' : a === 'narrate' ? 'propose.narrate' : undefined;
    if (!point) return reply(404, { error: `no such point: ${a}` });
    const body = await bodyOf(req);
    let payload: unknown = body.payload ?? {};
    if (point === 'propose.turn') {
      // Assemble the snapshot server-side: a fact the host holds and
      // doesn't pass on is a fact the model invents.
      const turn = session.turnState();
      const acting = turn.turn === null ? undefined : turn.order[turn.turn];
      const actingEntity = acting?.entityId
        ? session.campaign.get(acting.entityId)
        : undefined;
      const names = new Map(
        session.campaign
          .children(session.loaded.manifest.id)
          .map((e) => [e.id, e.name]),
      );
      payload = {
        round: turn.round,
        order: turn.order.map((e, i) => ({
          name: e.label ?? (e.entityId ? (names.get(e.entityId) ?? 'unknown') : '?'),
          score: e.score ?? null,
          acting: i === turn.turn,
        })),
        acting: actingEntity ? session.reading(actingEntity) : null,
        ...(typeof body.payload === 'object' && body.payload !== null
          ? (body.payload as object)
          : {}),
      };
    }
    const providers = providersOf(session.plugins, point);
    const proposals: { plugin: string; proposal?: unknown; error?: string }[] = [];
    for (const provider of providers) {
      try {
        const proposal = await provider.call(payload);
        proposals.push({ plugin: provider.id, proposal });
      } catch (err) {
        proposals.push({ plugin: provider.id, error: String(err) });
      }
    }
    return reply(200, { point, providers: providers.length, proposals });
  }

  // -- the turn order (rule 5). Everyone reads; the DM drives; a seat
  // may submit exactly one thing — a score for its own entity's row.
  if (head === 'turn' && !a) {
    if (method === 'GET') return reply(200, session.turnState());
    if (method === 'POST') {
      const body = await bodyOf(req);
      const op = body as unknown as TurnOp;
      if (typeof op.op !== 'string') return reply(400, { error: 'an op needs an op' });
      if (!canDm(auth)) {
        const seat = auth.display;
        const owns =
          op.op === 'score' &&
          adopted(seat) &&
          seat.role === 'seat' &&
          session
            .turnState()
            .order.some(
              (e) => e.id === op.entryId && e.entityId === seat.params.entityId,
            );
        if (!owns) return denied();
      }
      return reply(200, session.turnOp(op, actorOf(auth, String(body.actor ?? ''))));
    }
  }

  // -- the campaign's own template half — prep (§13), DM's business.
  if (head === 'templates' && a) {
    if (method === 'GET' && !b) return reply(200, session.campaign.templatesIn(a));
    if (!canDm(auth)) return denied();
    if (method === 'POST' && !b) {
      const body = await bodyOf(req);
      try {
        const made = session.campaign.putTemplate(
          a,
          body.template,
          actorOf(auth, String(body.actor ?? '')),
        );
        session.changed('templates');
        return reply(201, made);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
    if (method === 'DELETE' && b) {
      session.campaign.removeTemplate(b, actorOf(auth, url.searchParams.get('actor') ?? ''));
      session.changed('templates');
      return reply(200, { ok: true });
    }
  }

  // Deploy a prepared fight: stamp the foes, seed the order.
  if (method === 'POST' && head === 'encounters' && a && b === 'deploy') {
    if (!canDm(auth)) return denied();
    const body = await bodyOf(req);
    const result = session.deployEncounter(a, actorOf(auth, String(body.actor ?? '')));
    if (!result) return reply(404, { error: `no encounter ${a}` });
    return reply(200, result);
  }

  if (method === 'GET' && head === 'stack' && a && b) {
    if (a === 'declarations') return reply(200, session.loaded.declarations(b));
    if (a === 'templates') return reply(200, session.loaded.templates(b));
    if (a === 'record') return reply(200, session.loaded.record(b));
  }

  if (method === 'GET' && head === 'boards' && !a) {
    return reply(200, session.shelf.boards());
  }

  if (head === 'board-state' && a && !b) {
    if (method === 'GET') {
      return reply(200, session.campaign.boardState(a) ?? null);
    }
    if (method === 'PUT') {
      if (!canDm(auth)) return denied();
      const body = await bodyOf(req);
      session.putBoardState(a, body.data ?? null, actorOf(auth, String(body.actor ?? '')));
      return reply(200, { ok: true });
    }
  }

  if (method === 'GET' && head === 'events' && !a) {
    if (!canDm(auth)) return denied();
    return reply(
      200,
      session.campaign.events({
        entityId: url.searchParams.get('entity') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 100) || 100,
      }),
    );
  }

  return reply(404, { error: `no route ${method} ${url.pathname}` });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const root = existsSync(join(DIST, 'index.html')) ? DIST : PUBLIC;
  const path = normalize(join(root, rel));
  if (!path.startsWith(root) || !existsSync(path)) return false;
  try {
    const body = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** The whole server, session + key in, listener out. Tests call this on port 0. */
export function serve(session: Session, port: number, key: string) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // A `.panel`'s compiled code (§E UN-DEFERRED) — served PLAIN, no
    // ticket: "panel code is app code, not player-secret content." Only
    // `.build` outputs are reachable, and only for a panel the sweep
    // actually found — trust decides whether the DECLARATION carries
    // this url in the first place, not whether the byte is fetchable
    // once someone has it.
    if (url.pathname.startsWith('/panel-code/')) {
      const dataDir = session.dataDir;
      const rel = decodeURIComponent(url.pathname.slice('/panel-code/'.length));
      const [panelId, ...fileParts] = rel.split('/').filter(Boolean);
      const dir = dataDir && panelId ? panelDir(dataDir, panelId) : undefined;
      const buildRoot = dir ? join(dir, '.build') : undefined;
      const path = buildRoot && fileParts.length
        ? normalize(join(buildRoot, ...fileParts))
        : undefined;
      if (!path || !buildRoot || !path.startsWith(buildRoot) || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
      });
      res.end(readFileSync(path));
      return;
    }

    // Bytes from the data dir — pack art and board images — behind the
    // same ticket law as the stream (an <img> can't send headers).
    // Only art/ and map/ are reachable, and only inside the data dir.
    if (url.pathname.startsWith('/files/')) {
      const handle = url.searchParams.get('handle') ?? '';
      const ticket = url.searchParams.get('ticket');
      let valid = Boolean(handle) && checkTicket(key, `files:${handle}`, ticket);
      if (valid && handle !== 'dm') {
        const display = session.shelf
          .displays()
          .find((d) => displayHandle(d.id) === handle);
        valid = adopted(display);
      }
      const dataDir = session.dataDir;
      if (!valid || !dataDir) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      const rel = decodeURIComponent(url.pathname.slice('/files/'.length));
      const path = normalize(join(dataDir, rel));
      const allowed = ['art', 'map'].some((root) =>
        path.startsWith(join(dataDir, root) + '/'),
      );
      if (!allowed || !existsSync(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not here');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(readFileSync(path));
      return;
    }

    // The stream can't send headers, so it presents a ticket instead —
    // signed by the one key over exactly this handle, and worthless for
    // anything else. A display's handle must still belong to an adopted
    // screen: a ticket identifies, it never grants a power the
    // assignment didn't already have (rule 7).
    if (url.pathname === '/api/stream') {
      const handle = url.searchParams.get('handle') ?? '';
      const ticket = url.searchParams.get('ticket');
      let valid = Boolean(handle) && checkTicket(key, `stream:${handle}`, ticket);
      if (valid && handle !== 'dm') {
        const display = session.shelf
          .displays()
          .find((d) => displayHandle(d.id) === handle);
        valid = adopted(display);
      }
      if (!valid) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('ticket required');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const unsubscribe = session.subscribe(
        (what) => {
          res.write(`data: ${what}\n\n`);
        },
        handle === 'dm' ? undefined : handle,
      );
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }

    const auth = resolveAuth(session.shelf, key, {
      key: req.headers['x-teller-key'] as string | undefined,
      display: req.headers['x-teller-display'] as string | undefined,
    });

    const handled = await handleApi(
      { session, auth, key },
      req.method ?? 'GET',
      url,
      req,
    );
    if (handled) {
      res.writeHead(handled.status, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(handled.body));
      return;
    }

    if ((req.method ?? 'GET') === 'GET' && serveStatic(url.pathname, res)) {
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not here');
  });
  server.listen(port);
  return server;
}

// ---------------------------------------------------------------------
// `node server/index.ts --data ~/.teller-next --campaign <slug>`

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1] ?? '';
  }
  return out;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolvePath(
    (args.data ?? join(homedir(), '.teller-next')).replace(/^~/, homedir()),
  );
  const port = Number(args.port ?? 4526);
  const slug = args.campaign;

  // Opened once, up front — seeding a default's trust row (below) and
  // every mode after it shares this one connection.
  const shelf = openShelf(dataDir);

  // The standard panels ship as files (§E): seed-if-absent, every boot,
  // regardless of which mode below runs — cheap, and it's what makes a
  // fresh `~/.teller-next/panels/` exist before anything reads it. The
  // shelf rides along so a freshly-minted default's code, if it carries
  // any, is trusted the moment it's seeded (§E: "not a ceremony for
  // your own hands").
  seedPanels(dataDir, shelf);

  // Plugin management — the CLI is where a HUMAN enables (§15). These
  // are commands, not server modes: they act on the shelf and exit,
  // campaign or no campaign.
  if ('plugins' in args || args.enable || args.disable || args.configure) {
    if ('plugins' in args) {
      const { found, problems } = discoverPlugins(dataDir, shelf);
      if (!found.length && !problems.length) {
        console.log(`no plugins in ${join(dataDir, 'plugins')}`);
      }
      for (const p of found) {
        console.log(
          `${p.enabled ? '[on] ' : '[off]'} ${p.manifest.id} · ${p.manifest.name}` +
            ` v${p.manifest.version} · provides ${p.manifest.provides.join(', ') || '(nothing)'}` +
            ` · needs ${p.manifest.needs.join(', ') || '(nothing)'}`,
        );
      }
      for (const p of problems) console.log(`  PROBLEM ${p.dir}: ${p.problem}`);
    } else if (args.enable || args.disable) {
      const id = args.enable || args.disable;
      shelf.setPluginEnabled(id, Boolean(args.enable));
      console.log(`${id} ${args.enable ? 'enabled' : 'disabled'}`);
    } else if (args.configure) {
      try {
        shelf.setPluginConfig(args.configure, JSON.parse(args.config ?? 'null'));
        console.log(`${args.configure} configured`);
      } catch (err) {
        console.error(`--config must be JSON: ${String(err)}`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  if (!slug) {
    const have = listCampaigns(dataDir);
    console.log(
      have.length
        ? `campaigns in ${dataDir}:\n${have.map((s) => `  --campaign ${s}`).join('\n')}`
        : `no campaigns in ${dataDir} yet — start one:\n  node server/index.ts --campaign <slug> --new "Its Name"`,
    );
    process.exit(1);
  }

  const key = loadDmKey(dataDir);
  const campaign = args.new
    ? createCampaign(dataDir, slug, args.new)
    : openCampaign(dataDir, slug);
  const session = new Session(shelf, campaign, dataDir);
  const plugins = await loadPlugins(dataDir, shelf);
  session.plugins = plugins.loaded;
  session.pluginProblems = plugins.problems;
  serve(session, port, key);

  const { system, packs, missing, panelProblems } = session.loaded;
  console.log(`teller-next · ${campaign.slug} · http://localhost:${port}`);
  console.log(
    `  system: ${system ? `${system.name} v${system.version}` : '(none)'}` +
      ` · packs: ${packs.length ? packs.map((p) => p.name).join(', ') : '(none)'}`,
  );
  for (const miss of missing) {
    console.log(`  MISSING ${miss.slot}: ${miss.ref.name} (${miss.ref.id})`);
  }
  for (const p of panelProblems) console.log(`  PANEL PROBLEM ${p.dir}: ${p.problem}`);
  if (plugins.loaded.length) {
    console.log(
      `  plugins: ${plugins.loaded.map((p) => p.manifest.name).join(', ')}`,
    );
  }
  for (const p of plugins.problems) console.log(`  PLUGIN PROBLEM ${p.dir}: ${p.problem}`);
  // The host's own terminal is the DM's device — this is `teller key`.
  console.log(`  DM key: ${key}  (open /?console and paste it)`);
}

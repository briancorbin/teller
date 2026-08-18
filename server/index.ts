// The host, minimal loop edition — the first server on the new core.
//
// One runtime (§16): `node server/index.ts --data ~/.teller-next
// --campaign <slug>` and nothing else. No build, no bundler, no
// Cloudflare shape anywhere — routes call the Session, the Session
// calls the store, and the store is a file.
//
// DELIBERATELY KEYLESS, for now: the minimal loop runs on localhost to
// prove the core; the one-key auth, display pairing and tickets (rule
// 7) are working code in the old world and port with the surfaces in
// H step 4. Do not ship a table on this until they do.
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
import { resolve as resolveEntity } from '../core/stamp.ts';
import {
  createCampaign,
  listCampaigns,
  openCampaign,
  openShelf,
  type EntityDraft,
} from '../core/store.ts';
import { Session } from './session.ts';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');

/** Which slots `?resolved=1` derives through — the stampable ones the minimal loop knows. */
const STAMP_SLOTS = ['bestiary', 'catalog'];

type Reply = { status: number; body: unknown };

function reply(status: number, body: unknown): Reply {
  return { status, body };
}

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

function actorOf(body: Record<string, unknown>, url: URL): string {
  const actor =
    String(body.actor ?? '').trim() || url.searchParams.get('actor')?.trim();
  return actor || 'console';
}

/**
 * The API, as one function — testable without a socket, servable with
 * one. Returns undefined for paths that aren't the API's.
 */
export async function handleApi(
  session: Session,
  method: string,
  url: URL,
  req: IncomingMessage,
): Promise<Reply | undefined> {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', …]
  if (parts[0] !== 'api') return undefined;
  const [, head, a, b] = parts;

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
      const body = await bodyOf(req);
      try {
        const entity = session.create(
          (body.draft ?? {}) as EntityDraft,
          actorOf(body, url),
          typeof body.parentId === 'string' ? body.parentId : undefined,
        );
        return reply(201, entity);
      } catch (err) {
        return reply(400, { error: String(err) });
      }
    }
  }

  if (method === 'POST' && head === 'stamp' && !a) {
    const body = await bodyOf(req);
    const slot = String(body.slot ?? 'bestiary');
    const templateId = String(body.templateId ?? '');
    const entity = session.stampFrom(slot, templateId, actorOf(body, url), {
      name: typeof body.name === 'string' ? body.name : undefined,
      thick: body.thick === true,
      parentId: typeof body.parentId === 'string' ? body.parentId : undefined,
    });
    if (!entity)
      return reply(404, {
        error: `no template ${templateId} in ${slot} — missing pack?`,
      });
    return reply(201, entity);
  }

  if (head === 'entities' && a && !b) {
    if (method === 'GET') {
      const entity = session.campaign.get(a);
      if (!entity) return reply(404, { error: `no entity ${a}` });
      if (url.searchParams.get('resolved') === '1') {
        return reply(
          200,
          resolveEntity(entity, session.loaded.templateOf(...STAMP_SLOTS)),
        );
      }
      return reply(200, entity);
    }
    if (method === 'PUT') {
      const body = await bodyOf(req);
      const entity = toEntity({ ...((body.entity as object) ?? {}), id: a });
      if (!entity) return reply(400, { error: 'not an entity' });
      try {
        return reply(200, session.save(entity, actorOf(body, url)));
      } catch (err) {
        return reply(404, { error: String(err) });
      }
    }
    if (method === 'DELETE') {
      session.remove(a, url.searchParams.get('actor') ?? 'console');
      return reply(200, { ok: true });
    }
  }

  if (method === 'POST' && head === 'entities' && a && b === 'move') {
    const body = await bodyOf(req);
    const parentId = String(body.parentId ?? '');
    if (!parentId) return reply(400, { error: 'move needs a parentId' });
    try {
      session.move(a, parentId, actorOf(body, url));
      return reply(200, { ok: true });
    } catch (err) {
      return reply(404, { error: String(err) });
    }
  }

  if (method === 'GET' && head === 'stack' && a && b) {
    if (a === 'declarations') return reply(200, session.loaded.declarations(b));
    if (a === 'templates') return reply(200, session.loaded.templates(b));
  }

  if (method === 'GET' && head === 'boards' && !a) {
    return reply(200, session.shelf.boards());
  }

  if (head === 'board-state' && a && !b) {
    if (method === 'GET') {
      return reply(200, session.campaign.boardState(a) ?? null);
    }
    if (method === 'PUT') {
      const body = await bodyOf(req);
      session.putBoardState(a, body.data ?? null, actorOf(body, url));
      return reply(200, { ok: true });
    }
  }

  if (method === 'GET' && head === 'events' && !a) {
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
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const path = normalize(join(PUBLIC, rel));
  if (!path.startsWith(PUBLIC) || !existsSync(path)) return false;
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

/** The whole server, session in, listener out. Tests call this on port 0. */
export function serve(session: Session, port: number) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const unsubscribe = session.subscribe((what) => {
        res.write(`data: ${what}\n\n`);
      });
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
      return;
    }

    const handled = await handleApi(session, req.method ?? 'GET', url, req);
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

  if (!slug) {
    const have = listCampaigns(dataDir);
    console.log(
      have.length
        ? `campaigns in ${dataDir}:\n${have.map((s) => `  --campaign ${s}`).join('\n')}`
        : `no campaigns in ${dataDir} yet — start one:\n  node server/index.ts --campaign <slug> --new "Its Name"`,
    );
    process.exit(1);
  }

  const shelf = openShelf(dataDir);
  const campaign = args.new
    ? createCampaign(dataDir, slug, args.new)
    : openCampaign(dataDir, slug);
  const session = new Session(shelf, campaign);
  serve(session, port);

  const { system, packs, missing } = session.loaded;
  console.log(`teller-next · ${campaign.slug} · http://localhost:${port}`);
  console.log(
    `  system: ${system ? `${system.name} v${system.version}` : '(none)'}` +
      ` · packs: ${packs.length ? packs.map((p) => p.name).join(', ') : '(none)'}`,
  );
  for (const miss of missing) {
    console.log(`  MISSING ${miss.slot}: ${miss.ref.name} (${miss.ref.id})`);
  }
}

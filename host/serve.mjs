// teller, running on your table. Driven by `teller host` (see cli.mjs).
//
// One process holds the whole thing: the app, the database, the assets,
// the books. Every other screen — the table TV, a rail panel, a player's
// phone — is a browser pointed at this machine. Nothing goes anywhere
// else.
//
// The trick that makes this cheap is that the worker doesn't know. The
// same built bundle that runs on Cloudflare runs here; what changes is
// four bindings underneath it (`host/d1.mjs`, `r2.mjs`, `durable.mjs`,
// `assets.mjs`). Keep it that way — the moment route code learns which
// runtime it's in, there are two implementations to maintain instead of
// one, and they will drift.

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { D1 } from './d1.mjs';
import { R2, objectRoot } from './r2.mjs';
import { DurableNamespace } from './durable.mjs';
import { Assets } from './assets.mjs';
import { migrate } from './migrate.mjs';
import { sweep } from './library.mjs';
import { sweep as sweepPacks } from './packs.mjs';
import { addresses, nameFor, openTunnel } from './reach.mjs';

// Resolved from this file, so the same layout works whether it's the
// repo or an installed copy — `dist/`, `migrations/` and `host/` sit
// side by side in both.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const defaultData = () =>
  resolve(process.env.TELLER_DATA ?? join(homedir(), '.teller'));

const log = (msg) => console.log(`  ${msg}`);

/**
 * The one secret (rule 7), kept beside the data it protects.
 *
 * Generated on first run rather than asked for: a key you were handed is
 * one you can't pick badly. It lives with the database, so a stick that
 * carries the campaign carries the way in — which is the same trust
 * model as a physical book of records, and the right one for a thing
 * that has no accounts.
 */
export async function dmKey(data, { reset = false } = {}) {
  const file = join(data, 'dm.key');
  if (!reset) {
    const existing = await readFile(file, 'utf8').catch(() => null);
    if (existing?.trim()) return existing.trim();
  }
  await mkdir(data, { recursive: true });
  const key = randomBytes(12).toString('base64url');
  await writeFile(file, key, { mode: 0o600 });
  return key;
}

/** node's req/res are not fetch's Request/Response. Translate, both ways. */
function toRequest(req, origin) {
  const url = new URL(req.url, origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((one) => headers.append(k, one));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  });
}

async function send(res, response) {
  const headers = {};
  for (const [k, v] of response.headers) headers[k] = v;
  res.writeHead(response.status, headers);
  if (!response.body) return res.end();
  // Piped, never buffered — this path carries the SSE stream, and a
  // buffered event stream is just a hang with extra steps.
  Readable.fromWeb(response.body).pipe(res);
}

export async function serve({ data = defaultData(), port = 4525, tunnel = null } = {}) {
  const DATA = data;
  const PORT = port;
  console.log('\n  teller\n');
  await mkdir(DATA, { recursive: true });
  await mkdir(objectRoot(DATA), { recursive: true });

  const dbFile = join(DATA, 'teller.db');
  const db = new D1(dbFile);
  const { ran, total } = await migrate(db, join(ROOT, 'migrations'), log);
  log(ran ? `database ready (${ran} of ${total} migrations applied)` : 'database ready');

  // Imported late and by path so a missing build is a clear message
  // rather than a stack trace about module resolution.
  const bundle = join(ROOT, 'dist', 'teller', 'index.js');
  let worker;
  try {
    worker = await import(bundle);
  } catch {
    throw new Error(
      `no build found at ${bundle}\n  This copy of teller is incomplete — reinstall it, or run \`pnpm build\` from the repo.`,
    );
  }

  const env = {
    DB: db,
    MAPS: new R2(objectRoot(DATA)),
    ASSETS: new Assets(join(ROOT, 'dist', 'client')),
    CAMPAIGN: new DurableNamespace(db.raw, worker.CampaignDO),
    DM_KEY: await dmKey(DATA),
  };

  const server = createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host ?? `127.0.0.1:${PORT}`}`;
      const response = await worker.default.fetch(toRequest(req, origin), env);
      await send(res, response);
    } catch (e) {
      console.error('  request failed:', e?.message ?? e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal error');
    }
  });

  // Keep-alive matters here: SSE connections are long-lived by design,
  // and node's default request timeout would cut the room off mid-session.
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 76_000;

  server.on('error', (e) => {
    console.error(
      e.code === 'EADDRINUSE'
        ? `\n  Port ${PORT} is busy — teller may already be running.\n`
        : `\n  ${e.message}\n`,
    );
    process.exit(1);
  });

  // 0.0.0.0, deliberately: this is meant to be reachable by every screen
  // in the room. That's the whole point, and it's why the host belongs on
  // a network you trust.
  await new Promise((up) => server.listen(PORT, '0.0.0.0', up));

  log(`data       ${DATA}`);
  log(`warden key ${env.DM_KEY}`);
  console.log('');
  log('on this machine');
  log(`  http://localhost:${PORT}`);

  // Every route it's actually reachable on, not just the room's. A
  // tailnet costs nothing to notice and is the whole remote story for
  // anyone who already runs one (docs/REACH.md).
  const nics = addresses();
  const room = nics.filter((n) => n.kind === 'lan');
  const net = nics.filter((n) => n.kind === 'tailnet');
  if (room.length) {
    console.log('');
    log('screens in the room');
    for (const { name, address } of room) log(`  http://${address}:${PORT}   (${name})`);
  }
  if (net.length) {
    console.log('');
    log('over your tailnet');
    for (const { address } of net) {
      // Name first — it's the one worth writing down, and the one a
      // kiosk should boot to. The address stays underneath it because
      // MagicDNS is the OTHER end's setting: a guest who has it off can
      // still reach the number.
      const name = await nameFor(address);
      if (name) log(`  http://${name}:${PORT}`);
      log(`  http://${address}:${PORT}`);
    }
  }

  // A tunnel is one more address, never a different teller: whoever
  // opens it lands on the same pairing screen as the phone across the
  // table, and joining still costs a code the warden types (rule 7).
  let pipe = null;
  if (tunnel) {
    console.log('');
    log(`opening a ${tunnel} tunnel…`);
    try {
      pipe = await openTunnel({
        port: PORT,
        onExit: () => console.error('\n  the tunnel closed — the room is still served locally.\n'),
      });
      log(`  ${pipe.url}`);
      log('  anyone with that link reaches the pairing screen; nothing more.');
      log('  it is minted fresh every run — send the new one each time.');
    } catch (e) {
      log(`  no tunnel: ${e.message}`);
      log('  the room is served locally regardless.');
    }
  }

  // Whatever we opened, we close. A tunnel that outlives the host it
  // points at is a URL that 502s at somebody else's table.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    pipe?.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log('\n  ctrl-c to stop\n');

  // Reading books happens here, not in the worker and not in a
  // browser: pdfjs stays out of the runtime-agnostic half, a phone
  // never parses a 300-page rulebook, and it happens once for the
  // table instead of once per screen.
  //
  // The same pass picks up PDFs dropped into the books folder by hand,
  // which is what the loader program used to be for.
  //
  // The pack shelf rides along on the same tick, for the same reason:
  // a `.pack` dropped into the folder should just be there, without
  // anyone restarting anything.
  const scan = () =>
    Promise.all([
      sweep(db.raw, DATA).catch((e) => console.error(`  library: ${e.message}`)),
      sweepPacks(db.raw, DATA).catch((e) => console.error(`  packs: ${e.message}`)),
    ]);
  void scan();
  setInterval(scan, 10_000).unref?.();
}


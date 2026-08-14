// How the table is reachable, and by whom.
//
// `teller host` prints THE address (rule 6). This file works out which
// addresses there ARE — and, if asked, arranges one more. The menu is
// deliberately open: the LAN today, a tailnet if one happens to be up, a
// Cloudflare quick tunnel on request, somebody's own reverse proxy that
// is none of teller's business. teller defines the socket; the owner
// decides what plugs in, the same way it does for packs and books.
//
// The invariant that makes every route safe is rule 7: THE TRANSPORT
// NEVER CARRIES AUTHORITY. Whatever pipe a stranger arrives through,
// they arrive at a pairing-code screen and nothing else, and the warden
// still has to type that code in. A tunnel is a pipe, never a party —
// so swapping transports cannot change who is in a campaign, and this
// file never needs to know anything about auth.

import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

/** Tailscale's own ULA prefix. Nobody else hands these out. */
const TAILSCALE_ULA = 'fd7a:115c:a1e0';

/** Carrier-grade NAT, 100.64.0.0/10 — which is where a tailnet lives. */
function cgnat(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * Is this interface a tailnet?
 *
 * Two signals, and the second is what keeps us honest. Tailscale hands
 * out an address in 100.64.0.0/10 — but that range is carrier-grade
 * NAT, not Tailscale's private property, and an ISP may well have
 * leased you one on a real NIC. What only Tailscale does is pair it
 * with a ULA under fd7a:115c:a1e0 on the SAME interface. The name is
 * the third tell (`tailscale0` on Linux is unambiguous), and between
 * them an ISP's CGNAT lease stays labelled what it is.
 */
function tailnet(name, addrs) {
  if (/^tailscale/i.test(name)) return true;
  return addrs.some(
    (a) => a.family === 'IPv6' && a.address.toLowerCase().startsWith(TAILSCALE_ULA),
  );
}

/**
 * Every address this host answers on, labelled by what kind of reach it
 * is. `lan` is the room; `tailnet` is a machine you already trust that
 * happens to be somewhere else.
 *
 * Split from `addresses()` so it can be driven with an interface table
 * instead of whatever this machine happens to have plugged in. The
 * tailnet rule below is the one piece of judgement in this file, and
 * judgement you can't reproduce on demand is judgement you can't check.
 */
export function classify(interfaces) {
  const found = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    const list = addrs ?? [];
    const kind = tailnet(name, list) ? 'tailnet' : 'lan';
    for (const addr of list) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // An interface can be a tailnet without CGNAT (someone's custom
      // range), but CGNAT on an interface with no other tailnet tell is
      // the ISP's, and calling that "your tailnet" would be a lie.
      if (kind === 'lan' && cgnat(addr.address)) continue;
      found.push({ name, address: addr.address, kind });
    }
  }
  return found;
}

/** What this machine actually has, classified. */
export function addresses() {
  return classify(networkInterfaces());
}

/**
 * The stable NAME for a tailnet address, if MagicDNS will tell us.
 *
 * An address is a lease and a name is not — a lesson the LAN side is
 * still learning. On a tailnet the name is free: MagicDNS answers a
 * plain reverse lookup, so `granite.tailac56ea.ts.net` falls out of
 * `dns.reverse` with no Tailscale CLI, no daemon socket and no
 * dependency. Same "notice what's already true" move as the detection
 * above.
 *
 * Best-effort by construction. A resolver that is slow, absent or
 * unhappy gets us null and the IP prints on its own — booting the table
 * must never wait on DNS.
 */
export async function nameFor(address, { timeoutMs = 500 } = {}) {
  const { reverse } = await import('node:dns/promises');
  let timer;
  try {
    const names = await Promise.race([
      reverse(address),
      new Promise((_, no) => {
        timer = setTimeout(() => no(new Error('timeout')), timeoutMs);
      }),
    ]);
    return names?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── routes you can ask for ────────────────────────────────────────────

/** `--tunnel <name>`. Aliases, because nobody remembers the daemon's name. */
const ROUTES = new Map([
  ['cloudflared', 'cloudflared'],
  ['cloudflare', 'cloudflared'],
  ['cf', 'cloudflared'],
  ['teller', 'teller'],
]);

/**
 * Resolve what the user asked for into a route we can actually open.
 *
 * `teller` is in the table on purpose. It's the one route people will
 * assume exists — the domain is right there on the tin — so it earns a
 * sentence saying what teller.ink actually is, rather than "no such
 * route" from a program that owns the name.
 */
export function route(name) {
  const asked = String(name ?? 'cloudflared')
    .toLowerCase()
    .trim();
  const kind = ROUTES.get(asked);
  if (kind === 'teller') {
    throw new Error(
      'teller.ink is a landing page — play never happens there, and\n' +
        '  there is no relay. For a player outside the room, put them on\n' +
        '  your tailnet; for a one-off, --tunnel cloudflared.\n' +
        '  See docs/REACH.md.',
    );
  }
  if (!kind) {
    throw new Error(`no such route: ${name}\n  routes: cloudflared`);
  }
  return kind;
}

/** Where the quick-tunnel URL shows up in cloudflared's chatter. */
const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const READY_MS = 40_000;

/**
 * A Cloudflare quick tunnel, run as a managed child.
 *
 * Managed, not documented-as-a-second-terminal, because a tunnel that
 * outlives the host it points at is a URL that 502s at somebody else's
 * table. It lives and dies with this process.
 *
 * The URL it mints rotates every run — that's what "quick" means. It's
 * right for a friend dropping in tonight and wrong for a panel you
 * bolted to a wall; the wall panel wants the LAN address, which never
 * changes.
 *
 * Resolves once cloudflared has actually announced a URL, so the caller
 * can print it as a fact rather than a promise.
 */
export function openTunnel({ port, onExit = () => {} } = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(
      'cloudflared',
      ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let settled = false;
    let url = '';
    // Kept only until we've got a URL: if cloudflared dies first, its
    // own last words are a far better error than anything we'd invent.
    const said = [];

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      fail(new Error('cloudflared never announced a URL (waited 40s)'));
    }, READY_MS);
    timer.unref?.();

    const close = () => {
      child.removeAllListeners('exit');
      child.kill('SIGTERM');
      // Some builds ignore the polite ask while a connection is open.
      const hard = setTimeout(() => child.kill('SIGKILL'), 2000);
      hard.unref?.();
    };

    const watch = (stream) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (settled) return;
        for (const line of chunk.split('\n')) {
          if (line.trim()) said.push(line.trim());
        }
        const match = chunk.match(QUICK_URL);
        if (!match) return;
        url = match[0];
        settled = true;
        clearTimeout(timer);
        said.length = 0;
        ok({ kind: 'cloudflared', url, close });
      });
    };

    // cloudflared logs to stderr, but watch both — a version that
    // changes its mind about that shouldn't cost anyone an evening.
    watch(child.stdout);
    watch(child.stderr);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e.code === 'ENOENT') {
        fail(
          new Error(
            'cloudflared is not installed.\n' +
              '  brew install cloudflared   (or see docs/REACH.md)',
          ),
        );
      } else if (e.code === 'EACCES') {
        fail(new Error('cloudflared is on PATH but not runnable (chmod +x?)'));
      } else fail(e);
    });

    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const tail = said.slice(-4).join('\n  ');
        fail(new Error(`cloudflared exited (${code})${tail ? `\n  ${tail}` : ''}`));
        return;
      }
      // Died later: the table keeps playing on the LAN, but the person
      // who was going to join from their house needs to hear about it.
      onExit(code, url);
    });
  });
}

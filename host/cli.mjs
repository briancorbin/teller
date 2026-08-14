// The `teller` command.
//
// Subcommands rather than flags-on-a-bare-command, because this will
// grow — `teller host` today, `teller import` and `teller backup` soon —
// and retrofitting a verb onto a program whose bare form already did
// something is how CLIs end up with `--no-serve`.
//
// Bare `teller` prints help rather than starting a server. Starting a
// service that binds a port and serves your campaign to the network is
// not something a typo should do.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from './reach.mjs';
import { defaultData, dmKey, serve } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function version() {
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return 'unknown';
  }
}

const HELP = `
  teller — the table plays, teller keeps the books

  usage
    teller host [path]        serve this table; everything runs here
    teller key                show the warden key
    teller where              print where campaigns are kept
    teller version

  options
    --port <n>                default 4525
    --data <path>             where campaigns live (default ~/.teller)
    --tunnel cloudflared      also reachable from outside the room
    --reset                   with 'key': mint a new one

  a path given to 'host' is the same as --data, so a campaign can live
  on a stick you carry:

    teller host /Volumes/CARD

  once it's up, every other screen in the room just opens the address it
  prints. nothing is installed on any of them.

  a friend joining from their house is a matter of how this machine is
  reachable, and that's your call — a tailnet you already run (teller
  just notices it), a cloudflared tunnel, or your own reverse proxy.
  whichever route they arrive by, they arrive at a pairing screen and
  you still type the code. see docs/REACH.md.
`;

/** Long flags with values, plus bare positionals. No cleverness wanted. */
function parse(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reset') opts.reset = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=');
      opts[name] = inline ?? argv[++i];
    } else rest.push(arg);
  }
  return { opts, rest };
}

/**
 * teller keeps its database in node's own SQLite, which is only there
 * from Node 22. Checked up front so an old Node fails with a sentence
 * instead of a module-resolution stack trace.
 */
async function requireSqlite() {
  try {
    await import('node:sqlite');
  } catch {
    throw new Error(
      `teller needs Node 22 or newer (this is ${process.version}).\n` +
        '  brew upgrade node',
    );
  }
}

async function main() {
  const { opts, rest } = parse(process.argv.slice(2));
  const command = rest[0] ?? (opts.version ? 'version' : 'help');

  if (opts.help && command !== 'help') {
    console.log(HELP);
    return;
  }

  const data = resolve(opts.data ?? rest[1] ?? defaultData());

  switch (command) {
    case 'host':
    case 'serve': {
      const port = Number(opts.port ?? process.env.TELLER_PORT ?? 4525);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${opts.port} is not a port`);
      }
      // Resolved before anything binds a port: a typo in the route is
      // worth a sentence, not a server that comes up half of what you
      // asked for.
      const tunnel = 'tunnel' in opts ? route(opts.tunnel) : null;
      await requireSqlite();
      await serve({ data, port, tunnel });
      return;
    }

    case 'key': {
      // Reset is destructive in a quiet way: every screen already paired
      // stays paired, but the DM's own device has to be told the new key.
      const key = await dmKey(data, { reset: Boolean(opts.reset) });
      console.log(key);
      return;
    }

    case 'where':
      console.log(data);
      return;

    case 'version':
      console.log(await version());
      return;

    case 'help':
      console.log(HELP);
      return;

    default:
      console.error(`\n  no such command: ${command}\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n  ${e?.message ?? e}\n`);
  process.exit(1);
});

// The `teller` command — the new world's front door.
//
// Subcommands rather than flags-on-a-bare-command, because this will
// grow, and retrofitting a verb onto a program whose bare form already
// did something is how CLIs end up with `--no-serve`. Bare `teller`
// prints help: starting a service that binds a port and serves your
// campaign to the room is not something a typo should do.
//
// This file is the friendly surface and NOTHING else. Every path ends
// in `boot()` (server/index.ts), which is the same code a bare `node
// server/index.ts` runs — a CLI that reimplements the boot is a CLI
// that drifts from it.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadDmKey } from './auth.ts';
import { boot } from './index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The new world has been living in `~/.teller-next` while the old one
// still holds `~/.teller`, and the two databases are not the same shape.
// THE FOLD FLIPS THIS to `~/.teller`, when `worker/` and `host/` die and
// there is only one thing that could have written that folder. Until
// then, pointing the new server at the old data dir would open a
// stranger's database, so it points here.
const DEFAULT_DATA = join(homedir(), '.teller-next');

// The new world's own port. The old CLI's was 4525; running both at once
// during the fold is a normal afternoon, so they don't collide.
const DEFAULT_PORT = 4526;

const HELP = `
  teller — the table plays, teller keeps the books

  usage
    teller host [path]        serve this table; everything runs here
    teller key                show the warden key
    teller where              print where campaigns are kept
    teller plugins            list what's on the shelf (§15)
    teller version

  options
    --port <n>                default ${DEFAULT_PORT}
    --data <path>             where campaigns live (default ${DEFAULT_DATA})
    --campaign <slug>         open this one instead of the remembered one
    --reset                   with 'key': mint a new one
    --enable/--disable <id>   with 'plugins': a human turns one on

  a path given to 'host' is the same as --data, so a campaign can live
  on a stick you carry:

    teller host /Volumes/CARD

  with no campaign named and none remembered, the host boots anyway and
  the console lands on the picker. once it's up, every other screen in
  the room just opens the address it prints. nothing is installed on any
  of them.
`;

/** Long flags with values, plus bare positionals. No cleverness wanted. */
function parse(argv: string[]) {
  const opts: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reset') opts.reset = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--version' || arg === '-v') opts.version = true;
    else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=');
      opts[name] = inline ?? argv[++i] ?? '';
    } else rest.push(arg);
  }
  return { opts, rest };
}

function flag(opts: Record<string, string | true>, name: string): string | undefined {
  const value = opts[name];
  return typeof value === 'string' ? value : value === true ? '' : undefined;
}

function version(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const found = (pkg as { version?: string }).version;
    return found ?? '0.0.0';
  } catch {
    return 'unknown';
  }
}

/** Every address a screen in this room could reach us on. */
function addresses() {
  const found: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      found.push({ name, address: addr.address });
    }
  }
  return found;
}

export async function main(argv: string[]) {
  const { opts, rest } = parse(argv);
  const command = rest[0] ?? (opts.version ? 'version' : 'help');

  if (opts.help && command !== 'help') {
    console.log(HELP);
    return;
  }

  // A bare path means the same as --data — that's the stick you carry.
  const data = resolve((flag(opts, 'data') || rest[1] || DEFAULT_DATA).replace(/^~/, homedir()));

  switch (command) {
    case 'host':
    case 'serve': {
      const port = Number(flag(opts, 'port') || process.env.TELLER_PORT || DEFAULT_PORT);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${flag(opts, 'port')} is not a port`);
      }
      mkdirSync(data, { recursive: true });
      console.log('\n  teller\n');
      console.log(`  data      ${data}`);
      console.log(`  key file  ${join(data, 'dm.key')}\n`);
      const campaign = flag(opts, 'campaign');
      await boot({
        data,
        port: String(port),
        ...(campaign ? { campaign } : {}),
      });
      console.log('');
      console.log('  open on this machine:');
      console.log(`    http://localhost:${port}`);
      const nics = addresses();
      if (nics.length) {
        console.log('  other screens in the room:');
        for (const { name, address } of nics) {
          console.log(`    http://${address}:${port}   (${name})`);
        }
      }
      console.log('\n  ctrl-c to stop\n');
      return;
    }

    case 'key': {
      // Reset is destructive in a quiet way: every screen already paired
      // stays paired, but the DM's own device has to be told the new key.
      mkdirSync(data, { recursive: true });
      const file = join(data, 'dm.key');
      if (opts.reset && existsSync(file)) rmSync(file);
      console.log(loadDmKey(data));
      return;
    }

    case 'plugins': {
      // §15: the CLI is where a HUMAN enables. `boot` already knows how
      // — these are commands that act on the shelf and exit.
      mkdirSync(data, { recursive: true });
      const enable = flag(opts, 'enable');
      const disable = flag(opts, 'disable');
      const configure = flag(opts, 'configure');
      await boot({
        data,
        ...(enable ? { enable } : {}),
        ...(disable ? { disable } : {}),
        ...(configure ? { configure, config: flag(opts, 'config') ?? 'null' } : {}),
        ...(enable || disable || configure ? {} : { plugins: '' }),
      });
      return;
    }

    case 'where':
      console.log(data);
      return;

    case 'version':
      console.log(version());
      return;

    case 'help':
      console.log(HELP);
      return;

    default:
      console.error(`\n  no such command: ${command}\n${HELP}`);
      process.exitCode = 1;
  }
}

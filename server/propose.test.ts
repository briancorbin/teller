// §15 over HTTP: the host assembles the snapshot, config rides in as
// the second argument, and a proposal is words — never a write.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins } from '../core/plugins.ts';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

const KEY = 'test-key-0123456789abcdef';

let dir: string;
let session: Session;
let server: Server;
let base: string;

async function call(
  method: string,
  path: string,
  opts: { key?: boolean; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.key) headers['x-teller-key'] = KEY;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-propose-'));
  const shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_wiw', name: 'WiW', version: 1, data: {} });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      bestiary: [
        {
          id: 'npc_watcher',
          name: 'Bark Watcher',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });

  // An echo plugin: proposes back exactly what it was handed.
  const plug = join(dir, 'plugins', 'echo');
  mkdirSync(plug, { recursive: true });
  writeFileSync(
    join(plug, 'plugin.json'),
    JSON.stringify({
      id: 'plg_echo00000001',
      name: 'Echo',
      version: 1,
      provides: ['propose.turn'],
      needs: [],
    }),
  );
  writeFileSync(
    join(plug, 'host.mjs'),
    `export const provides = {
      'propose.turn': (snapshot, config) => ({ saw: snapshot, config }),
    };`,
  );
  shelf.setPluginEnabled('plg_echo00000001', true);
  shelf.setPluginConfig('plg_echo00000001', { style: 'laconic' });

  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  campaign.save(
    { ...campaign.root(), refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
    'host',
  );
  session = new Session(shelf, campaign);
  const plugins = await loadPlugins(dir, shelf);
  expect(plugins.problems).toEqual([]);
  session.plugins = plugins.loaded;
  server = serve(session, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('propose.turn over HTTP', () => {
  it('assembles the snapshot — resolved acting sheet, named order — and hands config through', async () => {
    const stamped = await call('POST', '/api/stamp', {
      key: true,
      body: { slot: 'bestiary', templateId: 'npc_watcher', name: 'Watcher 1' },
    });
    session.turnOp({ op: 'add', entityId: stamped.body.id }, 'console');
    session.turnOp({ op: 'next' }, 'console');

    const { status, body } = await call('POST', '/api/propose/turn', {
      key: true,
      body: {},
    });
    expect(status).toBe(200);
    expect(body.providers).toBe(1);
    const saw = body.proposals[0].proposal.saw;
    // The acting sheet arrives RESOLVED — the thin stamp's template
    // values are facts the model would otherwise invent.
    expect(saw.acting.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
    expect(saw.order).toEqual([
      { name: 'Watcher 1', score: null, acting: true },
    ]);
    expect(saw.round).toBe(1);
    // And what the human configured came in beside it, cloned.
    expect(body.proposals[0].proposal.config).toEqual({ style: 'laconic' });
  });

  it('is the DM\'s to ask, and an unknown point is named', async () => {
    expect((await call('POST', '/api/propose/turn', { body: {} })).status).toBe(401);
    expect(
      (await call('POST', '/api/propose/decide', { key: true, body: {} })).status,
    ).toBe(404);
  });
});

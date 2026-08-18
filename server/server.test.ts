import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampaign, openShelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Session } from './session.ts';

let dir: string;
let session: Session;
let server: Server;
let base: string;

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-server-'));
  const shelf = openShelf(dir);
  shelf.putSystem({ id: 'sys_wiw', name: 'WiW', version: 1, data: {} });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      bestiary: [
        {
          id: 'npc_bark_watcher',
          name: 'Bark Watcher',
          type: 'foe',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });
  const campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  const root = campaign.root();
  campaign.save(
    { ...root, refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
    'host',
  );
  session = new Session(shelf, campaign);
  server = serve(session, 0);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the campaign endpoint', () => {
  it('says what loaded and what is missing', async () => {
    const { status, body } = await api('GET', '/api/campaign');
    expect(status).toBe(200);
    expect(body.slug).toBe('duo');
    expect(body.system.id).toBe('sys_wiw');
    expect(body.packs.map((p: any) => p.id)).toEqual(['pak_guide']);
    expect(body.missing).toEqual([]);
    expect(body.manifest.name).toBe('The Unlikely Duo');
  });
});

describe('entities over HTTP', () => {
  it('create → roster → read → save → delete, each logged', async () => {
    const made = await api('POST', '/api/entities', {
      draft: {
        name: 'Barrett',
        type: 'character',
        lists: { resources: [{ name: 'Grit', value: 2, max: 3 }] },
      },
      actor: 'dm',
    });
    expect(made.status).toBe(201);
    const id = made.body.id;

    const roster = await api('GET', '/api/entities');
    expect(roster.body).toEqual([
      { id, name: 'Barrett', type: 'character' },
    ]);

    made.body.lists.resources[0].value = 1;
    const saved = await api('PUT', `/api/entities/${id}`, {
      entity: made.body,
      actor: 'seat:barrett',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.lists.resources[0].value).toBe(1);

    const events = await api('GET', `/api/events?entity=${id}`);
    expect(events.body.map((e: any) => e.kind)).toEqual([
      'entity.updated',
      'entity.created',
    ]);
    expect(events.body[0].actor).toBe('seat:barrett');

    await api('DELETE', `/api/entities/${id}`);
    expect((await api('GET', `/api/entities/${id}`)).status).toBe(404);
  });

  it('a nameless draft is a 400, not a row', async () => {
    const { status } = await api('POST', '/api/entities', { draft: {} });
    expect(status).toBe(400);
    expect(await api('GET', '/api/entities').then((r) => r.body)).toEqual([]);
  });
});

describe('stamping over HTTP', () => {
  it('stamps thin from the merged stack and resolves at read', async () => {
    const stamped = await api('POST', '/api/stamp', {
      slot: 'bestiary',
      templateId: 'npc_bark_watcher',
      name: 'Bark Watcher 1',
      actor: 'dm',
    });
    expect(stamped.status).toBe(201);
    expect(stamped.body.lists).toEqual({});
    expect(stamped.body.refs.from.id).toBe('npc_bark_watcher');

    const raw = await api('GET', `/api/entities/${stamped.body.id}`);
    expect(raw.body.lists).toEqual({});
    const resolved = await api(
      'GET',
      `/api/entities/${stamped.body.id}?resolved=1`,
    );
    expect(resolved.body.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
  });

  it('a template nobody has is a 404 naming the miss', async () => {
    const { status, body } = await api('POST', '/api/stamp', {
      slot: 'bestiary',
      templateId: 'npc_gone',
    });
    expect(status).toBe(404);
    expect(body.error).toMatch(/npc_gone/);
  });
});

describe('the stack endpoints', () => {
  it('serves merged templates and declarations', async () => {
    const templates = await api('GET', '/api/stack/templates/bestiary');
    expect(templates.body.map((t: any) => t.id)).toEqual(['npc_bark_watcher']);
    const declarations = await api('GET', '/api/stack/declarations/statuses');
    expect(declarations.body).toEqual([]);
  });
});

describe('board state over HTTP', () => {
  it('round-trips and never touches the shelf', async () => {
    const put = await api('PUT', '/api/board-state/brd_canyon', {
      data: { placements: [{ label: 'rock', u: 1, v: 2 }] },
      actor: 'dm',
    });
    expect(put.status).toBe(200);
    const got = await api('GET', '/api/board-state/brd_canyon');
    expect(got.body.placements[0].label).toBe('rock');
  });
});

describe('the stream', () => {
  it('nudges subscribers when anything changes', async () => {
    const res = await fetch(`${base}/api/stream`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const drain = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
        if (text.includes('data: entities')) break;
      }
    })();
    // Let the subscription land before mutating.
    await new Promise((r) => setTimeout(r, 50));
    expect(session.watching).toBe(1);
    await api('POST', '/api/entities', { draft: { name: 'Sal' } });
    await drain;
    expect(text).toContain('data: entities');
    await reader.cancel();
  });
});

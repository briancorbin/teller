// The board doors — the asset half of §4, and what they must never do.
//
// What these pin is the SEAM. A board is a shelf row and the fight on it
// is campaign state, so deleting a board has to take the state with it,
// let go of the table, and leave the picture alone if another board
// still names it. Every one of those was a separate small decision and
// every one of them is invisible until something needs it back.
//
// Real files and a real server, same reasoning as `books.test.ts`: a
// content-hashed upload is a thing the FILESYSTEM does, and a test that
// stubbed the disk would pin a shape the running host never produces.

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from '../core/store.ts';
import { serve } from './index.ts';
import { Host } from './session.ts';
import { extFor, saveBoardBytes, toGrid, toWidthInches } from './boards.ts';

let dir: string;
let shelf: Shelf;
let host: Host;
let server: Server;
let base: string;

const KEY = 'test-key-0123456789abcdef';

async function api(
  method: string,
  path: string,
  body?: unknown,
  key: string | null = KEY,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { 'x-teller-key': key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** The smallest thing a browser will call a picture: a 1×1 png. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(
  bytes: Buffer,
  type = 'image/png',
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/boards/upload`, {
    method: 'POST',
    headers: { 'x-teller-key': KEY, 'Content-Type': type },
    body: new Uint8Array(bytes),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teller-boards-'));
  mkdirSync(join(dir, 'systems', 'wiw'), { recursive: true });
  writeFileSync(
    join(dir, 'systems', 'wiw', 'system.json'),
    JSON.stringify({ id: 'sys_wiw', name: 'The System', version: 1 }),
  );
  shelf = openShelf(dir);
  host = new Host(shelf, dir);
  server = serve(host, 0, KEY);
  await new Promise((r) => server.on('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  await api('POST', '/api/campaigns', { name: 'The Unlikely Duo', system: 'sys_wiw' });
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  host.session?.campaign.close();
  shelf.close();
});

describe('a picture arriving', () => {
  it('lands under map/, named by its own bytes, and twice is once', async () => {
    const first = await upload(PNG);
    expect(first.status).toBe(201);
    expect(first.body.key).toMatch(/^map\/[0-9a-f]{32}\.png$/);
    expect(existsSync(join(dir, first.body.key))).toBe(true);

    const again = await upload(PNG);
    expect(again.body.key).toBe(first.body.key);
  });

  it('refuses anything that isn’t a picture, and refuses strangers', async () => {
    const wrong = await upload(PNG, 'application/pdf');
    expect(wrong.status).toBe(415);

    const stranger = await fetch(`${base}/api/boards/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(PNG),
    });
    expect(stranger.status).toBe(401);
  });
});

describe('the row', () => {
  it('mints over an uploaded key and answers on the shelf', async () => {
    const { body: up } = await upload(PNG);
    const made = await api('POST', '/api/boards', {
      key: up.key,
      name: 'Copper Canyon',
      widthInches: 36,
    });
    expect(made.status).toBe(201);
    expect(made.body.id).toMatch(/^brd_/);
    expect(made.body.widthInches).toBe(36);

    const list = await api('GET', '/api/boards');
    expect(list.body.map((b: any) => b.name)).toContain('Copper Canyon');
  });

  it('will not mint over a picture that is not there', async () => {
    const made = await api('POST', '/api/boards', { key: 'map/nope.png', name: 'x' });
    expect(made.status).toBe(400);
    // …nor over a path that tries to leave the map folder.
    const escape = await api('POST', '/api/boards', { key: '../dm.key', name: 'x' });
    expect(escape.status).toBe(400);
  });

  it('takes a correction later — rule 1, every stat is typed over', async () => {
    const { body: up } = await upload(PNG);
    const { body: board } = await api('POST', '/api/boards', { key: up.key, name: 'Draft' });

    const named = await api('PATCH', `/api/boards/${board.id}`, {
      name: 'Mountain Pass',
      widthInches: 30,
      grid: { on: true, color: '#ffffff', opacity: 0.3 },
    });
    expect(named.body).toMatchObject({
      name: 'Mountain Pass',
      widthInches: 30,
      grid: { on: true, color: '#ffffff', opacity: 0.3 },
    });

    // An explicit null takes the width back off: no width is a real
    // answer (fit-to-screen, no cells), not a missing one.
    const cleared = await api('PATCH', `/api/boards/${board.id}`, { widthInches: null });
    expect(cleared.body.widthInches).toBeUndefined();
  });
});

describe('taking one off the shelf', () => {
  it('takes the fight with it and lets the table go', async () => {
    const { body: up } = await upload(PNG);
    const { body: board } = await api('POST', '/api/boards', { key: up.key, name: 'Clearing' });

    await api('PUT', `/api/board-state/${board.id}`, {
      data: { placements: [{ label: 'a rock', u: 0.5, v: 0.5 }] },
    });
    await api('PUT', '/api/campaign/refs', { board: board.id });
    const showing = await api('GET', '/api/public');
    expect(showing.body.board?.board.id).toBe(board.id);

    const gone = await api('DELETE', `/api/boards/${board.id}`);
    expect(gone.status).toBe(200);

    // The table is idle again rather than pointed at nothing…
    const after = await api('GET', '/api/public');
    expect(after.body.board).toBeNull();
    // …the state went with it…
    const state = await api('GET', `/api/board-state/${board.id}`);
    expect(state.body).toBeNull();
    // …and so did the bytes, since nothing else named them.
    expect(existsSync(join(dir, up.key))).toBe(false);
  });

  it('leaves the picture alone while another board still names it', async () => {
    const { body: up } = await upload(PNG);
    const { body: lit } = await api('POST', '/api/boards', { key: up.key, name: 'Lit' });
    await api('POST', '/api/boards', { key: up.key, name: 'Dark' });

    await api('DELETE', `/api/boards/${lit.id}`);
    expect(existsSync(join(dir, up.key))).toBe(true);
  });

  it('logs what happened, every time (rule 3)', async () => {
    const { body: up } = await upload(PNG);
    const { body: board } = await api('POST', '/api/boards', { key: up.key, name: 'Logged' });
    await api('PATCH', `/api/boards/${board.id}`, { name: 'Still Logged' });
    await api('DELETE', `/api/boards/${board.id}`);

    const kinds = (host.session?.campaign.events({ limit: 50 }) ?? []).map((e: any) => e.kind);
    expect(kinds).toContain('board.added');
    expect(kinds).toContain('board.edited');
    expect(kinds).toContain('board.removed');
  });
});

describe('the pattern a screen is asked to draw', () => {
  it('reaches the one screen it was aimed at, and nobody else', async () => {
    const hello = await api('POST', '/api/displays/hello', {});
    const id = hello.body.display.id;
    await api('POST', '/api/displays/claim', { code: hello.body.display.code });

    // Nothing in flight is the normal state of the world.
    const quiet = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': id },
    });
    expect(await quiet.json()).toBeNull();

    const aimed = await api('POST', `/api/displays/${id}/calibrate`, {
      pattern: { step: 'across', ppi: 96, ppiY: 96, inches: 12 },
    });
    expect(aimed.status).toBe(200);

    const drawing = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': id },
    });
    expect(await drawing.json()).toEqual({ step: 'across', ppi: 96, ppiY: 96, inches: 12 });

    // A second screen is answered about ITSELF and never about the first.
    const other = await api('POST', '/api/displays/hello', {});
    await api('POST', '/api/displays/claim', { code: other.body.display.code });
    const elsewhere = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': other.body.display.id },
    });
    expect(await elsewhere.json()).toBeNull();

    // And null gives the screen back to itself.
    await api('POST', `/api/displays/${id}/calibrate`, { pattern: null });
    const done = await fetch(`${base}/api/displays/calibration`, {
      headers: { 'x-teller-display': id },
    });
    expect(await done.json()).toBeNull();
  });

  it('refuses a pattern nobody could draw, and refuses strangers', async () => {
    const hello = await api('POST', '/api/displays/hello', {});
    const id = hello.body.display.id;
    await api('POST', '/api/displays/claim', { code: hello.body.display.code });

    const nonsense = await api('POST', `/api/displays/${id}/calibrate`, {
      pattern: { step: 'sideways', ppi: 96, ppiY: 96, inches: 12 },
    });
    expect(nonsense.status).toBe(400);

    const absurd = await api('POST', `/api/displays/${id}/calibrate`, {
      pattern: { step: 'across', ppi: 0, ppiY: 96, inches: 12 },
    });
    expect(absurd.status).toBe(400);

    const stranger = await api(
      'POST',
      `/api/displays/${id}/calibrate`,
      { pattern: null },
      null,
    );
    expect(stranger.status).toBe(401);
  });

  it('writes the RESULT through the ordinary display door', async () => {
    const hello = await api('POST', '/api/displays/hello', {});
    const id = hello.body.display.id;
    await api('POST', '/api/displays/claim', { code: hello.body.display.code });

    const saved = await api('PATCH', `/api/displays/${id}`, { ppi: 108.4, ppiY: 106.9 });
    expect(saved.body).toMatchObject({ ppi: 108.4, ppiY: 106.9 });

    const list = await api('GET', '/api/displays');
    expect(list.body.find((d: any) => d.id === id)).toMatchObject({ ppi: 108.4 });
  });
});

describe('reading an author defensively', () => {
  it('narrows the grid to its own vocabulary', () => {
    expect(toGrid({ on: true, color: '#fff', opacity: 0.3 })).toEqual({
      on: true,
      color: '#fff',
      opacity: 0.3,
    });
    // Not a colour, out of range, and a passenger nobody asked for.
    expect(toGrid({ color: 'red', opacity: 4, sneak: 'x' })).toBeUndefined();
    expect(toGrid('nope')).toBeUndefined();
  });

  it('tells "no width" apart from "no opinion"', () => {
    expect(toWidthInches(36)).toBe(36);
    expect(toWidthInches('36')).toBe(36);
    expect(toWidthInches(null)).toBeNull();
    expect(toWidthInches('')).toBeNull();
    expect(toWidthInches(undefined)).toBeUndefined();
    expect(toWidthInches(-2)).toBeUndefined();
  });

  it('knows a picture from anything else', () => {
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/png; charset=binary')).toBe('png');
    expect(extFor('text/html')).toBeUndefined();
  });

  it('hashes the same bytes to the same name', () => {
    const a = saveBoardBytes(dir, PNG, 'png');
    const b = saveBoardBytes(dir, PNG, 'png');
    expect(a).toBe(b);
  });
});

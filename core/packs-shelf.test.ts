import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './boot.ts';
import { sweepPacks } from './packs-shelf.ts';
import { createCampaign, openShelf, type Campaign, type Shelf } from './store.ts';

let dir: string;
let shelf: Shelf;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-packs-'));
  shelf = openShelf(dir);
});

afterEach(() => {
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A folder on the shelf: `pack.json` plus whatever slots the test wants. */
function writePack(name: string, files: Record<string, unknown>): string {
  const packDir = join(dir, 'packs', name);
  mkdirSync(packDir, { recursive: true });
  for (const [file, value] of Object.entries(files)) {
    writeFileSync(join(packDir, file), JSON.stringify(value, null, 2));
  }
  return packDir;
}

const GUIDEBOOK = {
  'pack.json': {
    id: 'pak_folder01',
    system: 'sys_test',
    name: 'Folder Guidebook',
    version: 3,
    rights: { status: 'personal' },
  },
  'system.json': {
    id: 'sys_test',
    name: 'Test System',
    version: 7,
    dials: { Grit: 'cylinder' },
    statuses: [{ name: 'Dazed' }],
  },
  'bestiary.json': [{ id: 'foe_1', name: 'Coyote', lists: {} }],
};

describe('sweepPacks — a folder yields both shelf entities', () => {
  it('no packs folder yet is just an empty shelf', () => {
    expect(sweepPacks(dir)).toEqual({ systems: [], packs: [], problems: [] });
  });

  it('reads pack.json as identity and every other *.json as a slot', () => {
    writePack('guidebook', GUIDEBOOK);
    const { systems, packs, problems } = sweepPacks(dir);
    expect(problems).toEqual([]);

    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe('pak_folder01');
    expect(packs[0].system).toBe('sys_test');
    expect(packs[0].name).toBe('Folder Guidebook');
    expect(packs[0].version).toBe(3);
    expect(packs[0].data.bestiary).toEqual([{ id: 'foe_1', name: 'Coyote', lists: {} }]);
    // `system.json` is the system's, never a pack slot.
    expect(packs[0].data.system).toBeUndefined();

    expect(systems).toHaveLength(1);
    expect(systems[0]).toMatchObject({ id: 'sys_test', name: 'Test System', version: 7 });
    expect(systems[0].data.dials).toEqual({ Grit: 'cylinder' });
    // Identity keys are reserved — they never become record slots.
    expect(systems[0].data.id).toBeUndefined();
    expect(systems[0].data.version).toBeUndefined();
  });

  it('a folder may carry a pack and no system at all', () => {
    writePack('bestiary-only', {
      'pack.json': { id: 'pak_only', system: 'sys_test', name: 'Just Foes', version: 1 },
      'bestiary.json': [],
    });
    const { systems, packs } = sweepPacks(dir);
    expect(systems).toEqual([]);
    expect(packs).toHaveLength(1);
  });

  it('a folder with no pack.json is not a pack — skipped in silence', () => {
    mkdirSync(join(dir, 'packs', 'not-a-pack'), { recursive: true });
    writeFileSync(join(dir, 'packs', 'not-a-pack', 'bestiary.json'), '[]');
    expect(sweepPacks(dir)).toEqual({ systems: [], packs: [], problems: [] });
  });
});

describe('sweepPacks — degradation is out loud (the panels posture)', () => {
  it('a malformed slot file is reported and only that slot is lost', () => {
    const packDir = writePack('guidebook', GUIDEBOOK);
    writeFileSync(join(packDir, 'catalog.json'), '{ not json');

    const { packs, problems } = sweepPacks(dir);
    expect(packs).toHaveLength(1);
    expect(packs[0].data.bestiary).toBeDefined();
    expect(packs[0].data.catalog).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0].dir).toBe(packDir);
    expect(problems[0].problem).toMatch(/^catalog\.json did not parse/);
  });

  it('a malformed pack.json costs the folder, never the rest of the shelf', () => {
    writePack('guidebook', GUIDEBOOK);
    const brokenDir = join(dir, 'packs', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'pack.json'), '{ not json');

    const { packs, problems } = sweepPacks(dir);
    expect(packs.map((p) => p.id)).toEqual(['pak_folder01']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ dir: brokenDir });
    expect(problems[0].problem).toMatch(/pack\.json is not a pack/);
  });

  it('a pack.json with no id is reported — identity is the id, never the name', () => {
    writePack('nameless', { 'pack.json': { name: 'No Id', version: 1 } });
    const { packs, problems } = sweepPacks(dir);
    expect(packs).toEqual([]);
    expect(problems[0].problem).toMatch(/no id/);
  });

  it('a system.json that is not an object is reported and the pack still loads', () => {
    const packDir = writePack('guidebook', { ...GUIDEBOOK, 'system.json': ['nope'] });
    const { systems, packs, problems } = sweepPacks(dir);
    expect(systems).toEqual([]);
    expect(packs).toHaveLength(1);
    expect(problems).toEqual([
      { dir: packDir, problem: 'system.json is not a system (needs an object)' },
    ]);
  });
});

describe('sweepPacks — art reaches the serving path', () => {
  function writeArt(packDir: string, rel: string, bytes: string) {
    const path = join(packDir, 'art', rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, bytes);
    return path;
  }

  it('copies art under the pack id, where /files/art/… serves it', () => {
    const packDir = writePack('guidebook', {
      ...GUIDEBOOK,
      'brand.json': { logo: 'art/logo.png' },
    });
    writeArt(packDir, 'logo.png', 'PNGBYTES');

    const { packs } = sweepPacks(dir);
    const served = join(dir, 'art', 'pak_folder01', 'logo.png');
    expect(existsSync(served)).toBe(true);
    expect(readFileSync(served, 'utf8')).toBe('PNGBYTES');
    // …and the reference is rewritten to the key that route resolves.
    expect(packs[0].data.brand).toEqual({ logo: 'art/pak_folder01/logo.png' });
  });

  it('rewrites art references anywhere in a slot, however nested', () => {
    const packDir = writePack('guidebook', {
      ...GUIDEBOOK,
      'portraits.json': { Gunslinger: 'art/trades/gun.png' },
      'trades.json': [{ name: 'Gunslinger', art: 'art/trades/gun.png' }],
    });
    writeArt(packDir, 'trades/gun.png', 'JPEG');

    const { packs } = sweepPacks(dir);
    expect(packs[0].data.portraits).toEqual({
      Gunslinger: 'art/pak_folder01/trades/gun.png',
    });
    expect(packs[0].data.trades).toEqual([
      { name: 'Gunslinger', art: 'art/pak_folder01/trades/gun.png' },
    ]);
    expect(existsSync(join(dir, 'art', 'pak_folder01', 'trades', 'gun.png'))).toBe(true);
  });

  it('the rewrite is idempotent — an already-installed key is left alone', () => {
    writePack('guidebook', {
      ...GUIDEBOOK,
      'brand.json': { logo: 'art/pak_folder01/logo.png' },
    });
    const { packs } = sweepPacks(dir);
    expect(packs[0].data.brand).toEqual({ logo: 'art/pak_folder01/logo.png' });
  });

  it('mtime skip — a second sweep does not re-copy an unchanged picture', () => {
    const packDir = writePack('guidebook', GUIDEBOOK);
    writeArt(packDir, 'logo.png', 'PNGBYTES');

    sweepPacks(dir);
    const served = join(dir, 'art', 'pak_folder01', 'logo.png');
    // Push the copy's mtime into the future — an unconditional re-copy
    // would stomp it back down to now.
    const future = new Date(Date.now() + 60_000);
    utimesSync(served, future, future);

    sweepPacks(dir);
    expect(statSync(served).mtimeMs).toBe(future.getTime());
  });
});

describe('loadCampaign — a folder beats a row', () => {
  function campaignOn(system: string, packs: string[]): Campaign {
    const campaign = createCampaign(dir, 'table', 'The Table');
    const root = campaign.root();
    campaign.save(
      {
        ...root,
        refs: {
          system: { id: system, name: system },
          packs: packs.map((id) => ({ id, name: id })),
        },
      },
      'test',
    );
    return campaign;
  }

  it('the folder-sourced system and pack load into the stack', () => {
    writePack('guidebook', GUIDEBOOK);
    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);

    expect(loaded.missing).toEqual([]);
    expect(loaded.system).toMatchObject({ id: 'sys_test', version: 7 });
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_folder01']);
    expect(loaded.record('dials')).toEqual({ Grit: 'cylinder' });
    expect(loaded.templates('bestiary').map((t) => t.name)).toEqual(['Coyote']);
    campaign.close();
  });

  it('an edit to system.json shows up on the next load — the edit recipe', () => {
    const packDir = writePack('guidebook', GUIDEBOOK);
    const campaign = campaignOn('sys_test', ['pak_folder01']);
    expect(loadCampaign(shelf, campaign, dir).record('dials')).toEqual({
      Grit: 'cylinder',
    });

    const system = JSON.parse(readFileSync(join(packDir, 'system.json'), 'utf8'));
    writeFileSync(
      join(packDir, 'system.json'),
      JSON.stringify({ ...system, dials: { ...system.dials, Aces: 'cards' } }),
    );

    expect(loadCampaign(shelf, campaign, dir).record('dials')).toEqual({
      Grit: 'cylinder',
      Aces: 'cards',
    });
    campaign.close();
  });

  it('the folder wins over a shelf.db row of the same id', () => {
    shelf.putSystem({
      id: 'sys_test',
      name: 'Row System',
      version: 1,
      data: { dials: { Grit: 'bar' } },
    });
    shelf.putPack({
      id: 'pak_folder01',
      system: 'sys_test',
      name: 'Row Pack',
      version: 1,
      data: { bestiary: [{ id: 'foe_row', name: 'Row Foe' }] },
    });
    writePack('guidebook', GUIDEBOOK);

    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.system?.name).toBe('Test System');
    expect(loaded.packs[0].name).toBe('Folder Guidebook');
    expect(loaded.record('dials')).toEqual({ Grit: 'cylinder' });
    expect(loaded.templates('bestiary').map((t) => t.name)).toEqual(['Coyote']);
    campaign.close();
  });

  it('a row not yet folder-ized still loads — nothing breaks mid-migration', () => {
    shelf.putSystem({ id: 'sys_test', name: 'Row System', version: 1, data: {} });
    shelf.putPack({
      id: 'pak_row',
      system: 'sys_test',
      name: 'Row Pack',
      version: 1,
      data: { bestiary: [{ id: 'foe_row', name: 'Row Foe' }] },
    });
    writePack('guidebook', GUIDEBOOK);

    // No declared list: every pack for the system applies, rows and
    // folders alike.
    const campaign = createCampaign(dir, 'table', 'The Table');
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: 'sys_test', name: 'sys_test' } } },
      'test',
    );
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packs.map((p) => p.id).sort()).toEqual(['pak_folder01', 'pak_row']);
    expect(loaded.templates('bestiary').map((t) => t.name).sort()).toEqual([
      'Coyote',
      'Row Foe',
    ]);
    campaign.close();
  });

  it('a broken folder is a load-report problem, not a crash', () => {
    writePack('guidebook', GUIDEBOOK);
    const brokenDir = join(dir, 'packs', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'pack.json'), '{ not json');

    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packProblems).toHaveLength(1);
    expect(loaded.packProblems[0].dir).toBe(brokenDir);
    expect(loaded.templates('bestiary')).toHaveLength(1);
    campaign.close();
  });
});

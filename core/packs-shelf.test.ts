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
import { packDir, packPanelDir, sweepPacks, systemIndexModule } from './packs-shelf.ts';
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

  // §J's shape, and the reason it needs its own case: the pictures sit
  // TWO levels down, under a slot that the system also states. A pack
  // restating `dice` with nothing but `art` is how branded faces reach
  // unbranded mechanics (§M-3) — the merge does the joining, and this
  // only has to prove the keys arrive pointing at the served path.
  it('rewrites art two levels down — a pack restating `dice` with only `art`', () => {
    const packDir = writePack('guidebook', {
      ...GUIDEBOOK,
      'dice.json': { art: { hit: 'art/wiw/die_hit.png', ace: 'art/wiw/die_ace.png' } },
    });
    writeArt(packDir, 'wiw/die_hit.png', 'HIT');
    writeArt(packDir, 'wiw/die_ace.png', 'ACE');

    const { packs } = sweepPacks(dir);
    expect(packs[0].data.dice).toEqual({
      art: {
        hit: 'art/pak_folder01/wiw/die_hit.png',
        ace: 'art/pak_folder01/wiw/die_ace.png',
      },
    });
    expect(existsSync(join(dir, 'art', 'pak_folder01', 'wiw', 'die_hit.png'))).toBe(true);
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

describe('sweepPacks — the system carries code (§L phase 2)', () => {
  const PRESENTATION = `export default function TestFace() { return null; }\n`;

  /** A pack folder with `presentations/<name>.tsx` inside it. */
  function writePresentation(pack: string, name: string, source: string): string {
    const packDir = join(dir, 'packs', pack, 'presentations');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, `${name}.tsx`), source);
    return packDir;
  }

  it('compiles to .build and the pack carries code.presentations once trusted', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'TestFace', PRESENTATION);
    shelf.setPluginEnabled('pak_folder01', true);

    const { packs, problems } = sweepPacks(dir, shelf);
    expect(problems).toEqual([]);
    expect(packs[0].codePending).toBeUndefined();
    expect(packs[0].code?.presentations.TestFace).toMatch(
      /^\/pack-code\/pak_folder01\/presentations\/TestFace\.js\?v=[a-z0-9]+$/,
    );

    const built = readFileSync(
      join(dir, 'packs', 'guidebook', '.build', 'presentations', 'TestFace.js'),
      'utf8',
    );
    expect(built).toContain('TestFace');
  });

  it('untrusted: the data loads, the code does not', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'TestFace', PRESENTATION);
    // No trust row — the sweep discovers, only a human enables.

    const { packs, systems } = sweepPacks(dir, shelf);
    expect(packs[0].code).toBeUndefined();
    expect(packs[0].codePending).toBe(true);
    // …and every fact in the folder arrived anyway.
    expect(packs[0].data.bestiary).toHaveLength(1);
    expect(systems[0].data.dials).toEqual({ Grit: 'cylinder' });
  });

  it('a presentation importing `system` fails its compile, readably', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation(
      'guidebook',
      'Cyclic',
      `import { Other } from 'system';\nexport default function Cyclic() { return Other; }\n`,
    );
    shelf.setPluginEnabled('pak_folder01', true);

    const { packs, problems } = sweepPacks(dir, shelf);
    expect(problems).toHaveLength(1);
    expect(problems[0].dir).toBe(join(dir, 'packs', 'guidebook'));
    expect(problems[0].problem).toContain('presentations/Cyclic.tsx');
    expect(problems[0].problem).toContain('system');
    // The pack itself still loaded — a compile error costs the code, never the facts.
    expect(packs[0].data.bestiary).toHaveLength(1);
  });

  it('mtime skip — a second sweep does not recompile an unchanged presentation', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation('guidebook', 'TestFace', PRESENTATION);
    shelf.setPluginEnabled('pak_folder01', true);

    sweepPacks(dir, shelf);
    const out = join(dir, 'packs', 'guidebook', '.build', 'presentations', 'TestFace.js');
    const future = new Date(Date.now() + 60_000);
    utimesSync(out, future, future);

    sweepPacks(dir, shelf);
    expect(statSync(out).mtimeMs).toBe(future.getTime());
  });

  it('packDir resolves a pak_ id back to its folder, and an unknown one to nothing', () => {
    writePack('guidebook', GUIDEBOOK);
    expect(packDir(dir, 'pak_folder01')).toBe(join(dir, 'packs', 'guidebook'));
    expect(packDir(dir, 'pak_nope')).toBeUndefined();
  });
});

describe('sweepPacks — a pack may ship panels', () => {
  it('panel declarations ride the pack layer, and their code takes the same trust', () => {
    const dirPath = writePack('guidebook', GUIDEBOOK);
    mkdirSync(join(dirPath, 'panels', 'sheet', 'blocks'), { recursive: true });
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'panel.json'),
      JSON.stringify({ id: 'pan_pak01', name: 'sheet', label: 'Sheet', blocks: [] }),
    );
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'blocks', 'Row.tsx'),
      'export default function Row() { return null; }\n',
    );

    const { packs, problems } = sweepPacks(dir, shelf);
    expect(problems).toEqual([]);
    const panels = packs[0].data.panels as { name: string; codePending?: boolean }[];
    expect(panels.map((p) => p.name)).toEqual(['sheet']);
    // Data always loads; the code waits for a human, exactly as the
    // table's own and the system's panels do.
    expect(panels[0].codePending).toBe(true);
    expect(packPanelDir(dir, 'pan_pak01')).toBe(join(dirPath, 'panels', 'sheet'));
    expect(packPanelDir(dir, 'pan_nope')).toBeUndefined();
  });

  it('trusted: the pan_ id is its own trust row, not the pack’s', () => {
    const dirPath = writePack('guidebook', GUIDEBOOK);
    mkdirSync(join(dirPath, 'panels', 'sheet', 'blocks'), { recursive: true });
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'panel.json'),
      JSON.stringify({ id: 'pan_pak01', name: 'sheet', label: 'Sheet', blocks: [] }),
    );
    writeFileSync(
      join(dirPath, 'panels', 'sheet', 'blocks', 'Row.tsx'),
      'export default function Row() { return null; }\n',
    );
    shelf.setPluginEnabled('pan_pak01', true);

    const { packs } = sweepPacks(dir, shelf);
    const panels = packs[0].data.panels as {
      codePending?: boolean;
      code?: { blocks?: Record<string, string> };
    }[];
    expect(panels[0].codePending).toBeUndefined();
    // Stamped with the artifact's mtime (`stamp` in `panels-shelf.ts`)
    // so a recompile changes the url — a pack's panel takes the same
    // route a table's does, because it is the same compile.
    expect(panels[0].code?.blocks?.Row).toMatch(
      /^\/panel-code\/pan_pak01\/blocks\/Row\.js\?v=[0-9a-z]+$/,
    );
  });
});

describe('the `system` specifier — one index module over the whole stack', () => {
  function writePresentation(pack: string, name: string, source: string) {
    const packDir = join(dir, 'packs', pack, 'presentations');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, `${name}.tsx`), source);
  }

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

  it('no code anywhere is a VALID EMPTY MODULE, never a 404', () => {
    expect(systemIndexModule({})).toBe('export {};\n');
  });

  it('re-exports each presentation by its file name', () => {
    expect(systemIndexModule({ TestFace: '/pack-code/pak_a/presentations/TestFace.js' })).toBe(
      "export { default as TestFace } from '/pack-code/pak_a/presentations/TestFace.js';\n",
    );
  });

  it('later pack in precedence order wins a name collision', () => {
    writePack('base', {
      'pack.json': { id: 'pak_base', system: 'sys_test', name: 'Base', version: 1 },
      'system.json': { id: 'sys_test', name: 'Test System', version: 1 },
    });
    writePack('extra', {
      'pack.json': { id: 'pak_extra', system: 'sys_test', name: 'Extra', version: 1 },
    });
    writePresentation('base', 'TestFace', 'export default function TestFace() { return null; }\n');
    writePresentation('extra', 'TestFace', 'export default function TestFace() { return null; }\n');
    shelf.setPluginEnabled('pak_base', true);
    shelf.setPluginEnabled('pak_extra', true);

    // Declared order IS precedence order; the later one wins.
    const campaign = campaignOn('sys_test', ['pak_base', 'pak_extra']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(Object.keys(loaded.presentations())).toEqual(['TestFace']);
    expect(loaded.presentations().TestFace).toMatch(
      /^\/pack-code\/pak_extra\/presentations\/TestFace\.js\?v=[a-z0-9]+$/,
    );
    expect(systemIndexModule(loaded.presentations())).toContain('pak_extra');
    campaign.close();
  });

  it('an untrusted pack contributes nothing to the index', () => {
    writePack('guidebook', GUIDEBOOK);
    writePresentation(
      'guidebook',
      'TestFace',
      'export default function TestFace() { return null; }\n',
    );
    const campaign = campaignOn('sys_test', ['pak_folder01']);
    const loaded = loadCampaign(shelf, campaign, dir);
    expect(loaded.packs[0].codePending).toBe(true);
    expect(systemIndexModule(loaded.presentations())).toBe('export {};\n');
    campaign.close();
  });
});

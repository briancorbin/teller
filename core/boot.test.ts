import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './boot.ts';
import { seedPanels } from './panels-shelf.ts';
import { resolve, stamp } from './stamp.ts';
import {
  createCampaign,
  openShelf,
  type Campaign,
  type Shelf,
} from './store.ts';

let dir: string;
let shelf: Shelf;
let campaign: Campaign;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-boot-'));
  shelf = openShelf(dir);
  shelf.putSystem({
    id: 'sys_wiw',
    name: 'Wild Imaginary West',
    version: 3,
    data: {
      statuses: [
        { name: 'Trapped', cap: 5 },
        { name: 'Afraid', cap: 5 },
      ],
    },
  });
  shelf.putPack({
    id: 'pak_guide',
    system: 'sys_wiw',
    name: 'Guidebook',
    data: {
      statuses: [{ name: 'trapped', cap: 5, note: 'the book prose' }],
      bestiary: [
        {
          id: 'npc_wiw_bark_watcher',
          name: 'Bark Watcher',
          type: 'foe',
          lists: { resources: [{ name: 'Health', value: 12, max: 12 }] },
        },
      ],
    },
  });
  campaign = createCampaign(dir, 'duo', 'The Unlikely Duo');
  const root = campaign.root();
  campaign.save(
    {
      ...root,
      refs: {
        system: { id: 'sys_wiw', name: 'Wild Imaginary West' },
        packs: [{ id: 'pak_guide', name: 'Guidebook' }],
      },
    },
    'host',
  );
});

afterEach(() => {
  campaign.close();
  shelf.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('loadCampaign — the resolution law at boot', () => {
  it('resolves the manifest against the shelf, once', () => {
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.system).toEqual({
      id: 'sys_wiw',
      name: 'Wild Imaginary West',
      version: 3,
    });
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_guide']);
    expect(loaded.missing).toEqual([]);
  });

  it('reports a missing pack — never silently dropped', () => {
    const root = campaign.root();
    campaign.save(
      {
        ...root,
        refs: {
          ...root.refs,
          packs: [
            { id: 'pak_guide', name: 'Guidebook' },
            { id: 'pak_gone', name: 'The Lost Supplement' },
          ],
        },
      },
      'host',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_guide']);
    expect(loaded.missing).toEqual([
      { slot: 'pack', ref: { id: 'pak_gone', name: 'The Lost Supplement' } },
    ]);
  });

  it('a missing system degrades, not errors — the table plays on', () => {
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: 'sys_gone', name: 'Vanished' } } },
      'host',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.system).toBeUndefined();
    expect(loaded.missing[0]).toEqual({
      slot: 'system',
      ref: { id: 'sys_gone', name: 'Vanished' },
    });
    expect(loaded.declarations('statuses')).toEqual([]);
  });

  it('no declared pack list means every pack for the system, in arrival order', () => {
    shelf.putPack({
      id: 'pak_home',
      system: 'sys_wiw',
      name: 'House Rules',
      data: {},
    });
    const root = campaign.root();
    campaign.save(
      { ...root, refs: { system: { id: 'sys_wiw', name: 'WiW' } } },
      'host',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.packs.map((p) => p.id)).toEqual(['pak_guide', 'pak_home']);
  });
});

describe('the merged readings', () => {
  it('declarations merge by name — the pack restates the system, the campaign restates them both', () => {
    campaign.putTemplate(
      'statuses',
      { name: 'Trapped', cap: 7, note: 'house rule' },
      'dm',
    );
    campaign.putTemplate('statuses', { name: 'Spooked', cap: 3 }, 'dm');
    const loaded = loadCampaign(shelf, campaign);
    const statuses = loaded.declarations('statuses') as {
      name: string;
      cap: number;
    }[];
    expect(statuses.map((s) => [s.name, s.cap])).toEqual([
      ['Trapped', 7],
      ['Afraid', 5],
      ['Spooked', 3],
    ]);
    expect(loaded.sourceOf('statuses', 'trapped')).toBe('campaign');
    expect(loaded.sourceOf('statuses', 'Afraid')).toBe('system:sys_wiw');
    expect(loaded.sourceOf('statuses', 'Nothing')).toBeUndefined();
  });

  it('templates merge by id — the campaign overrides a pack monster by restating its id', () => {
    campaign.putTemplate(
      'bestiary',
      {
        id: 'npc_wiw_bark_watcher',
        name: 'Bark Watcher (house)',
        lists: { resources: [{ name: 'Health', value: 20, max: 20 }] },
      },
      'dm',
    );
    const loaded = loadCampaign(shelf, campaign);
    const bestiary = loaded.templates('bestiary');
    expect(bestiary).toHaveLength(1);
    expect(bestiary[0].name).toBe('Bark Watcher (house)');
  });

  it('templateOf feeds resolve end to end — stamp thin at the table, read through the merge', () => {
    const loaded = loadCampaign(shelf, campaign);
    const blueprint = loaded.templateOf('bestiary')('npc_wiw_bark_watcher');
    expect(blueprint).toBeDefined();
    const foe = campaign.create(
      stamp(blueprint!, { name: 'Bark Watcher 1' }),
      'dm',
    );
    const read = resolve(
      campaign.get(foe.id)!,
      loaded.templateOf('bestiary', 'catalog'),
    );
    expect(read.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
  });

  it('the campaign template half logs like everything else', () => {
    const { id } = campaign.putTemplate('statuses', { name: 'Spooked' }, 'dm');
    campaign.putTemplate('statuses', { id, name: 'Spooked', cap: 2 }, 'dm');
    campaign.removeTemplate(id, 'dm');
    expect(
      campaign.events({ entityId: id }).map((e) => e.kind),
    ).toEqual(['template.deleted', 'template.updated', 'template.updated']);
    expect(campaign.templatesIn('statuses')).toEqual([]);
  });
});

describe("teller's own furniture (§E)", () => {
  it('ships the standard panels below everything, overridable by name', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_x', name: 'X', data: {} });
    const campaign = createCampaign(dir, 'furn', 'Furniture');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_x', name: 'X' } } },
      't',
    );
    let loaded = loadCampaign(shelf, campaign);
    const names = loaded.declarations('panels').map((p: any) => p.name);
    expect(names).toContain('sheet');
    expect(names).toContain('screens');
    expect(loaded.sourceOf('panels', 'sheet')).toBe('teller');

    // The campaign restates the word and wins — furniture, not law.
    campaign.putTemplate(
      'panels',
      { name: 'sheet', label: 'House Sheet', subject: 'entity', held: [{ block: 'floor' }] },
      't',
    );
    loaded = loadCampaign(shelf, campaign);
    const sheet: any = loaded
      .declarations('panels')
      .find((p: any) => p.name === 'sheet');
    expect(sheet.label).toBe('House Sheet');
    expect(loaded.sourceOf('panels', 'sheet')).toBe('campaign');
    campaign.close();
  });

  it('sweeps the shelf\'s panels/ folder as the teller layer, when a data dir is given', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_y', name: 'Y', data: {} });
    const campaign = createCampaign(dir, 'furn2', 'Furniture Two');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_y', name: 'Y' } } },
      't',
    );

    seedPanels(dir);
    // An edit on the shelf survives — the sweep reads it back, not the
    // in-memory STANDARD_PANELS.
    const sheetPath = join(dir, 'panels', 'sheet', 'panel.json');
    const before = JSON.parse(readFileSync(sheetPath, 'utf8'));
    writeFileSync(sheetPath, JSON.stringify({ ...before, label: 'Edited On Disk' }));

    const loaded = loadCampaign(shelf, campaign, dir);
    const names = loaded.declarations('panels').map((p: any) => p.name);
    expect(names).toContain('sheet');
    expect(loaded.sourceOf('panels', 'sheet')).toBe('teller');
    const sheet: any = loaded.declarations('panels').find((p: any) => p.name === 'sheet');
    expect(sheet.label).toBe('Edited On Disk');
    campaign.close();
  });

  it('a broken panel.json is reported, never a crash — the rest of the shelf loads', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_z', name: 'Z', data: {} });
    const campaign = createCampaign(dir, 'furn3', 'Furniture Three');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_z', name: 'Z' } } },
      't',
    );

    seedPanels(dir);
    const brokenDir = join(dir, 'panels', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'panel.json'), '{ not json');

    const loaded = loadCampaign(shelf, campaign, dir);
    const names = loaded.declarations('panels').map((p: any) => p.name);
    expect(names).toContain('sheet');
    expect(names).toContain('bare');
    expect(loaded.panelProblems).toHaveLength(1);
    expect(loaded.panelProblems[0].dir).toBe(brokenDir);
    campaign.close();
  });
});

describe('sections — declarations, merged by name (§J)', () => {
  it('a pack section loads, and the campaign overrides one by restating its name', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({ id: 'sys_s', name: 'S', data: {} });
    shelf.putPack({
      id: 'pak_s',
      system: 'sys_s',
      name: 'Guidebook',
      data: {
        sections: [
          {
            name: 'Skills',
            entries: [{ name: 'Charm', meta: 'convince, barter', text: 'Roll with Charm…', page: 26 }],
          },
          { name: 'Task Difficulty', entries: [{ name: 'Very Easy', text: '1 Hit', page: 26 }] },
        ],
      },
    });
    const campaign = createCampaign(dir, 'sec', 'Sections');
    campaign.save(
      {
        ...campaign.root(),
        refs: { system: { id: 'sys_s', name: 'S' }, packs: [{ id: 'pak_s', name: 'Guidebook' }] },
      },
      't',
    );
    let loaded = loadCampaign(shelf, campaign);
    const names = loaded.declarations('sections').map((s: any) => s.name);
    expect(names).toEqual(['Skills', 'Task Difficulty']);
    expect(loaded.sourceOf('sections', 'Skills')).toBe('pack:pak_s');

    // The campaign restates a section's name wholesale and wins — the
    // table's own note beats the book's (rule 1).
    campaign.putTemplate(
      'sections',
      { name: 'Skills', entries: [{ name: 'Charm', text: 'House ruling: also covers haggling.' }] },
      't',
    );
    loaded = loadCampaign(shelf, campaign);
    const skills: any = loaded.declarations('sections').find((s: any) => s.name === 'Skills');
    expect(skills.entries).toEqual([{ name: 'Charm', text: 'House ruling: also covers haggling.' }]);
    expect(loaded.sourceOf('sections', 'Skills')).toBe('campaign');
    campaign.close();
  });
});

describe('the record stack (visual vocabulary)', () => {
  it('shallow-merges records, later layer winning per key', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_r',
      name: 'R',
      data: { accents: { Doctor: '#ff8a28', Marshal: '#50a9dc' } },
    });
    shelf.putPack({
      id: 'pak_r',
      system: 'sys_r',
      name: 'P',
      data: { accents: { Marshal: '#123456' } },
    });
    const campaign = createCampaign(dir, 'rec', 'Rec');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_r', name: 'R' } } },
      't',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.record('accents')).toEqual({
      Doctor: '#ff8a28',
      Marshal: '#123456', // the pack restated the key and won
    });
    expect(loaded.record('nothing')).toEqual({});
    campaign.close();
  });

  it('carries dice and marks straight through — a system-layer record, same as accents (§J)', () => {
    const shelf = openShelf(dir);
    shelf.putSystem({
      id: 'sys_d',
      name: 'D',
      data: {
        dice: {
          faces: { B: ['hit', 'hit', 'ace', 'blank', 'blank', 'spur'] },
          values: { hit: 1, ace: 2, blank: 0, spur: 0 },
          unit: 'Hits',
          track: 6,
          trackBonus: 1,
          banks: [{ face: 'ace', counter: 'Aces' }],
        },
        marks: { kind: 'mark', text: 'rerolls Spurs', label: 'Talents', categories: ['Charm'] },
      },
    });
    const campaign = createCampaign(dir, 'dice', 'Dice');
    campaign.save(
      { ...campaign.root(), refs: { system: { id: 'sys_d', name: 'D' } } },
      't',
    );
    const loaded = loadCampaign(shelf, campaign);
    expect(loaded.record('dice')).toEqual({
      faces: { B: ['hit', 'hit', 'ace', 'blank', 'blank', 'spur'] },
      values: { hit: 1, ace: 2, blank: 0, spur: 0 },
      unit: 'Hits',
      track: 6,
      trackBonus: 1,
      banks: [{ face: 'ace', counter: 'Aces' }],
    });
    expect(loaded.record('marks')).toEqual({
      kind: 'mark',
      text: 'rerolls Spurs',
      label: 'Talents',
      categories: ['Charm'],
    });
    campaign.close();
  });
});

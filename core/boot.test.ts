import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCampaign } from './boot.ts';
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
});

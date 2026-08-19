import { describe, expect, it } from 'vitest';
import { mergeNamed } from './merge.ts';
import { resolve, stamp, toTemplate, type Template } from './stamp.ts';
import type { Entity } from './entity.ts';

describe('mergeNamed — the one merge shape', () => {
  it('later wins by name, in place; new names append', () => {
    const system = [
      { name: 'Trapped', note: 'the book says' },
      { name: 'Afraid', note: 'the book says' },
    ];
    const pack = [{ name: 'trapped', note: 'the pack restates' }];
    const campaign = [{ name: 'Spooked', note: 'the table invented' }];
    expect(mergeNamed(system, pack, campaign)).toEqual([
      { name: 'trapped', note: 'the pack restates' },
      { name: 'Afraid', note: 'the book says' },
      { name: 'Spooked', note: 'the table invented' },
    ]);
  });

  it('skips absent layers — a host with no packs is a host, not an error', () => {
    expect(mergeNamed(undefined, [{ name: 'x' }], undefined)).toEqual([
      { name: 'x' },
    ]);
  });
});

const barkWatcher: Template = {
  id: 'npc_wiw_bark_watcher',
  name: 'Bark Watcher',
  type: 'foe',
  lists: {
    resources: [{ name: 'Health', value: 12, max: 12 }],
    skills: [{ name: 'Finesse', value: 2 }],
  },
  notes: 'it watches',
};

const lookup = (id: string) =>
  id === barkWatcher.id ? barkWatcher : undefined;

describe('stamp', () => {
  it('thin by default: the link, the name, and nothing stored', () => {
    const foe = stamp(barkWatcher, { name: 'Bark Watcher 2' });
    expect(foe.id).toMatch(/^ent_/);
    expect(foe.name).toBe('Bark Watcher 2');
    expect(foe.type).toBe('foe');
    expect(foe.refs).toEqual({
      from: { id: 'npc_wiw_bark_watcher', name: 'Bark Watcher' },
    });
    expect(foe.lists).toEqual({});
  });

  it('thick copies every value at birth — creation is authorship', () => {
    const character = stamp(barkWatcher, { thick: true });
    expect(character.lists).toEqual(barkWatcher.lists);
    expect(character.lists).not.toBe(barkWatcher.lists);
    expect(character.notes).toBe('it watches');
  });
});

describe('resolve', () => {
  it('a thin stamp reads the template through the link', () => {
    const foe = stamp(barkWatcher);
    const read = resolve(foe, lookup);
    expect(read.lists.resources).toEqual([
      { name: 'Health', value: 12, max: 12 },
    ]);
    expect(read.notes).toBe('it watches');
  });

  it('stored values win — a human typed over the book', () => {
    const foe = stamp(barkWatcher);
    foe.lists.resources = [{ name: 'Health', value: 5, max: 12 }];
    const read = resolve(foe, lookup);
    expect(read.lists.resources).toEqual([{ name: 'Health', value: 5, max: 12 }]);
    expect(read.lists.skills).toEqual([{ name: 'Finesse', value: 2 }]);
  });

  it('a pack correction reaches every thin stamp at the next read', () => {
    const foe = stamp(barkWatcher);
    const corrected: Template = {
      ...barkWatcher,
      lists: { ...barkWatcher.lists, skills: [{ name: 'Finesse', value: 3 }] },
    };
    const read = resolve(foe, () => corrected);
    expect(read.lists.skills).toEqual([{ name: 'Finesse', value: 3 }]);
  });

  it('template gone: the entity as it stands, cached name intact', () => {
    const foe = stamp(barkWatcher);
    foe.lists.resources = [{ name: 'Health', value: 5 }];
    const read = resolve(foe, () => undefined);
    expect(read.lists).toEqual({ resources: [{ name: 'Health', value: 5 }] });
    expect(read.refs?.from).toEqual({
      id: 'npc_wiw_bark_watcher',
      name: 'Bark Watcher',
    });
  });

  it('no link at all: an entity invented at the table resolves to itself', () => {
    const invented: Entity = { id: 'ent_x', name: 'Mysterious Rock', lists: {} };
    expect(resolve(invented, lookup)).toEqual(invented);
  });

  it('children resolve recursively — the stamped gun inside the stamped character', () => {
    const gun: Template = {
      id: 'itm_rusty_pistol',
      name: 'Rusty Pistol',
      lists: { stats: [{ name: 'Range', value: 3 }] },
    };
    const character = stamp(barkWatcher, { thick: true });
    character.children = [stamp(gun)];
    const read = resolve(character, (id) =>
      id === gun.id ? gun : lookup(id),
    );
    expect(read.children?.[0].lists.stats).toEqual([{ name: 'Range', value: 3 }]);
  });
});

describe('toTemplate', () => {
  it('anything entity-shaped will do — a blueprint row, a catalogue line', () => {
    expect(
      toTemplate({
        id: 'itm_pistol',
        name: 'Pistol',
        lists: { stats: [{ name: 'Range', current: 3 }] },
      }),
    ).toEqual({
      id: 'itm_pistol',
      name: 'Pistol',
      lists: { stats: [{ name: 'Range', value: 3 }] },
    });
    expect(toTemplate({ lists: {} })).toBeUndefined();
  });

  it('round-trips children — a foe template carries its attacks (§I)', () => {
    expect(
      toTemplate({
        id: 'npc_x',
        name: 'Bark Watcher',
        lists: {},
        children: [
          {
            id: 'atk_1',
            name: 'Bark Slash',
            type: 'attack',
            lists: { profile: [{ name: 'Band', value: 'Melee' }] },
          },
        ],
      }),
    ).toEqual({
      id: 'npc_x',
      name: 'Bark Watcher',
      children: [
        {
          id: 'atk_1',
          name: 'Bark Slash',
          type: 'attack',
          lists: { profile: [{ name: 'Band', value: 'Melee' }] },
        },
      ],
    });
  });
});

describe('resolve — template children (§I: attacks are entities)', () => {
  const attack: Template = {
    id: 'atk_bark_slash',
    name: 'Bark Slash',
    type: 'attack',
    lists: {
      profile: [
        { name: 'Band', value: 'Melee' },
        { name: 'Cost', value: 3 },
        { name: 'Damage', value: '2G' },
      ],
      inflicts: [],
    },
  };
  const foeWithAttacks: Template = { ...barkWatcher, id: 'npc_with_attacks', children: [attack] };

  it('a thin stamp reads its template attacks through resolve()', () => {
    const foe = stamp(foeWithAttacks);
    const read = resolve(foe, (id) => (id === foeWithAttacks.id ? foeWithAttacks : undefined));
    expect(read.children).toEqual([
      {
        id: 'atk_bark_slash',
        name: 'Bark Slash',
        type: 'attack',
        lists: attack.lists,
      },
    ]);
  });

  it('a thick stamp copies the attacks at birth, same shape', () => {
    const character = stamp(foeWithAttacks, { thick: true });
    expect(character.children).toEqual([
      { id: 'atk_bark_slash', name: 'Bark Slash', type: 'attack', lists: attack.lists },
    ]);
  });
});

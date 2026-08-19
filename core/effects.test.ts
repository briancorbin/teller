import { describe, expect, it } from 'vitest';
import type { Entity } from './entity.ts';
import {
  affordable,
  amendPool,
  costWrites,
  describeEffect,
  isRefusal,
  locate,
  needsChoice,
  poolCounts,
  poolText,
  spendOptions,
  tierAt,
  toSpends,
  type SpendsDecl,
  type SpendWorld,
} from './effects.ts';

// Deliberately NOT the WiW declaration: the interpreter must never have
// learned one system's words, so the fixture invents its own.
const faces = { R: ['hit'], W: ['hit', 'hit'] };

const spends: SpendsDecl = {
  counter: 'Favour · Unspent',
  total: 'Favour · Lifetime',
  claims: true,
  label: 'Favour',
  tiers: [
    { name: 'Novice', at: 0 },
    { name: 'Adept', at: 10 },
    { name: 'Master', at: 25 },
  ],
  menu: [
    {
      name: 'Sharpen',
      cost: 2,
      effect: { kind: 'pool', group: 'arts', op: 'convert', from: 'R', to: 'W', count: 1 },
    },
    { name: 'Deepen', cost: 6, effect: { kind: 'pool', group: 'arts', op: 'add', dice: '1R' } },
    { name: 'Toughen', cost: 2, effect: { kind: 'max', counter: 'Vigour', amount: 1 } },
    { name: 'Attune', cost: 4, effect: { kind: 'mark' } },
    { name: 'Acquire', cost: 4, effect: { kind: 'item', itemKind: 'relic' } },
    { name: 'Something else', cost: 1 },
    { name: 'From the future', cost: 3, effect: { kind: 'teleport' } },
  ],
};

const entity: Entity = {
  id: 'ent_1',
  name: 'Someone',
  lists: {
    arts: [
      { name: 'Weaving', value: '2R' },
      { name: 'Singing', value: '3R1W' },
      { name: 'Reading', value: 'Untrained' },
    ],
    pools: [
      { name: 'Vigour', value: 8, max: 8 },
      { name: 'Wind', value: 2, max: 5 },
      { name: 'Favour · Unspent', value: 5 },
      { name: 'Favour · Lifetime', value: 12 },
    ],
    tokens: [{ name: 'Singing' }],
  },
  children: [
    { id: 'itm_1', name: 'Old Bell', lists: {}, type: 'relic', refs: { from: { id: 'rel_bell', name: 'Old Bell' } } },
  ],
};

const world: SpendWorld = {
  entity,
  groups: { arts: ['Weaving', 'Singing', 'Reading', 'Absent'] },
  faces,
  marks: { list: 'tokens', categories: ['Weaving', 'Singing', 'Reading'] },
  catalog: {
    slot: 'catalog',
    items: [
      { id: 'rel_bell', name: 'Old Bell', type: 'relic' },
      { id: 'rel_coin', name: 'Bent Coin', type: 'relic' },
      { id: 'rel_ash', name: 'Ash Wand', type: 'relic' },
      { id: 'gea_rope', name: 'Rope', type: 'gear' },
    ],
  },
};

const menu = (name: string) => spends.menu.find((s) => s.name === name)!;

describe('toSpends — the forgiving read', () => {
  it('needs a counter and nothing else', () => {
    expect(toSpends({ counter: 'X' })).toEqual({ counter: 'X', menu: [] });
    expect(toSpends({})).toBeUndefined();
    expect(toSpends('nonsense')).toBeUndefined();
  });

  it('drops menu items with no name or no cost, keeps the rest', () => {
    const out = toSpends({
      counter: 'X',
      menu: [{ name: 'Fine', cost: 1 }, { name: 'No cost' }, { cost: 2 }],
    });
    expect(out?.menu.map((m) => m.name)).toEqual(['Fine']);
  });

  it('carries an effect kind it does not understand rather than dropping it', () => {
    const out = toSpends({ counter: 'X', menu: [{ name: 'A', cost: 1, effect: { kind: 'teleport' } }] });
    expect(out?.menu[0].effect?.kind).toBe('teleport');
  });

  it('drops a tier with no threshold', () => {
    const out = toSpends({ counter: 'X', tiers: [{ name: 'A', at: 0 }, { name: 'B' }] });
    expect(out?.tiers).toEqual([{ name: 'A', at: 0 }]);
  });
});

describe('tierAt — derived, never stored', () => {
  it('is the highest threshold reached', () => {
    expect(tierAt(spends.tiers, 0)?.name).toBe('Novice');
    expect(tierAt(spends.tiers, 9)?.name).toBe('Novice');
    expect(tierAt(spends.tiers, 10)?.name).toBe('Adept');
    expect(tierAt(spends.tiers, 999)?.name).toBe('Master');
  });

  it('is nothing below the first rung, and nothing with no scale', () => {
    expect(tierAt([{ name: 'Adept', at: 10 }], 3)).toBeUndefined();
    expect(tierAt(undefined, 50)).toBeUndefined();
  });
});

describe('pools', () => {
  it('reads and prints in the system’s declared die order', () => {
    expect(poolCounts('3R1W', faces)).toEqual({ R: 3, W: 1 });
    expect(poolText({ W: 1, R: 3 }, faces)).toBe('3R1W');
  });

  it('is not a pool if it is words, or a letter this system never declared', () => {
    expect(poolCounts('Untrained', faces)).toBeUndefined();
    expect(poolCounts('2Q', faces)).toBeUndefined();
    expect(poolCounts(7, faces)).toBeUndefined();
  });

  it('add adds', () => {
    expect(amendPool('2R', { kind: 'pool', group: 'arts', op: 'add', dice: '1R' }, faces)).toBe('3R');
  });

  it('convert exchanges only what is there', () => {
    const e = { kind: 'pool', group: 'arts', op: 'convert', from: 'R', to: 'W', count: 1 } as const;
    expect(amendPool('2R', e, faces)).toBe('1R1W');
    const greedy = { ...e, count: 5 };
    expect(amendPool('2R', greedy, faces)).toBe('2W');
  });

  it('leaves a non-pool alone rather than mangling it', () => {
    const e = { kind: 'pool', group: 'arts', op: 'add', dice: '1R' } as const;
    expect(amendPool('Untrained', e, faces)).toBeUndefined();
  });

  it('a convert with nothing to convert is no change at all', () => {
    const e = { kind: 'pool', group: 'arts', op: 'convert', from: 'W', to: 'R', count: 1 } as const;
    expect(amendPool('2R', e, faces)).toBeUndefined();
  });
});

describe('locate — a name is looked for in every list', () => {
  it('finds the entry and the list it lives in', () => {
    expect(locate(entity, 'vigour')).toEqual({ list: 'pools', entry: { name: 'Vigour', value: 8, max: 8 } });
  });

  it('is nothing for a name nobody carries', () => {
    expect(locate(entity, 'Nope')).toBeUndefined();
    expect(locate(undefined, 'Vigour')).toBeUndefined();
  });
});

describe('the cost', () => {
  it('debits the wallet and, under claims, credits the lifetime by the same amount', () => {
    expect(costWrites(spends, entity, 2)).toEqual([
      { list: 'pools', name: 'Favour · Unspent', value: 3 },
      { list: 'pools', name: 'Favour · Lifetime', value: 14 },
    ]);
  });

  it('without claims the lifetime is left alone — spending is not unearning', () => {
    expect(costWrites({ ...spends, claims: false }, entity, 2)).toEqual([
      { list: 'pools', name: 'Favour · Unspent', value: 3 },
    ]);
  });

  it('affordable is presented, never enforced — an undeclared wallet is not evidence of zero', () => {
    expect(affordable(spends, entity, 5)).toBe(true);
    expect(affordable(spends, entity, 6)).toBe(false);
    expect(affordable(spends, { ...entity, lists: {} }, 99)).toBe(true);
  });
});

describe('pool effects', () => {
  it('offers one option per entry the effect can actually change', () => {
    const out = spendOptions(spends, menu('Sharpen'), world);
    if (isRefusal(out)) throw new Error(out.refusal);
    // Reading is not a pool, and Absent isn't carried at all.
    expect(out.map((o) => o.key)).toEqual(['Weaving', 'Singing']);
    expect(out[0].label).toBe('Weaving 2R → 1R1W');
  });

  it('the plan is the cost, then the change — one confirm, several writes', () => {
    const out = spendOptions(spends, menu('Deepen'), world);
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out[0].plan).toEqual({
      entries: [
        { list: 'pools', name: 'Favour · Unspent', value: -1 },
        { list: 'pools', name: 'Favour · Lifetime', value: 18 },
        { list: 'arts', name: 'Weaving', value: '3R' },
      ],
      stamps: [],
    });
  });
});

describe('max effects', () => {
  it('raises the ceiling, and tops up only what was already full', () => {
    const out = spendOptions(spends, menu('Toughen'), world);
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out).toHaveLength(1);
    expect(out[0].plan.entries.at(-1)).toEqual({
      list: 'pools',
      name: 'Vigour',
      max: 9,
      value: 9,
    });
  });

  it('a half-empty bar gets a higher ceiling and no free healing', () => {
    const wind = { ...spends, menu: [{ name: 'W', cost: 1, effect: { kind: 'max' as const, counter: 'Wind', amount: 2 } }] };
    const out = spendOptions(wind, wind.menu[0], world);
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out[0].plan.entries.at(-1)).toEqual({ list: 'pools', name: 'Wind', max: 7 });
  });

  it('refuses out loud when nothing carries the name', () => {
    const ghost = { ...spends, menu: [{ name: 'G', cost: 1, effect: { kind: 'max' as const, counter: 'Nope', amount: 1 } }] };
    const out = spendOptions(ghost, ghost.menu[0], world);
    expect(isRefusal(out) && out.refusal).toContain("'Nope'");
  });
});

describe('mark effects', () => {
  it('offers every declared category not already held', () => {
    const out = spendOptions(spends, menu('Attune'), world);
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out.map((o) => o.key)).toEqual(['Weaving', 'Reading']);
    expect(out[0].plan.entries.at(-1)).toEqual({ list: 'tokens', name: 'Weaving' });
  });

  it('refuses out loud with nothing declared', () => {
    const out = spendOptions(spends, menu('Attune'), { ...world, marks: undefined });
    expect(isRefusal(out) && out.refusal).toContain('marks');
  });
});

describe('item effects', () => {
  it('offers catalogue templates of the right type that are not already carried', () => {
    const out = spendOptions(spends, menu('Acquire'), world);
    if (isRefusal(out)) throw new Error(out.refusal);
    // Rope is the wrong type; the Old Bell is already on the sheet.
    expect(out.map((o) => o.key)).toEqual(['rel_ash', 'rel_coin']);
    expect(out[0].plan.stamps).toEqual([{ slot: 'catalog', templateId: 'rel_ash', name: 'Ash Wand' }]);
  });

  it('refuses out loud with no catalogue', () => {
    const out = spendOptions(spends, menu('Acquire'), { ...world, catalog: undefined });
    expect(isRefusal(out) && out.refusal).toContain('catalogue');
  });
});

describe('the honest edges', () => {
  it('a purchase with no effect is a debit and a reminder', () => {
    const out = spendOptions(spends, menu('Something else'), world);
    if (isRefusal(out)) throw new Error(out.refusal);
    expect(out).toHaveLength(1);
    expect(out[0].plan.entries).toHaveLength(2);
    expect(out[0].plan.stamps).toEqual([]);
    expect(needsChoice(undefined)).toBe(false);
  });

  it('an unknown effect kind is refused by name, never silently debited', () => {
    const out = spendOptions(spends, menu('From the future'), world);
    expect(isRefusal(out)).toBe(true);
    expect(isRefusal(out) && out.refusal).toContain('teleport');
  });

  it('nothing left to pick is an empty list, not an error', () => {
    const all = { ...world, marks: { list: 'tokens', categories: ['Singing'] } };
    const out = spendOptions(spends, menu('Attune'), all);
    expect(isRefusal(out)).toBe(false);
    expect(out).toEqual([]);
  });

  it('describes every kind it knows, and names the one it does not', () => {
    expect(describeEffect(menu('Sharpen').effect)).toContain('arts');
    expect(describeEffect(menu('Deepen').effect)).toContain('1R');
    expect(describeEffect(menu('Toughen').effect)).toContain('Vigour');
    expect(describeEffect(menu('Acquire').effect)).toContain('relic');
    expect(describeEffect(menu('From the future').effect)).toContain('teleport');
    expect(describeEffect(undefined)).toContain('by hand');
  });
});

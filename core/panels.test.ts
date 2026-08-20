// The panel declaration's own grammar: what a `panel.json` may say, and
// what a collection of them can be wrong about.
//
// §M-5a (the composite) and §M-5a′ (the include) both land here rather
// than in the renderer, because both are facts about DECLARATIONS: the
// tab list is data a table can reorder in four lines of json, and a
// dangling or circular include is knowable the moment the merge settles.

import { describe, expect, it } from 'vitest';
import {
  includeProblems,
  includedNames,
  surfaceable,
  toPanel,
  type PanelDef,
} from './panels.ts';

describe('what toPanel keeps', () => {
  it('reads a composite whole — tabs, omissions, chrome overrides, its glyph', () => {
    const panel = toPanel({
      name: 'seat',
      label: 'Seat',
      icon: 'sheet',
      subject: 'entity',
      tabs: ['sheet', ' Weapons ', 'More'],
      omit: ['bare'],
      chrome: { header: 'Header', bar: 'ScreenBar', nonsense: 'Nope', frame: '  ' },
    });
    expect(panel?.tabs).toEqual(['sheet', 'Weapons', 'More']);
    expect(panel?.omit).toEqual(['bare']);
    expect(panel?.icon).toBe('sheet');
    // Only the five seams exist, and only a non-empty word names one.
    expect(panel?.chrome).toEqual({ header: 'Header', bar: 'ScreenBar' });
  });

  it('keeps `surface: false` and nothing else about it', () => {
    expect(toPanel({ name: 'vitals-strip', surface: false })?.surface).toBe(false);
    // Silence means surfaceable — the ordinary case must never need saying.
    expect(toPanel({ name: 'sheet' })?.surface).toBeUndefined();
    expect(toPanel({ name: 'sheet', surface: true })?.surface).toBeUndefined();
  });

  it('drops a tabs list that is not a list of words', () => {
    expect(toPanel({ name: 'seat', tabs: 'sheet' })?.tabs).toBeUndefined();
    expect(toPanel({ name: 'seat', tabs: ['sheet', 3, ''] })?.tabs).toEqual(['sheet']);
  });
});

describe('a fragment is not a surface', () => {
  it('says no to `surface: false` and yes to everything else', () => {
    expect(surfaceable({ name: 'sheet' })).toBe(true);
    expect(surfaceable({ name: 'strip', surface: false })).toBe(false);
  });
});

describe('what an arrangement includes', () => {
  it('finds includes at any depth, deduped, columns and both glasses walked', () => {
    const panel: PanelDef = {
      name: 'sheet',
      mounted: [
        { block: 'columns', columns: [[{ block: 'panel', name: 'vitals' }], [{ block: 'list' }]] },
        { block: 'panel', name: 'vitals' },
      ],
      held: [{ block: 'panel', name: 'statuses-strip' }],
    };
    expect(includedNames(panel).sort()).toEqual(['statuses-strip', 'vitals']);
  });

  it('ignores an include with no name', () => {
    expect(includedNames({ name: 'x', held: [{ block: 'panel' }] })).toEqual([]);
  });
});

describe('includes that refuse out loud', () => {
  it('says nothing about a collection that resolves', () => {
    expect(
      includeProblems([
        { name: 'seat', held: [{ block: 'panel', name: 'vitals' }] },
        { name: 'vitals', surface: false, held: [{ block: 'list', list: 'resources' }] },
      ]),
    ).toEqual([]);
  });

  it('names the panel and the word when nobody declares it', () => {
    const [problem] = includeProblems([
      { name: 'seat', held: [{ block: 'panel', name: 'vitals' }] },
    ]);
    expect(problem.dir).toBe("panel 'seat'");
    expect(problem.problem).toContain("includes 'vitals'");
    expect(problem.problem).toContain('no panel by that name');
  });

  it('catches a cycle — direct, and around a longer ring', () => {
    const direct = includeProblems([
      { name: 'a', held: [{ block: 'panel', name: 'b' }] },
      { name: 'b', held: [{ block: 'panel', name: 'a' }] },
    ]);
    expect(direct.length).toBeGreaterThan(0);
    expect(direct[0].problem).toContain('includes it back');

    const ring = includeProblems([
      { name: 'a', held: [{ block: 'panel', name: 'b' }] },
      { name: 'b', held: [{ block: 'panel', name: 'c' }] },
      { name: 'c', held: [{ block: 'panel', name: 'a' }] },
    ]);
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.some((p) => p.problem.includes('a → b → c → a'))).toBe(true);
  });

  it('a panel that includes itself is a cycle, not a stack overflow', () => {
    const problems = includeProblems([
      { name: 'sheet', held: [{ block: 'panel', name: 'sheet' }] },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain('includes it back');
  });

  it('resolves the name against the MERGE, case-insensitively', () => {
    expect(
      includeProblems([
        { name: 'Seat', held: [{ block: 'panel', name: 'VITALS' }] },
        { name: 'vitals', held: [] },
      ]),
    ).toEqual([]);
  });
});

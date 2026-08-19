import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedPanels, sweepPanels } from './panels-shelf.ts';
import { STANDARD_PANELS } from './panels.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teller-panels-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('seedPanels — seed-if-absent, the seedSystems posture for files', () => {
  it('writes every standard panel to its own folder, each with a minted pan_ id', () => {
    seedPanels(dir);
    for (const panel of STANDARD_PANELS) {
      const path = join(dir, 'panels', panel.name, 'panel.json');
      const written = JSON.parse(readFileSync(path, 'utf8'));
      expect(written.name).toBe(panel.name);
      expect(written.id).toMatch(/^pan_[0-9a-f]{12}$/);
    }
  });

  it('never touches a folder that already exists — an edit survives every boot', () => {
    seedPanels(dir);
    const path = join(dir, 'panels', 'sheet', 'panel.json');
    const before = JSON.parse(readFileSync(path, 'utf8'));
    const edited = { ...before, label: 'House Sheet' };
    writeFileSync(path, JSON.stringify(edited));

    seedPanels(dir); // a second boot

    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.label).toBe('House Sheet');
    expect(after.id).toBe(before.id);
  });

  it('mints a stable id once — reseeding a fresh host does not remint an existing panel', () => {
    seedPanels(dir);
    const id1 = JSON.parse(
      readFileSync(join(dir, 'panels', 'bare', 'panel.json'), 'utf8'),
    ).id;
    seedPanels(dir);
    const id2 = JSON.parse(
      readFileSync(join(dir, 'panels', 'bare', 'panel.json'), 'utf8'),
    ).id;
    expect(id2).toBe(id1);
  });
});

describe('sweepPanels — reads and reports, writes nothing (like discoverPlugins)', () => {
  it('no panels folder yet is just an empty shelf', () => {
    expect(sweepPanels(dir)).toEqual({ panels: [], problems: [] });
  });

  it('reads every panel folder seeded, whole', () => {
    seedPanels(dir);
    const { panels, problems } = sweepPanels(dir);
    expect(problems).toEqual([]);
    expect(panels.map((p) => p.name).sort()).toEqual(
      [...STANDARD_PANELS.map((p) => p.name)].sort(),
    );
  });

  it('a swept panel carries the edit — the file on disk wins', () => {
    seedPanels(dir);
    const path = join(dir, 'panels', 'sheet', 'panel.json');
    const before = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...before, label: 'House Sheet' }));

    const { panels } = sweepPanels(dir);
    const sheet = panels.find((p) => p.name === 'sheet');
    expect(sheet?.label).toBe('House Sheet');
  });

  it('a duplicated folder just works — another file in the collection', () => {
    seedPanels(dir);
    const sheet = JSON.parse(
      readFileSync(join(dir, 'panels', 'sheet', 'panel.json'), 'utf8'),
    );
    const dupDir = join(dir, 'panels', 'my-sheet');
    mkdirSync(dupDir, { recursive: true });
    writeFileSync(
      join(dupDir, 'panel.json'),
      JSON.stringify({ ...sheet, name: 'my-sheet', label: 'My Sheet' }),
    );

    const { panels } = sweepPanels(dir);
    expect(panels.some((p) => p.name === 'my-sheet' && p.label === 'My Sheet')).toBe(
      true,
    );
    // The original is untouched — duplicating didn't rename it away.
    expect(panels.some((p) => p.name === 'sheet')).toBe(true);
  });

  it('a broken panel.json degrades — reported, never a crash, rest of the shelf loads', () => {
    seedPanels(dir);
    const brokenDir = join(dir, 'panels', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'panel.json'), '{ not json');

    const emptyNameDir = join(dir, 'panels', 'empty-name');
    mkdirSync(emptyNameDir, { recursive: true });
    writeFileSync(join(emptyNameDir, 'panel.json'), JSON.stringify({ label: 'No name' }));

    const { panels, problems } = sweepPanels(dir);
    expect(panels.length).toBe(STANDARD_PANELS.length);
    expect(problems).toHaveLength(2);
    expect(problems.map((p) => p.problem)).toEqual([
      'panel.json is not a panel (needs a name)',
      'panel.json is not a panel (needs a name)',
    ]);
    expect(problems.map((p) => p.dir).sort()).toEqual([brokenDir, emptyNameDir].sort());
  });
});

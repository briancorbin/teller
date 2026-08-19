import { mkdirSync, mkdtempSync, readFileSync, statSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShelf, type Shelf } from './store.ts';
import { panelDir, seedPanels, sweepPanels } from './panels-shelf.ts';
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
    const path = join(dir, 'panels', 'shelf', 'panel.json');
    const before = JSON.parse(readFileSync(path, 'utf8'));
    const edited = { ...before, label: 'House Shelf' };
    writeFileSync(path, JSON.stringify(edited));

    seedPanels(dir); // a second boot

    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.label).toBe('House Shelf');
    expect(after.id).toBe(before.id);
  });

  it('mints a stable id once — reseeding a fresh host does not remint an existing panel', () => {
    seedPanels(dir);
    const id1 = JSON.parse(
      readFileSync(join(dir, 'panels', 'boards', 'panel.json'), 'utf8'),
    ).id;
    seedPanels(dir);
    const id2 = JSON.parse(
      readFileSync(join(dir, 'panels', 'boards', 'panel.json'), 'utf8'),
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
    const path = join(dir, 'panels', 'shelf', 'panel.json');
    const before = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...before, label: 'House Shelf' }));

    const { panels } = sweepPanels(dir);
    const shelfPanel = panels.find((p) => p.name === 'shelf');
    expect(shelfPanel?.label).toBe('House Shelf');
  });

  it('a duplicated folder just works — another file in the collection', () => {
    seedPanels(dir);
    const boards = JSON.parse(
      readFileSync(join(dir, 'panels', 'boards', 'panel.json'), 'utf8'),
    );
    const dupDir = join(dir, 'panels', 'my-boards');
    mkdirSync(dupDir, { recursive: true });
    writeFileSync(
      join(dupDir, 'panel.json'),
      JSON.stringify({ ...boards, name: 'my-boards', label: 'My Boards' }),
    );

    const { panels } = sweepPanels(dir);
    expect(panels.some((p) => p.name === 'my-boards' && p.label === 'My Boards')).toBe(
      true,
    );
    // The original is untouched — duplicating didn't rename it away.
    expect(panels.some((p) => p.name === 'boards')).toBe(true);
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

describe('sweepPanels — the code ladder (§E UN-DEFERRED, rungs 3-5)', () => {
  let shelf: Shelf;

  beforeEach(() => {
    shelf = openShelf(dir);
  });

  afterEach(() => {
    shelf.close();
  });

  function writeBlockPanel(name: string, id: string, source: string) {
    const panelDirPath = join(dir, 'panels', name);
    mkdirSync(join(panelDirPath, 'blocks'), { recursive: true });
    writeFileSync(
      join(panelDirPath, 'panel.json'),
      JSON.stringify({ name, id, subject: 'none', mounted: [], held: [] }),
    );
    writeFileSync(join(panelDirPath, 'blocks', 'Widget.tsx'), source);
    return panelDirPath;
  }

  const VALID_BLOCK = `export default function Widget() { return null; }\n`;

  it('compiles a block to .build and the loaded PanelDef carries code.blocks once trusted', () => {
    writeBlockPanel('my-widget', 'pan_widget1', VALID_BLOCK);
    shelf.setPluginEnabled('pan_widget1', true);

    const { panels, problems } = sweepPanels(dir, shelf);
    expect(problems).toEqual([]);
    const panel = panels.find((p) => p.name === 'my-widget');
    expect(panel?.codePending).toBeUndefined();
    expect(panel?.code?.blocks?.Widget).toBe('/panel-code/pan_widget1/blocks/Widget.js');

    const built = readFileSync(
      join(dir, 'panels', 'my-widget', '.build', 'blocks', 'Widget.js'),
      'utf8',
    );
    expect(built).toContain('Widget');
  });

  it('an untrusted code-carrying panel gets codePending instead of code', () => {
    writeBlockPanel('untrusted-widget', 'pan_widget2', VALID_BLOCK);
    // No trust row written — the sweep discovers, only a human enables.

    const { panels } = sweepPanels(dir, shelf);
    const panel = panels.find((p) => p.name === 'untrusted-widget');
    expect(panel?.code).toBeUndefined();
    expect(panel?.codePending).toBe(true);
  });

  it('a syntax-error block lands in problems, and the declaration still loads', () => {
    writeBlockPanel('broken-widget', 'pan_widget3', 'export default function( {{{ broken');
    shelf.setPluginEnabled('pan_widget3', true);

    const { panels, problems } = sweepPanels(dir, shelf);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].dir).toBe(join(dir, 'panels', 'broken-widget'));
    const panel = panels.find((p) => p.name === 'broken-widget');
    expect(panel).toBeDefined();
    expect(panel?.code).toBeUndefined();
  });

  it('mtime skip — a second sweep does not recompile an unchanged source', () => {
    writeBlockPanel('cached-widget', 'pan_widget4', VALID_BLOCK);
    shelf.setPluginEnabled('pan_widget4', true);

    sweepPanels(dir, shelf);
    const outPath = join(dir, 'panels', 'cached-widget', '.build', 'blocks', 'Widget.js');
    const firstBuild = statSync(outPath).mtimeMs;

    // Push the output's mtime into the future — if the sweep rebuilds
    // unconditionally, it will stomp this back down to "now".
    const future = new Date(Date.now() + 60_000);
    utimesSync(outPath, future, future);

    sweepPanels(dir, shelf);
    const secondBuild = statSync(outPath).mtimeMs;
    expect(secondBuild).toBe(future.getTime());
    expect(secondBuild).not.toBe(firstBuild);
  });

  it('style.css passes through untouched', () => {
    const name = 'styled-widget';
    const id = 'pan_widget5';
    const panelDirPath = join(dir, 'panels', name);
    mkdirSync(panelDirPath, { recursive: true });
    writeFileSync(
      join(panelDirPath, 'panel.json'),
      JSON.stringify({ name, id, subject: 'none', mounted: [], held: [] }),
    );
    writeFileSync(join(panelDirPath, 'style.css'), '.widget { color: red; }\n');
    shelf.setPluginEnabled(id, true);

    const { panels } = sweepPanels(dir, shelf);
    const panel = panels.find((p) => p.name === name);
    expect(panel?.code?.style).toBe(`/panel-code/${id}/style.css`);
    const copied = readFileSync(join(panelDirPath, '.build', 'style.css'), 'utf8');
    expect(copied).toBe('.widget { color: red; }\n');
  });

  it("seedPanels-origin panels are trusted implicitly, if they carry code", () => {
    // Simulate a standard panel authored WITH a block, as if teller
    // shipped one, and confirm the seed-time trust write lets its code
    // through with no separate enable step.
    const seedDir = join(dir, 'panels', 'boards');
    seedPanels(dir, shelf);
    mkdirSync(join(seedDir, 'blocks'), { recursive: true });
    writeFileSync(join(seedDir, 'blocks', 'Widget.tsx'), VALID_BLOCK);
    const seededId = JSON.parse(readFileSync(join(seedDir, 'panel.json'), 'utf8')).id;

    const { panels } = sweepPanels(dir, shelf);
    const boards = panels.find((p) => p.name === 'boards');
    expect(boards?.code?.blocks?.Widget).toBe(`/panel-code/${seededId}/blocks/Widget.js`);
  });
});

describe('panelDir — resolving a pan_ id back to its folder', () => {
  it('finds the folder whose panel.json carries this id', () => {
    seedPanels(dir);
    const path = join(dir, 'panels', 'boards', 'panel.json');
    const id = JSON.parse(readFileSync(path, 'utf8')).id;
    expect(panelDir(dir, id)).toBe(join(dir, 'panels', 'boards'));
  });

  it('an unknown id resolves to nothing', () => {
    seedPanels(dir);
    expect(panelDir(dir, 'pan_nope')).toBeUndefined();
  });
});

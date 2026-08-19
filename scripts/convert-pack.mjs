// The first exercise of the new pack format: convert an old-world pack
// folder (fields/counters/tags) and its system row into the new shape
// (lists + declarations) and install both on a new-world shelf.
//
//   node scripts/convert-pack.mjs --pack ~/.teller/packs/wiw-guidebook \
//     --old-db ~/.teller/teller.db --data ~/.teller-next
//
// The script carries ZERO content (rule 4): everything it writes comes
// from files already on this host. Conversion is a port, not a
// redesign — a field that was one text blob stays one text entry; what
// has no consumer yet rides along unchanged under its old key.
//
// The mechanical mappings, and why:
//   * counters {current, max}       → entries {value, max}   (resources)
//   * skill fields (system groups)  → entries in `skills`
//   * short stat fields             → entries in `stats`
//   * long text fields              → entries in `traits` — one each,
//     so no mechanic hides appended to another's string
//   * description/behavior          → notes (prose is prose)
//   * statuses meta (stack/cap/uncapped) → a KIND declaration for
//     `conditions` — the discriminator the rebuild was for: zero
//     clears, the cap presented never enforced; a per-status exception
//     (uncapped) rides on that status's own declaration.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { openShelf } from '../core/store.ts';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const untilde = (p) => resolve((p ?? '').replace(/^~/, homedir()));
const packDir = untilde(args.pack ?? join(homedir(), '.teller/packs/wiw-guidebook'));
const oldDb = untilde(args['old-db'] ?? join(homedir(), '.teller/teller.db'));
const dataDir = untilde(args.data ?? join(homedir(), '.teller-next'));

const readJson = (name) => {
  const path = join(packDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};

const num = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v);

// ---------------------------------------------------------------- system

const pack = readJson('pack.json');
if (!pack) {
  console.error(`${packDir} has no pack.json`);
  process.exit(1);
}

const db = new DatabaseSync(oldDb, { readOnly: true });
const sysRow = db
  .prepare('SELECT name, version, data FROM systems WHERE system = ?')
  .get(String(pack.system));
if (!sysRow) {
  console.error(`old db has no system '${pack.system}'`);
  process.exit(1);
}
const oldSys = JSON.parse(String(sysRow.data));
const systemId = `sys_${pack.system}`;

const skillKeys = new Set(oldSys.groups?.skills ?? []);
const conditionsWord = oldSys.vocabulary?.conditions;

// Statuses: named declarations, extras (relief, effect) riding along.
const statuses = (oldSys.statuses?.list ?? []).map((s) => ({
  ...s,
  ...(oldSys.statuses?.uncapped?.includes(s.name) ? { uncapped: true } : {}),
}));

// The statuses META becomes the kind declaration for `conditions`.
const kinds = [
  {
    name: 'conditions',
    ...(conditionsWord ? { label: conditionsWord } : {}),
    domain: {
      kind: 'count',
      zero: 'clears',
      ...(typeof oldSys.statuses?.cap === 'number' ? { cap: oldSys.statuses.cap } : {}),
    },
  },
  { name: 'skills', domain: { kind: 'text' } },
];

// Old sheet defaults (character/npc starting kits) → lists shape.
function sheetOf(old) {
  if (!old) return undefined;
  const lists = {};
  const skills = (old.fields ?? []).filter((f) => skillKeys.has(f.key));
  const stats = (old.fields ?? []).filter((f) => !skillKeys.has(f.key));
  if (skills.length) lists.skills = skills.map((f) => ({ name: f.label }));
  if (stats.length) lists.stats = stats.map((f) => ({ name: f.label }));
  const resources = (old.counters ?? []).map((c) => {
    const entry = { name: c.name };
    if (typeof c.current === 'number') entry.value = c.current;
    else if (typeof c.max === 'number') entry.value = c.max;
    if (typeof c.max === 'number') entry.max = c.max;
    return entry;
  });
  if (resources.length) lists.resources = resources;
  return { lists };
}

const systemData = {
  statuses,
  kinds,
  sheets: {
    ...(sheetOf(oldSys.character) ? { character: sheetOf(oldSys.character) } : {}),
    ...(sheetOf(oldSys.npc) ? { npc: sheetOf(oldSys.npc) } : {}),
  },
};
// Everything with no consumer yet rides along unchanged.
for (const key of [
  'space', 'bands', 'reload', 'vocabulary', 'dice', 'groups', 'accents',
  'pins', 'dials', 'screens', 'currency', 'icons', 'marks', 'use', 'store',
  'growth', 'ladders', 'spends', 'initiative',
]) {
  if (oldSys[key] !== undefined) systemData[key] = oldSys[key];
}

// ---------------------------------------------------------------- pack

const LONG_FIELDS = new Set(['attacks', 'features', 'trophies', 'tolerances', 'frenzy']);
const PROSE_FIELDS = new Set(['description', 'behavior']);

function creatureOf(old) {
  const lists = {};
  const notes = [];
  const skills = [];
  const stats = [];
  const traits = [];
  for (const f of old.fields ?? []) {
    const value = typeof f.value === 'string' ? f.value.trim() : f.value;
    if (value === '' || value === undefined) continue;
    if (PROSE_FIELDS.has(f.key)) notes.push(`${f.label}: ${value}`);
    else if (skillKeys.has(f.key)) skills.push({ name: f.label, value });
    else if (LONG_FIELDS.has(f.key)) traits.push({ name: f.label, value });
    else stats.push({ name: f.label, value: num(value) });
  }
  if (skills.length) lists.skills = skills;
  if (stats.length) lists.stats = stats;
  if (traits.length) lists.traits = traits;
  const resources = (old.counters ?? []).map((c) => {
    const entry = { name: c.name };
    const value = typeof c.current === 'number' ? c.current : c.max;
    if (typeof value === 'number') entry.value = value;
    if (typeof c.max === 'number') entry.max = c.max;
    return entry;
  });
  if (resources.length) lists.resources = resources;
  const out = { id: old.id, name: old.name, type: 'foe', lists };
  if (notes.length) out.notes = notes.join('\n\n');
  if (typeof old.page === 'number') out.page = old.page;
  return out;
}

function itemOf(old) {
  const { id, name, kind, fields, ...rest } = old;
  const lists = {};
  const stats = (fields ?? [])
    .map((f) => ({ name: f.label ?? f.key, value: num(f.value) }))
    .filter((e) => e.value !== '' && e.value !== undefined);
  if (stats.length) lists.stats = stats;
  return { id, name, ...(kind ? { type: kind } : {}), lists, ...rest };
}

const bestiary = (readJson('bestiary.json') ?? []).map(creatureOf);
const oldCatalog = readJson('catalog.json') ?? {};
const catalog = (oldCatalog.items ?? []).map(itemOf);

const packData = { bestiary, catalog };
if (oldCatalog.upgrades) packData.upgrades = oldCatalog.upgrades;
for (const [file, slot] of [
  ['sections.json', 'sections'],
  ['trades.json', 'trades'],
  ['creation.json', 'creation'],
  ['notes.json', 'notes'],
]) {
  const held = readJson(file);
  if (held !== undefined) packData[slot] = held;
}

// ---------------------------------------------------------------- install

const shelf = openShelf(dataDir);
shelf.putSystem({
  id: systemId,
  name: String(sysRow.name),
  version: Number(sysRow.version) || 1,
  data: systemData,
});
shelf.putPack({
  id: String(pack.id),
  system: systemId,
  name: String(pack.name),
  version: Number(pack.version) || 1,
  data: packData,
});
shelf.close();

console.log(`system ${systemId} · ${sysRow.name} v${sysRow.version}`);
console.log(`  statuses: ${statuses.length} · kinds: ${kinds.map((k) => k.name).join(', ')}`);
console.log(`pack ${pack.id} · ${pack.name} v${pack.version}`);
console.log(`  bestiary: ${bestiary.length} · catalog: ${catalog.length}`);
for (const [slot, held] of Object.entries(packData)) {
  if (['bestiary', 'catalog'].includes(slot)) continue;
  console.log(`  rides along: ${slot} (${Array.isArray(held) ? held.length + ' items' : 'object'})`);
}
if (existsSync(join(packDir, 'art'))) {
  console.log('  NOTE: art/ not converted — the new world has no art pipeline yet');
}
console.log(`installed onto ${join(dataDir, 'shelf.db')}`);

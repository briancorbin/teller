// The first exercise of the new pack format: convert an old-world pack
// folder (fields/counters/tags) and its system row into the new shape
// (lists + declarations) and write both as a new-world pack FOLDER.
//
//   node scripts/convert-pack.mjs --pack ~/.teller/packs/wiw-guidebook \
//     --old-db ~/.teller/teller.db --data ~/.teller-next
//
// §L phase 1 turned this from an install into an EXPORT. It used to
// write `shelf.db` rows and nothing else, which made the old world's
// pack the authoring copy forever — every WiW vocabulary edit was a
// round trip through here. Now it writes
// `<data>/packs/<name>/` in the folder format (`pack.json`,
// `system.json`, a file per slot, `art/`), and THAT is the authoring
// copy from the run after this one. Run it once per pack, then edit the
// folder and `POST /api/shelf/sweep`.
//
// It still installs the db rows too (`--skip-db` to not). They're
// harmless: `loadCampaign` prefers a folder over a row of the same id,
// so the rows sit shadowed as a fallback for a host that hasn't got the
// folder yet. Nothing reads them once the folder exists.
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

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { openShelf } from '../core/store.ts';
import { newId } from '../core/id.ts';
import { withInstalledArt } from '../core/packs-shelf.ts';

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
// Where the folder lands. Named for the source folder, because a name
// is what a person types; identity is still the id inside (rule 4a).
const outDir = untilde(args.out ?? join(dataDir, 'packs', basename(packDir)));
const skipDb = args['skip-db'] !== undefined;

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

// `attacks` and `tolerances` are STRUCTURED now (§I: attacks are
// entities) — parsed below, never carried as a `traits` blob. Features,
// Trophies and Frenzy are genuinely words and stay prose, one `traits`
// entry each, exactly as before.
const LONG_FIELDS = new Set(['features', 'trophies', 'frenzy']);
const PROSE_FIELDS = new Set(['description', 'behavior']);

// ------------------------------------------------------- attack parsing
//
// §I (docs/CORE-NEXT.md): an attack is a child entity of the foe
// template, not a line of prose. The book prints one field —
//   Melee — Big Foot (3 Grit): 2B2G damage + Dazed [2] · Brutal Fists (2 Grit): 2G damage
// — and this reads it apart ONCE, here, at the boundary, so the
// statblock renderer never parses again (the parse-at-render-time bug
// this doc exists to end). Started from the old world's regex grammar
// (`src/lib/statblock.ts`), extended for AOE and Piercing, which that
// reader never had to structure because it stayed prose there.
//
// All or nothing per creature: if any line or entry in the field
// doesn't fit the grammar, the WHOLE field falls back to prose (never
// a half-structured, half-text statblock) and is logged — degradation
// out loud, never a silent drop.

const BAND_LINE = /^(.+?)\s+—\s+(.+)$/;
const ATTACK_ENTRY = /^(.+?)(\s+\(AOE\))?\s+\((\d+)\s+([A-Za-z]+)\):\s*(.+)$/;
const POOL_DAMAGE = /^((?:\d+[BG])+)\s+damage\b/i;
// A chain item is "Name [severity]" — severity a plain number ("[2]")
// or a full pool, one or more die groups ("[4B]", "[1B1G]") — or a bare
// "Name" with no severity at all (a held tag, "+ Knockback").
const CHAIN_TOKEN = /^([A-Z][A-Za-z'’ -]*?)(?:\s*\[([^\]]+)\])?$/;
const BANDS = ['Melee', 'Short', 'Long'];

/** The "+ Status [n]" / "+ Status" tail after the damage pool (or the whole effect, for a status-only line). */
function parseChain(rest) {
  const trimmed = rest.trim();
  if (!trimmed) return { items: [], ok: true };
  const tokens = trimmed.split(/\s*\+\s*/).filter(Boolean);
  const items = [];
  for (const token of tokens) {
    const m = CHAIN_TOKEN.exec(token.trim());
    if (!m) return { items: [], ok: false };
    const [, name, raw] = m;
    if (raw === undefined) {
      items.push({ name: name.trim() });
    } else {
      const trimmedRaw = raw.trim();
      items.push({ name: name.trim(), value: /^\d+$/.test(trimmedRaw) ? Number(trimmedRaw) : trimmedRaw });
    }
  }
  return { items, ok: true };
}

/** One creature's printed `attacks` field → attack child entities, or `undefined` on any line it can't fit. */
function parseAttacks(field) {
  const out = [];
  for (const line of field.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bandMatch = BAND_LINE.exec(trimmed);
    if (!bandMatch) return undefined;
    const band = bandMatch[1].trim();
    if (!BANDS.includes(band)) return undefined;
    for (const part of bandMatch[2].split(' · ')) {
      const entry = ATTACK_ENTRY.exec(part.trim());
      if (!entry) return undefined;
      const [, rawName, aoe, cost, unit, effectRaw] = entry;
      if (unit.trim().toLowerCase() !== 'grit') return undefined;
      const effect = effectRaw.trim();
      const poolMatch = POOL_DAMAGE.exec(effect);
      const damage = poolMatch ? poolMatch[1] : undefined;
      const rest = poolMatch ? effect.slice(poolMatch[0].length) : effect;
      const { items, ok } = parseChain(rest);
      if (!ok) return undefined;
      const piercing = items.find((i) => i.name.toLowerCase() === 'piercing');
      const inflicts = items.filter((i) => i !== piercing);
      const profile = [
        { name: 'Band', value: band },
        { name: 'Cost', value: Number(cost) },
      ];
      if (damage) profile.push({ name: 'Damage', value: damage });
      if (aoe) profile.push({ name: 'AOE' });
      if (piercing) {
        profile.push(
          piercing.value === undefined
            ? { name: 'Piercing' }
            : { name: 'Piercing', value: piercing.value },
        );
      }
      out.push({
        id: newId('atk'),
        name: rawName.trim(),
        type: 'attack',
        lists: { profile, inflicts },
      });
    }
  }
  return out;
}

/** The printed `Tolerances` field → a plain list of entries (§I) — "None" prints as none at all. */
function parseTolerances(field) {
  const text = field.trim();
  if (!text || /^none$/i.test(text)) return [];
  const out = [];
  for (const part of text.split(',')) {
    const m = /^(.+?)\s*\[([^\]]+)\]\s*$/.exec(part.trim());
    if (!m) return undefined;
    const [, name, raw] = m;
    const trimmedRaw = raw.trim();
    out.push({ name: name.trim(), value: /^\d+$/.test(trimmedRaw) ? Number(trimmedRaw) : trimmedRaw });
  }
  return out;
}

const parseStats = {
  attacks: { parsed: 0, fellBack: 0 },
  tolerances: { parsed: 0, fellBack: 0 },
  marks: 0,
};

// A Talent used to hide behind a prefix on a tag string ("Talent:
// Rifles") — the recurring bug rule 4 names. The prefix itself is
// system data (`oldSys.marks.prefix`), never hardcoded here; a tag
// wearing it becomes a bare `marks` entry (name = category, no value)
// and the prefixed tag is dropped, not carried forward alongside it.
const marksPrefix = oldSys.marks?.prefix;

function creatureOf(old) {
  const lists = {};
  const notes = [];
  const skills = [];
  const stats = [];
  const traits = [];
  const children = [];
  const marks = [];
  for (const t of old.tags ?? []) {
    const name = typeof t.name === 'string' ? t.name : undefined;
    if (marksPrefix && name?.startsWith(marksPrefix)) {
      marks.push({ name: name.slice(marksPrefix.length).trim() });
      parseStats.marks++;
    }
    // Non-Talent tags have no consumer yet and stay unconverted, same
    // as before this change — only the Talent-prefixed shape hid a
    // mechanic (rule 4) and needed a structured home.
  }
  if (marks.length) lists.marks = marks;
  for (const f of old.fields ?? []) {
    const value = typeof f.value === 'string' ? f.value.trim() : f.value;
    if (value === '' || value === undefined) continue;
    if (f.key === 'attacks') {
      const attacks = parseAttacks(value);
      if (attacks) {
        parseStats.attacks.parsed++;
        children.push(...attacks);
      } else {
        parseStats.attacks.fellBack++;
        console.log(`  attacks didn't parse cleanly for ${old.name} — kept as prose`);
        traits.push({ name: f.label, value });
      }
    } else if (f.key === 'tolerances') {
      const tolerances = parseTolerances(value);
      if (tolerances) {
        parseStats.tolerances.parsed++;
        if (tolerances.length) lists.tolerances = tolerances;
      } else {
        parseStats.tolerances.fellBack++;
        console.log(`  tolerances didn't parse cleanly for ${old.name} — kept as prose`);
        traits.push({ name: f.label, value });
      }
    } else if (PROSE_FIELDS.has(f.key)) notes.push(`${f.label}: ${value}`);
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
  if (children.length) out.children = children;
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

// -- art: a pack carries its pictures (rule 4a). The blob assembled
// here keeps art RELATIVE (`art/logo.png`), because that is what a
// pack folder holds; the sweep rewrites it to `art/<pak_id>/…` at
// install, and the db path below does the same rewrite by hand.
const artDir = join(packDir, 'art');
const hasArt = existsSync(artDir);
const installedArt = (rel) => `art/${String(rel).replace(/^art\//, '')}`;

const brand = {};
const portraits = {};
if (hasArt) {
  // A file named logo.* anywhere in the pack's art is the brand mark.
  const findLogo = (dir, rel = '') => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(path).isDirectory()) {
        const hit = findLogo(path, relPath);
        if (hit) return hit;
      } else if (/^logo\./i.test(name)) {
        return relPath;
      }
    }
    return undefined;
  };
  const logo = findLogo(artDir);
  if (logo) brand.logo = `art/${logo}`;
  for (const trade of readJson('trades.json') ?? []) {
    if (trade.name && trade.art) portraits[trade.name] = installedArt(trade.art);
  }
}

const packData = { bestiary, catalog };
if (Object.keys(brand).length) packData.brand = brand;
if (Object.keys(portraits).length) packData.portraits = portraits;
if (oldCatalog.upgrades) packData.upgrades = oldCatalog.upgrades;

// `sections` is the mid-game lookup text — a declarations-style slot
// (merged by NAME, later wins, same as `statuses`), so a campaign can
// override one section wholesale by restating its title. The old file
// keys each section by `title`; the new shape wants `name`, the field
// every declaration merges on (`Loaded#declarations`).
const oldSections = readJson('sections.json');
if (Array.isArray(oldSections)) {
  packData.sections = oldSections.map(({ title, ...rest }) => ({ name: title, ...rest }));
}

for (const [file, slot] of [
  ['trades.json', 'trades'],
  ['creation.json', 'creation'],
  ['notes.json', 'notes'],
]) {
  const held = readJson(file);
  if (held !== undefined) packData[slot] = held;
}

// ----------------------------------------------------------- export folder
//
// The serialization rule, and the whole of it: `pack.json` and
// `system.json` carry identity, and every other key of the blob becomes
// `<slot>.json`. The system's records stay INLINE in `system.json`
// because they're read and edited together (see `core/packs-shelf.ts`).

const written = [];
const writeJson = (name, value) => {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  written.push(name);
};

mkdirSync(outDir, { recursive: true });
writeJson('pack.json', {
  id: String(pack.id),
  system: systemId,
  name: String(pack.name),
  version: Number(pack.version) || 1,
  ...(pack.rights ? { rights: pack.rights } : {}),
  ...(pack.books ? { books: pack.books } : {}),
});
writeJson('system.json', {
  id: systemId,
  name: String(sysRow.name),
  version: Number(sysRow.version) || 1,
  ...systemData,
});
for (const [slot, held] of Object.entries(packData)) writeJson(`${slot}.json`, held);
if (hasArt) cpSync(artDir, join(outDir, 'art'), { recursive: true });

// ------------------------------------------------------- install (shadowed)

if (!skipDb) {
  // The rows the folder now supersedes. Art references have to be the
  // INSTALLED keys here, because a row has no folder to be relative to.
  if (hasArt) cpSync(artDir, join(dataDir, 'art', String(pack.id)), { recursive: true });
  const shelf = openShelf(dataDir);
  shelf.putSystem({
    id: systemId,
    name: String(sysRow.name),
    version: Number(sysRow.version) || 1,
    data: withInstalledArt(systemData, String(pack.id)),
  });
  shelf.putPack({
    id: String(pack.id),
    system: systemId,
    name: String(pack.name),
    version: Number(pack.version) || 1,
    data: withInstalledArt(packData, String(pack.id)),
  });
  shelf.close();
}

console.log(`system ${systemId} · ${sysRow.name} v${sysRow.version}`);
console.log(`  statuses: ${statuses.length} · kinds: ${kinds.map((k) => k.name).join(', ')}`);
console.log(`pack ${pack.id} · ${pack.name} v${pack.version}`);
console.log(`  bestiary: ${bestiary.length} · catalog: ${catalog.length}`);
console.log(
  `  attacks parsed: ${parseStats.attacks.parsed}/${parseStats.attacks.parsed + parseStats.attacks.fellBack}` +
    (parseStats.attacks.fellBack ? ` (${parseStats.attacks.fellBack} fell back to prose, see above)` : ''),
);
console.log(
  `  tolerances parsed: ${parseStats.tolerances.parsed}/${parseStats.tolerances.parsed + parseStats.tolerances.fellBack}` +
    (parseStats.tolerances.fellBack ? ` (${parseStats.tolerances.fellBack} fell back to prose, see above)` : ''),
);
console.log(`  Talent tags converted to marks: ${parseStats.marks}`);
for (const [slot, held] of Object.entries(packData)) {
  if (['bestiary', 'catalog'].includes(slot)) continue;
  console.log(`  rides along: ${slot} (${Array.isArray(held) ? held.length + ' items' : 'object'})`);
}
if (hasArt) {
  console.log(
    `  art copied into the folder, relative` +
      `${brand.logo ? ' · brand logo found' : ''}` +
      `${Object.keys(portraits).length ? ` · ${Object.keys(portraits).length} portraits` : ''}`,
  );
}
console.log(`folder written to ${outDir}`);
console.log(`  ${written.join(' · ')}${hasArt ? ' · art/' : ''}`);
console.log(
  skipDb
    ? '  (db rows not written — the folder is the only copy)'
    : `  shadow rows also written to ${join(dataDir, 'shelf.db')} — the folder wins`,
);
console.log('edit the folder, then POST /api/shelf/sweep');

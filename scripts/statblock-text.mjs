// Reading a printed statblock apart, ONCE, at the boundary.
//
// A book sets a creature's features as one paragraph per line —
//
//   Fast Swimmer. If taking the Move Action while in water, …
//   Harden Shell. During its Frenzy, the turtle's shell …
//
// — which reads fine in a book and terribly in a column, where three
// named abilities collapse into one grey wall. Worse, it's the
// recurring bug this codebase has a name for: a mechanic hiding in a
// text field. A Frenzy's THRESHOLD ("Guillotine (30 Health)") is the
// number that decides whether the Warden may press it, and it was
// living inside a sentence.
//
// So the split happens here, at conversion, and the statblock renderer
// never parses again. Everything is all-or-nothing per field: a field
// that doesn't fit the grammar comes back `undefined` and the caller
// keeps the old shape and says so out loud — half a structured
// statblock is worse than an honest prose one.
//
// The grammar was not invented: it's the old world's own reader
// (`src/lib/statblock.ts`), which had to parse at RENDER time because
// the data never held the parts.

import { newId } from '../core/id.ts';

// -------------------------------------------------------------- blocks

/** "Fast Swimmer. If taking the Move Action…" — a name, then its words. */
const NAMED = /^([A-Z][^.]{0,60})\.\s+(\S[\s\S]*)$/;
/** "Guillotine (30 Health)" — the number a name gates itself behind. */
const GATE = /^(.*?)\s*\((\d+)\s+([A-Za-z][A-Za-z ]*)\)\s*$/;

/**
 * A printed field that is really a LIST of named things, split back
 * into its parts. A line that announces no name keeps its text.
 */
export function namedBlocks(field) {
  const out = [];
  for (const line of String(field ?? '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    const m = NAMED.exec(text);
    out.push(m ? { name: m[1].trim(), text: m[2].trim() } : { text });
  }
  return out;
}

/**
 * A block's name split from the counter it watches — `{ name, gate }`,
 * the gate an ordinary entry (`{ name: 'Health', value: 30 }`) because
 * that is exactly what it is: a named counter at a number. Which
 * counter is DATA, read off the author's own notation; nothing here
 * knows what Health is (rule 2).
 */
export function parseGate(name) {
  const m = GATE.exec(String(name ?? '').trim());
  if (!m) return { name: String(name ?? '').trim() };
  return { name: m[1].trim(), gate: { name: m[3].trim(), value: Number(m[2]) } };
}

/**
 * A `Features` or `Trophies` field → one entry per named thing, the
 * prose as the entry's value. `undefined` if any line doesn't announce
 * a name — the caller keeps the blob and reports it.
 */
export function namedEntries(field) {
  const blocks = namedBlocks(field);
  if (!blocks.length) return [];
  if (blocks.some((b) => !b.name)) return undefined;
  return blocks.map((b) => ({ name: b.name, value: b.text }));
}

/**
 * A `Frenzy` field → child entities, one per named ability.
 *
 * A frenzy is a name, a threshold, the counter that threshold watches,
 * and a paragraph — four things, which is one more than a leaf
 * (`Entry` is a name, a value and a ceiling, and anything richer was an
 * entity all along). So it takes the shape an attack already takes: a
 * child with `type` and a `gate` list, its words in `notes`. The
 * alternative — prose in `value`, the number in `max` — had nowhere to
 * put "Health" but the renderer, which is a game concept in code.
 *
 * `undefined` if a line doesn't announce a name. A frenzy with no
 * printed threshold is kept, ungated: the words are still the ability.
 */
export function frenzyChildren(field, idFor = () => newId('frz')) {
  const blocks = namedBlocks(field);
  if (!blocks.length) return [];
  if (blocks.some((b) => !b.name)) return undefined;
  return blocks.map((b) => {
    const { name, gate } = parseGate(b.name);
    return {
      id: idFor(name),
      name,
      type: 'frenzy',
      ...(gate ? { lists: { gate: [gate] } } : { lists: {} }),
      notes: b.text,
    };
  });
}

/**
 * Old-shape notes ("Description: …\n\nBehavior: …") → an `about` list
 * plus whatever else was in there.
 *
 * The prefixes were a heading pretending to be prose: two labelled
 * sections the book prints separately, glued into one field with a
 * colon holding them apart. Anything that ISN'T one of the named
 * labels is a table's own note and survives untouched — notes are the
 * one place a human writes freely and nothing may eat that.
 */
export function aboutFromNotes(notes, labels = ['Description', 'Behavior']) {
  const about = [];
  const kept = [];
  for (const part of String(notes ?? '').split(/\n{2,}/)) {
    const text = part.trim();
    if (!text) continue;
    const label = labels.find((l) =>
      text.toLowerCase().startsWith(`${l.toLowerCase()}:`),
    );
    if (label) about.push({ name: label, value: text.slice(label.length + 1).trim() });
    else kept.push(text);
  }
  return { about, notes: kept.join('\n\n') };
}

// ------------------------------------------------------------- attacks
//
// An attack is an entity, not a line of prose (§I). The book prints one
// field —
//   Melee — Big Foot (3 Grit): 2B2G damage + Dazed [2] · Brutal Fists (2 Grit): 2G damage
// — and this reads it apart. Started from the old world's regex
// grammar, extended for AOE and Piercing, which that reader never had
// to structure because it stayed prose there.

const BAND_LINE = /^(.+?)\s+—\s+(.+)$/;
const ATTACK_ENTRY = /^(.+?)(\s+\(AOE\))?\s+\((\d+)\s+([A-Za-z]+)\):\s*(.+)$/;
const POOL_DAMAGE = /^((?:\d+[BG])+)\s+damage\b/i;
// A chain item is "Name [severity]" — severity a plain number ("[2]")
// or a full pool, one or more die groups ("[4B]", "[1B1G]") — or a bare
// "Name" with no severity at all (a held tag, "+ Knockback").
const CHAIN_TOKEN = /^([A-Z][A-Za-z'’ -]*?)(?:\s*\[([^\]]+)\])?$/;
const BANDS = ['Melee', 'Short', 'Long'];

const numeric = (raw) => (/^\d+$/.test(raw) ? Number(raw) : raw);

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
    if (raw === undefined) items.push({ name: name.trim() });
    else items.push({ name: name.trim(), value: numeric(raw.trim()) });
  }
  return { items, ok: true };
}

/** One creature's printed `attacks` field → attack child entities, or `undefined` on any line it can't fit. */
export function parseAttacks(field, idFor = () => newId('atk')) {
  const out = [];
  for (const line of String(field ?? '').split('\n')) {
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
        id: idFor(rawName.trim()),
        name: rawName.trim(),
        type: 'attack',
        lists: { profile, inflicts },
      });
    }
  }
  return out;
}

/** The printed `Tolerances` field → a plain list of entries (§I) — "None" prints as none at all. */
export function parseTolerances(field) {
  const text = String(field ?? '').trim();
  if (!text || /^none$/i.test(text)) return [];
  const out = [];
  for (const part of text.split(',')) {
    const m = /^(.+?)\s*\[([^\]]+)\]\s*$/.exec(part.trim());
    if (!m) return undefined;
    out.push({ name: m[1].trim(), value: numeric(m[2].trim()) });
  }
  return out;
}

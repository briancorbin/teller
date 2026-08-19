// The boundary parse, held to the shapes a real book prints.
//
// Every fixture here is invented — a repo test carries nobody's book
// (rule 4) — but the GRAMMAR is the one the WiW pack writes, which is
// the thing that has to keep working when the converter runs again.

import { describe, expect, it } from 'vitest';
import {
  aboutFromNotes,
  frenzyChildren,
  namedBlocks,
  namedEntries,
  parseAttacks,
  parseGate,
  parseTolerances,
} from './statblock-text.mjs';

describe('namedBlocks', () => {
  it('splits a line into its announced name and its words', () => {
    expect(namedBlocks('Quick Step. It moves first.')).toEqual([
      { name: 'Quick Step', text: 'It moves first.' },
    ]);
  });

  it('keeps a line that announces no name', () => {
    expect(namedBlocks('it simply lumbers about')).toEqual([
      { text: 'it simply lumbers about' },
    ]);
  });

  it('reads one block per line, blanks dropped', () => {
    const blocks = namedBlocks('One. First words.\n\nTwo. Second words.');
    expect(blocks.map((b) => b.name)).toEqual(['One', 'Two']);
  });
});

describe('parseGate', () => {
  it('pulls the threshold and the counter it watches out of the name', () => {
    expect(parseGate('Guillotine (30 Health)')).toEqual({
      name: 'Guillotine',
      gate: { name: 'Health', value: 30 },
    });
  });

  it('leaves an ungated name alone', () => {
    expect(parseGate('Guillotine')).toEqual({ name: 'Guillotine' });
  });

  it('does not mistake prose parentheses for a gate', () => {
    expect(parseGate('Second Wind (once a day)')).toEqual({
      name: 'Second Wind (once a day)',
    });
  });
});

describe('namedEntries', () => {
  it('gives every named thing its own entry, prose as the value', () => {
    expect(namedEntries('Alpha. First.\nBeta. Second.')).toEqual([
      { name: 'Alpha', value: 'First.' },
      { name: 'Beta', value: 'Second.' },
    ]);
  });

  it('refuses the whole field when a line announces no name', () => {
    expect(namedEntries('Alpha. First.\nno name here')).toBeUndefined();
  });

  it('an empty field is no entries, not a failure', () => {
    expect(namedEntries('')).toEqual([]);
  });
});

describe('frenzyChildren', () => {
  const ids = () => 'frz_test';

  it('structures the threshold and keeps the words in notes', () => {
    expect(frenzyChildren('Guillotine (30 Health). It bites clean through.', ids)).toEqual([
      {
        id: 'frz_test',
        name: 'Guillotine',
        type: 'frenzy',
        lists: { gate: [{ name: 'Health', value: 30 }] },
        notes: 'It bites clean through.',
      },
    ]);
  });

  it('keeps an ungated frenzy — the words are still the ability', () => {
    const [only] = frenzyChildren('Last Stand. It stops running.', ids);
    expect(only.lists).toEqual({});
    expect(only.notes).toBe('It stops running.');
  });

  it('refuses the whole field when a line announces no name', () => {
    expect(frenzyChildren('it thrashes wildly', ids)).toBeUndefined();
  });
});

describe('aboutFromNotes', () => {
  it('lifts the labelled sections out of the prefixed blob', () => {
    const { about, notes } = aboutFromNotes(
      'Description: a big one.\n\nBehavior: it waits.',
    );
    expect(about).toEqual([
      { name: 'Description', value: 'a big one.' },
      { name: 'Behavior', value: 'it waits.' },
    ]);
    expect(notes).toBe('');
  });

  it("leaves a table's own note alone", () => {
    const { about, notes } = aboutFromNotes(
      'Description: a big one.\n\nBrian rules it swims at Fast.',
    );
    expect(about).toHaveLength(1);
    expect(notes).toBe('Brian rules it swims at Fast.');
  });

  it('nothing labelled is nothing lifted', () => {
    expect(aboutFromNotes('just a note')).toEqual({
      about: [],
      notes: 'just a note',
    });
  });
});

describe('parseAttacks', () => {
  const ids = (name) => `atk_${name.toLowerCase().replace(/\W+/g, '_')}`;

  it('reads a band line into its attacks', () => {
    expect(
      parseAttacks('Melee — Bite (3 Grit): 2B2G damage + Dazed [2]', ids),
    ).toEqual([
      {
        id: 'atk_bite',
        name: 'Bite',
        type: 'attack',
        lists: {
          profile: [
            { name: 'Band', value: 'Melee' },
            { name: 'Cost', value: 3 },
            { name: 'Damage', value: '2B2G' },
          ],
          inflicts: [{ name: 'Dazed', value: 2 }],
        },
      },
    ]);
  });

  it('marks AOE and lifts Piercing out of the chain', () => {
    const [attack] = parseAttacks('Long — Wail (4 Grit): 1B damage + Piercing + Afraid [2B]', ids);
    expect(attack.lists.profile).toContainEqual({ name: 'Piercing' });
    expect(attack.lists.inflicts).toEqual([{ name: 'Afraid', value: '2B' }]);
  });

  it('refuses a line that names no band', () => {
    expect(parseAttacks('Bite (3 Grit): 2B damage', ids)).toBeUndefined();
  });
});

describe('parseTolerances', () => {
  it('reads each printed severity, number or pool', () => {
    expect(parseTolerances('Sweep [4], Afraid [3G]')).toEqual([
      { name: 'Sweep', value: 4 },
      { name: 'Afraid', value: '3G' },
    ]);
  });

  it('"None" prints as none at all', () => {
    expect(parseTolerances('None')).toEqual([]);
  });

  it('refuses a part with no printed severity', () => {
    expect(parseTolerances('Sweep [4], Afraid')).toBeUndefined();
  });
});

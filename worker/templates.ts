import type { SystemTemplate } from './types';

// Templates are structure + vocabulary ONLY — never rules text, spell
// descriptions, or stat blocks. That line is load-bearing (IP + the
// community-template future). See CLAUDE.md.

const dnd5e: SystemTemplate = {
  system: 'dnd5e',
  version: 1,
  name: 'D&D 5e',
  vocabulary: {
    gm: 'DM',
    conditions: 'Conditions',
  },
  character: {
    fields: [
      { key: 'ac', label: 'AC' },
      { key: 'speed', label: 'Speed' },
      { key: 'passivePerception', label: 'Passive Perception' },
    ],
    counters: [
      { name: 'HP', max: null },
      { name: 'Hit Dice', max: null },
    ],
    tags: [],
  },
  campaign: {
    counters: [],
  },
};

// Wild Imaginary West (Boylei Hobby Time / Rune Foundry).
// Sheet structure to be refined from the guidebook as Brian preps the
// campaign — this is a first sketch, and every card is editable after
// creation anyway.
const wiw: SystemTemplate = {
  system: 'wiw',
  version: 1,
  name: 'Wild Imaginary West',
  vocabulary: {
    gm: 'Warden',
    conditions: 'Conditions',
  },
  character: {
    fields: [],
    counters: [
      { name: 'Health', max: null },
      { name: 'Prestige', current: 0, max: null },
    ],
    tags: [],
  },
  campaign: {
    counters: [],
  },
};

export const templates: SystemTemplate[] = [dnd5e, wiw];

export function getTemplate(system: string): SystemTemplate | undefined {
  return templates.find((t) => t.system === system);
}

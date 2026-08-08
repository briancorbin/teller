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
  npc: {
    fields: [
      { key: 'ac', label: 'AC' },
      { key: 'speed', label: 'Speed' },
    ],
    counters: [{ name: 'HP', max: null }],
    tags: [],
  },
  campaign: {
    counters: [],
  },
};

// Wild Imaginary West (Boylei Hobby Time / Rune Foundry).
// Mirrors the official character sheet's tracked state — structure
// only. Skills are dice-pool strings ("3B", "2B+1G"); Defense is the
// sheet's `def` box; Grit is the 6-chamber cylinder; Prestige tracks
// Total and Unclaimed separately; Wallet/Scrap/Supplies come from the
// Inventory panel. Statuses (Afraid, Burned, Dazed, Electrocuted,
// Poisoned, Trapped, Unconscious) are applied in play as tags.
// Abilities/Talents/Weapons/Horse/Mech live in notes until they earn
// structure.
const wiw: SystemTemplate = {
  system: 'wiw',
  version: 2,
  name: 'Wild Imaginary West',
  vocabulary: {
    gm: 'Warden',
    conditions: 'Statuses',
  },
  character: {
    fields: [
      { key: 'trade', label: 'Trade' },
      { key: 'charm', label: 'Charm' },
      { key: 'finesse', label: 'Finesse' },
      { key: 'intuition', label: 'Intuition' },
      { key: 'nerve', label: 'Nerve' },
      { key: 'defense', label: 'Defense' },
    ],
    counters: [
      { name: 'Health', max: null },
      { name: 'Grit', current: 6, max: 6 },
      { name: 'Prestige · Total', current: 0, max: null },
      { name: 'Prestige · Unclaimed', current: 0, max: null },
      { name: 'Wallet ($)', current: 0, max: null },
      { name: 'Scrap (pcs)', current: 0, max: null },
      { name: 'Supplies', current: 0, max: null },
    ],
    tags: [],
  },
  // Foe kit mirrors the guidebook's creature stat block anatomy:
  // Health / Defense / Speed / Size, the same four Skill pools (the
  // Warden rolls them), and Grit for attack costs. Statuses land as
  // tags with their Severity in the text ("Afraid 3").
  npc: {
    fields: [
      { key: 'size', label: 'Size' },
      { key: 'defense', label: 'Defense' },
      { key: 'speed', label: 'Speed' },
      { key: 'charm', label: 'Charm' },
      { key: 'finesse', label: 'Finesse' },
      { key: 'intuition', label: 'Intuition' },
      { key: 'nerve', label: 'Nerve' },
    ],
    counters: [
      { name: 'Health', max: null },
      { name: 'Grit', current: 6, max: 6 },
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

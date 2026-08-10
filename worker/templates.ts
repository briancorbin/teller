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
  // Vocabulary + thresholds only — never rules text. teller OFFERS
  // these when a counter crosses; the DM decides (rule 1).
  states: [
    { name: 'Bloodied', effect: 'wound', suggest: { counter: 'HP', atOrBelow: 0.5 } },
    { name: 'Down', effect: 'fade', suggest: { counter: 'HP', atOrBelow: 0 } },
    { name: 'Concentrating', effect: 'mark' },
  ],
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
      // Guidebook, character creation step 5: "Write '10' in the Max
      // box of your Health panel." It is a starting value, not a blank.
      { name: 'Health', current: 10, max: 10 },
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
  // WiW's dice, as data (rule 4). Faces derived from the Guidebook's
  // d6 conversion table — the twelve symbols across both dice are 5 Hit,
  // 2 Ace, 3 Blank, 2 Spur, and Gold has "one more Hit and one less
  // Blank than Black", which forces exactly this split.
  //
  // A Spur is rerolled only by a character with the matching Talent, so
  // it is NOT listed under `reroll`: teller rolls for foes, and foes
  // have no Talents. A player who does simply rolls again and types
  // what they got.
  dice: {
    faces: {
      B: ['hit', 'hit', 'ace', 'blank', 'blank', 'spur'],
      G: ['hit', 'hit', 'hit', 'ace', 'blank', 'spur'],
    },
    values: { hit: 1, ace: 2, blank: 0, spur: 0 },
    unit: 'Hits',
    // Six slots and one past the mark, as printed on the sheet.
    track: 6,
    trackBonus: 1,
  },
  // The sheet's SKILLS panel, exactly. Defense is a pool as well but
  // belongs beside Health; Trade names the character; Speed is a word.
  groups: {
    skills: ['charm', 'finesse', 'intuition', 'nerve'],
    // The field that names the character's role, and picks the theme.
    title: ['trade'],
  },
  // Read out of each pregen sheet's own fill colours, not eyeballed.
  accents: {
    Doctor: '#ff8a28',
    Gunslinger: '#ff4d3e',
    Hunter: '#3b9f43',
    Marshal: '#50a9dc',
    Mechanic: '#f25fad',
    Prospector: '#ff755e',
    Trapper: '#41ada3',
  },
  // The sheet prints Defense inside the HEALTH panel, in its own small
  // box beside the max — so that's where it goes here too.
  pins: {
    Health: ['defense'],
  },
  // Guidebook, Turn Order: "the Warden will ask the players to roll with
  // Finesse to determine turn order. The player with the highest number
  // of Hits will go first."
  initiative: { field: 'finesse', highWins: true },
  states: [
    { name: 'Bloodied', effect: 'wound', suggest: { counter: 'Health', atOrBelow: 0.5 } },
    { name: 'Out of Grit', effect: 'daze', suggest: { counter: 'Grit', atOrBelow: 0 } },
    { name: 'Down', effect: 'fade', suggest: { counter: 'Health', atOrBelow: 0 } },
  ],
};

export const templates: SystemTemplate[] = [dnd5e, wiw];

export function getTemplate(system: string): SystemTemplate | undefined {
  return templates.find((t) => t.system === system);
}

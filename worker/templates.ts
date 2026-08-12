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
    items: 'Equipment',
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
    // What this table calls the things a character carries. The sheet's
    // own heading, and the name of the screen they live on — the same
    // job `conditions` already does for Statuses.
    items: 'Weapons',
  },
  character: {
    fields: [
      { key: 'trade', label: 'Trade' },
      // The paper sheet's second box: whose hand is holding this. A
      // plain field like any other — typed once, edited anywhere fields
      // are — that the header draws beside the character's name.
      { key: 'player', label: 'Player' },
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
      // The Ace-in-the-Hole tally (p. 14): tick an Ace as you roll one
      // in combat; either Ace-in-the-Hole Ability fires at 6 and zeroes
      // it. Rest zeroes it too.
      { name: 'Aces', current: 0, max: 6 },
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
    // The field naming the person at the table, drawn in the header.
    player: ['player'],
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
  // The sheet draws Grit as a revolver cylinder — six numbered chambers
  // — and it is the right control as well as the right picture: you
  // spend Grit a point at a time and it reloads at the top of your turn.
  dials: {
    Grit: 'cylinder',
    // The Ace-in-the-Hole tally, drawn as the poker hand it's named
    // for — the last card sits face-down until the sixth Ace flips it.
    Aces: 'cards',
  },
  // The printed page gives Weapons and Abilities separate real estate;
  // the seat does the same. The Ace-in-the-Hole tally (tick an Ace as
  // you roll one, spend six to fire an Ace-in-the-Hole Ability) sits
  // beside the abilities it unlocks. Ammo POOLS live on Items — a
  // weapon chambers from the character-level pool wherever its items
  // are shown, so Weapons carries `arms` (the chamber select and the
  // Aim reticle) and Items merely counts the rounds.
  screens: [
    { name: 'Weapons', kinds: ['weapon'], arms: true },
    { name: 'Abilities', kinds: ['ability'], counters: ['Aces'] },
    // The junk drawer: ammo by name, and everything nobody claims —
    // gear, traps, whatever a table invents — lands here (`rest`)
    // rather than on the gun rack.
    { name: 'Items', kinds: ['ammo'], rest: true },
  ],
  // Talents (p. 32): 4 Prestige buys a category — a skill, a weapon
  // family, Defense, Mechs, Forstalls — and that category rerolls
  // Spurs. Stored as a tag ("Talent: Rifles"), shown as the printed
  // sheet's ✶ box filling in.
  marks: {
    prefix: 'Talent: ',
    text: 'rerolls Spurs',
    label: 'Talents',
    // The full menu from p. 32, "organized by how they're used": the
    // four Skills; weapons & items; Defense; Mechs; Forstalls.
    categories: [
      'Charm',
      'Finesse',
      'Intuition',
      'Nerve',
      'Rifles',
      'Shotguns',
      'Revolvers',
      'Bows',
      'Melee weapons',
      'Mounted weapons',
      'Explosives',
      'Traps',
      'First Aid',
      'Defense',
      'Mechs',
      'Forstalls',
    ],
  },
  // Firing a weapon costs its Grit and consumes one of whatever special
  // ammo is chambered. Special ammo is a CHARACTER-level pool, fired
  // from any weapon that takes it (Guidebook p. 76; the pregens list it
  // under ITEMS, not under a gun) — so the seat's fire button debits
  // the Grit counter by the weapon's own grit field and decrements the
  // loaded ammo item by one. Regular ammo is untracked, by the book.
  use: {
    costField: 'grit',
    costCounter: 'Grit',
    consumesKind: 'ammo',
    verb: 'Fire',
    // Guidebook p. 41. Aim is a GLOBAL once-per-turn Action, not a
    // property of any weapon — the seat renders one reticle for the
    // screen. (The ✶-and-box printed on each weapon block is NOT Aim:
    // it's the weapon-category Talent marker, p. 32 — tick it when
    // you've bought the Talent and that weapon rerolls Spurs.)
    actions: [
      { name: 'Aim', cost: 1, text: 'Reroll 1 die in your next Attack. Once per turn.' },
    ],
  },
  // Reputation (Guidebook p. 119): per-faction standing on one
  // five-step ladder, modifying Charm rolls with that faction — in the
  // player's hand, never applied by teller. The factions themselves are
  // world content and live in the pack's "Factions" section; this is
  // only the scale. Horse bonds (p. 104) reuse these steps and will be
  // a second entry here when mounts arrive (TEL-72's neighbour).
  ladders: [
    {
      prefix: 'rep_',
      label: 'Reputation',
      section: 'Factions',
      text: 'applies to Charm rolls with that faction',
      steps: [
        { label: 'Hostile', mod: '−2B' },
        { label: 'Suspicious', mod: '−1B' },
        { label: 'Neutral', mod: '+0B' },
        { label: 'Helpful', mod: '+1B' },
        { label: 'Revered', mod: '+2B' },
      ],
      defaultStep: 'Neutral',
    },
  ],
  // The Prestige spend menu (Guidebook p. 32) as proposing macros, and
  // the six tiers (p. 33) as display-only milestones on Total. Costs,
  // limits and tier thresholds are mechanics; the book's descriptions
  // of what each tier FEELS like stay in the book. The stated limits
  // ("up to 5 times") ride in `text` as reminders — counting past
  // purchases would be invisible bookkeeping nobody could correct.
  spends: {
    counter: 'Prestige · Unclaimed',
    total: 'Prestige · Total',
    // The Warden awards into Unclaimed only; spending claims the
    // points across. The book leaves the two-box protocol unwritten,
    // and this way nothing is ever entered twice (the table's ruling,
    // 2026-08-11). Lifetime earned = Total + Unclaimed.
    claims: true,
    label: 'Prestige',
    tiers: [
      { name: 'Tenderfoot', at: 0 },
      { name: 'Cowpoke', at: 10 },
      { name: 'Trailblazer', at: 25 },
      { name: 'Roughrider', at: 50 },
      { name: 'Wrangler', at: 75 },
      { name: 'Legend', at: 100 },
    ],
    menu: [
      {
        name: 'Practice Skill',
        cost: 2,
        text: 'Trade 1B for 1G on a skill of your choice.',
        effect: { kind: 'pool', group: 'skills', op: 'convert', from: 'B', to: 'G', count: 1 },
      },
      {
        name: 'Improve Health',
        cost: 2,
        text: '+1 max Health. Up to five times.',
        effect: { kind: 'max', counter: 'Health', amount: 1 },
      },
      {
        name: 'Develop Talent',
        cost: 4,
        text: 'Reroll Spurs for a whole category.',
        effect: { kind: 'mark' },
      },
      {
        name: 'Unlock Ability',
        cost: 4,
        text: 'One new ability of your choice.',
        effect: { kind: 'item', itemKind: 'ability' },
      },
      {
        name: 'Master Skill',
        cost: 6,
        text: 'Permanently add 1B to a skill. Up to three times.',
        effect: { kind: 'pool', group: 'skills', op: 'add', dice: '1B' },
      },
      {
        name: 'Ace-in-the-Hole 2',
        cost: 6,
        text: 'Your second Ace-in-the-Hole ability.',
        effect: { kind: 'item', itemKind: 'ability' },
      },
    ],
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

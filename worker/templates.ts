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
  // Names only, never rules text. The full condition list is SRD
  // import, which stays deferred — this is the one that isn't a
  // condition anybody publishes, just a thing tables track.
  statuses: { list: [{ name: 'Concentrating', effect: 'mark' }] },
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
  version: 20,
  name: 'Wild Imaginary West',
  // The table's scale, as mechanics (numbers and band names — the
  // book's prose stays in the pack). 6" ≈ 30 yards, so an inch is
  // about 5 yards of world.
  space:
    // The book defines band PAIRS, not a per-inch scale — Arm's Reach
    // (1" = about a yard) breaks the 5-yards-per-inch line that Short
    // and Long imply, so state the table and let the bands do the work.
    'Distance works in RANGE BANDS, each a table-inches to world ' +
    "distance pair: Arm's Reach = within 1 inch (within arm's reach) · " +
    'Short = within 6 inches (up to 30 yards) · Long = 6–18 inches ' +
    '(30–90 yards) · Distant = beyond 18 inches (past 90 yards; takes ' +
    '6 Grit and at least two turns to cross). ' +
    'Attacks are listed by band: Melee attacks require Arm\'s Reach ' +
    '(within 1 inch; melee weapons can also be thrown to Short). SHORT ' +
    'RANGE attacks reach up to 6 inches AND can also be used within ' +
    "Arm's Reach — but not vice versa, and there is no other overlap " +
    'between bands (a Long attack cannot be used at Short, etc). ' +
    'Moving costs Grit by speed (a creature\'s Speed field names its ' +
    "speed): moving within Arm's Reach (1 inch) costs 1 Grit · Normal " +
    '= 1 Grit per Short Range distance (6 inches) · Slow = 2 Grit per ' +
    'Short · Very Slow = 3 Grit per Short · Fast = two Shorts per 1 ' +
    'Grit. ROUGH TERRAIN is a RULING, not a property of ground: the ' +
    'book says the cost doubles "if the Warden determines" something ' +
    'is moving through it, and offers dense forest, a steep ' +
    'mountainside and knee-deep water only as examples — not a list. ' +
    'Whether ground is rough depends on what is crossing it: a ' +
    'creature at home in a terrain is not hindered by it (the book ' +
    'prints creatures that tunnel through sand and scouts who cross ' +
    'mountains unhindered), and may instead be hampered outside it. ' +
    'Grit is the action budget and RELOADS at the start of each ' +
    "creature's turn — spending it all this turn costs nothing next " +
    'turn (an ability that borrows from next turn\'s Grit will say so).',
  // The same bands the prose describes, as a table teller can read.
  // Pairs, not a per-inch scale: Arm's Reach is about a yard and Short
  // is thirty, so no single ratio spans them (which is why `world` is
  // stated per band rather than computed).
  bands: [
    { name: "Arm's Reach", to: 1, world: "within arm's reach" },
    { name: 'Short', from: 1, to: 6, world: 'up to 30 yards' },
    { name: 'Long', from: 6, to: 18, world: '30–90 yards' },
    { name: 'Distant', from: 18, world: 'past 90 yards' },
  ],
  // "Grit is the action budget and RELOADS at the start of each
  // creature's turn" — the same sentence `space` tells the model, said
  // once more in a form teller can act on rather than only reason with.
  reload: [{ counter: 'Grit', at: 'turn', to: 'max' }],
  // "Severity stacks per Status but cannot exceed 6 on any target
  // (except Trapped)" — and Trapped says so itself: "Severity is NOT
  // capped at 6 for Trapped ('Bagged 'n' Tagged')".
  // The book's seven, with what relieves each — mechanics, so they
  // belong to the system and not to a pack (see `StatusDef`). The
  // Guidebook pack still carries what each one MEANS; this is only
  // that they exist. `relief` is the skill the book names, verbatim.
  statuses: {
    list: [
      { name: 'Afraid', relief: 'Charm', effect: 'daze' },
      { name: 'Burned', relief: 'Finesse', effect: 'burn' },
      { name: 'Dazed', relief: 'Intuition', effect: 'daze' },
      { name: 'Electrocuted', relief: 'Nerve', effect: 'chill' },
      { name: 'Poisoned', relief: 'Nerve', effect: 'wound' },
      { name: 'Trapped', relief: 'Finesse or Nerve', effect: 'mark' },
      { name: 'Unconscious', relief: 'Intuition', effect: 'fade' },
    ],
    stack: 'sum',
    cap: 6,
    uncapped: ['Trapped'],
  },
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
      // Money is COINS AND PAPER (Brian, 2026-08-14): each denomination
      // is an ordinary counter — a count of physical objects in a
      // pouch — and `currency` below says what each is worth. The
      // pocket shows them as one purse chip that opens into the counts.
      { name: 'Dollars', current: 0, max: null },
      { name: 'Half Dollars', current: 0, max: null },
      { name: 'Quarters', current: 0, max: null },
      { name: 'Dimes', current: 0, max: null },
      { name: 'Nickels', current: 0, max: null },
      { name: 'Pennies', current: 0, max: null },
      { name: 'Scrap (pcs)', current: 0, max: null },
      // Supply SLOTS (p. 74): everyone carries 1; horses and mechs add
      // more. The max is the slot count — stored per character and
      // typed over when a mount arrives (rule 1) — and a small max is
      // what draws the printed sheet's tick boxes instead of a number.
      { name: 'Supplies', current: 1, max: 1 },
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
    // The Ace die face (p. 8): rolled in combat, it also marks one Ace
    // on the Ace-in-the-Hole meter. Reported rolls bank it themselves.
    banks: [{ face: 'ace', counter: 'Aces' }],
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
    // Traps live with the weapons: the book treats them as carried,
    // priced combat gear with a Grit cost of their own (p. 70), and the
    // fire button already prices "spring the trap".
    { name: 'Weapons', icon: 'sixgun', kinds: ['weapon', 'trap'], arms: true },
    { name: 'Abilities', icon: 'star', kinds: ['ability'], counters: ['Aces'] },
    // The book's own word (p. 74: "Characters have Inventory to hold
    // anything they can reasonably carry"): ammo by name, everything
    // nobody claims (`rest`), and the carrying trio — Wallet, Scrap,
    // Supplies come from the printed sheet's Inventory panel, and the
    // book links them mechanically: a used Supply can be BOUGHT into
    // Inventory to keep it and free the slot (p. 75).
    {
      name: 'Inventory',
      icon: 'satchel',
      kinds: ['ammo'],
      rest: true,
      counters: [
        'Dollars',
        'Half Dollars',
        'Quarters',
        'Dimes',
        'Nickels',
        'Pennies',
        'Scrap (pcs)',
        'Supplies',
      ],
    },
  ],
  // What the money IS: coins and paper, counted like the physical
  // objects they are — this table's flavor on top of the book's plain
  // decimal prices (the Guidebook prices a coffee at $0.05 and says no
  // more about coinage). The purse renders as one chip; the store pays
  // out of it and proposes the change.
  currency: {
    symbol: '$',
    denominations: [
      { counter: 'Dollars', value: 100 },
      { counter: 'Half Dollars', value: 50 },
      { counter: 'Quarters', value: 25 },
      { counter: 'Dimes', value: 10 },
      { counter: 'Nickels', value: 5 },
      { counter: 'Pennies', value: 1 },
    ],
  },
  // Which glyph a named thing wears. The counters here become pocket
  // chips — glyph, name, value — in one slim tile at Inventory's left
  // edge rather than full panels; the four skills wear theirs on the
  // creation cards. Same map either way: a name, a mark, and no code
  // that knows what "Charm" is (rule 2).
  icons: {
    // The purse chip wears the coin; the denominations inside it are
    // named rows and need no marks of their own.
    Purse: 'coin',
    'Scrap (pcs)': 'cog',
    Supplies: 'satchel',
    Charm: 'hat',
    Finesse: 'card',
    Intuition: 'track',
    Nerve: 'horseshoe',
    // The Black die, keyed by its own name: this table spends bullets.
    B: 'bullet',
    // …and its four faces, for the screens that ask what you rolled.
    hit: 'hit',
    ace: 'ace',
    blank: 'blank',
    spur: 'spur',
  },
  // Talents (p. 32): 4 Prestige buys a category — a skill, a weapon
  // family, Defense, Mechs, Forstalls — and that category rerolls
  // Spurs. Held under the `mark` kind, shown as the printed sheet's ✶
  // box filling in. ("mark" is the generic name; "Talents" is this
  // system's label for it — rule 2.)
  marks: {
    kind: 'mark',
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
    // You fire a weapon; you use an ability (Brian, 2026-08-12); you
    // spring a trap (p. 70 — "spend the associated Grit cost").
    verbs: { ability: 'Use', trap: 'Spring' },
    // Ace-in-the-Hole (p. 14): usable at six Aces, and using it resets
    // the tally — modelled as a second price, `aces: 6` on the ability,
    // debited whole. Disabled until affordable, like any other cost.
    costs: [{ field: 'aces', counter: 'Aces' }],
    // Guidebook p. 41. Aim is a GLOBAL once-per-turn Action, not a
    // property of any weapon — the seat renders one reticle for the
    // screen. (The ✶-and-box printed on each weapon block is NOT Aim:
    // it's the weapon-category Talent marker, p. 32 — tick it when
    // you've bought the Talent and that weapon rerolls Spurs.)
    actions: [
      { name: 'Aim', cost: 1, text: 'Reroll 1 die in your next Attack. Once per turn.' },
    ],
  },
  // Shopping (p. 63: "prices are often negotiable" — the haggle happens
  // out loud; teller presents the shelf and books the transfer). A
  // purchase debits the Wallet; a service — a meal, a night's lodging,
  // a train ticket — is consumed at the counter rather than carried.
  store: {
    costField: 'cost',
    consumes: ['service'],
  },
  // Notches (Brian's table, 2026-08-14 — not a Guidebook mechanic).
  //
  // The book's gear tiers are quality AND rarity (p. 60), handed out by
  // the Warden and bought at a price. This climbs the same ladder from
  // the other end: a Used pistol that has been there for enough of it
  // becomes something, and the player etches each one by hand.
  //
  // Legendary is the fifth rung and the book has no such tier — it's
  // the one-of-a-kind step, and the reason it's here rather than in the
  // shop's vocabulary alone is that it should mostly be EARNED. Mostly,
  // not only: it's excluded from derived stock, so a vendor lists one
  // only when a DM deliberately puts it there (the locked case behind
  // the counter, at a price that costs the posse its supplies).
  //
  // Thresholds are a guess and are meant to be tuned in play — they're
  // data precisely so that tuning them is a pack edit and not a commit.
  // Cumulative, so nothing ever resets and the history stays whole.
  growth: {
    field: 'quality',
    noun: 'notch',
    // Weapons only. Without this the control appeared on every jar of
    // pain pills and every coil of rope a posse was carrying — the
    // primitive is general (marks are "things that happened to this
    // thing"), but WHICH things is the system's call, not teller's.
    kinds: ['weapon'],
    steps: [
      { to: 'Basic', at: 5 },
      { to: 'Premium', at: 15 },
      { to: 'Elite', at: 35 },
      { to: 'Legendary', at: 75 },
    ],
    unstocked: ['Legendary'],
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
};

export const templates: SystemTemplate[] = [dnd5e, wiw];

export function getTemplate(system: string): SystemTemplate | undefined {
  return templates.find((t) => t.system === system);
}

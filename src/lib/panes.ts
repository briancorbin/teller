// A pane is a focused slice of the console — one slice per DM-screen
// panel. A screen assigned the 'console' role renders exactly one:
//
//   session    → the encounter · notices · handouts
//   encounter  → turn order, stats and states, on its own
//   bestiary   → every foe you can reach, searchable
//   map        → scenes · table grid (everything the table TV shows)
//   characters → the character grid
//   library    → rules · reference · party resources
//   displays   → the screens in the room, and what each one is
//
// One list, because two would drift: the console renders from it and the
// Displays panel offers it when assigning a panel. A pane the console can
// show but nobody can be assigned to is a pane that doesn't exist.

export const PANES = [
  'session',
  'encounter',
  'bestiary',
  'map',
  'characters',
  'library',
  'displays',
] as const;

export type Pane = (typeof PANES)[number];

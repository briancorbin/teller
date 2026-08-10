// How a player's card arranges itself — and the fact that there is more
// than one of these is the point.
//
// Nobody knows what a seat should look like yet. It gets used mid-
// conversation, with dice in one hand, on a phone or on a 1920×515 strip
// bolted to the table rail, by people who did not read a manual. That is
// not a question you answer by arguing about it; it's a question you
// answer by putting five of them in front of six players and watching
// which one they reach for.
//
// So layouts are DATA, listed here and only here — the `panes.ts`
// precedent (rule 6). The seat renders from this list and the Displays
// panel offers it, so a layout the seat can render but nobody can be
// assigned to is a layout that doesn't exist.
//
// What they all share: the same counters, the same conditions, the same
// stats, the same authority. A layout is presentation. None of them can
// do something the others can't — otherwise the beta test measures
// features instead of feel.

export const SEAT_LAYOUTS = [
  {
    id: 'gauges',
    name: 'Gauges',
    blurb: 'Bars for anything with a ceiling; the rest tucked underneath.',
  },
  {
    id: 'dials',
    name: 'Dials',
    blurb: 'Round faces you fill and empty. Big targets, no reading.',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    blurb: 'One tight line each. Everything visible, nothing shouting.',
  },
  {
    id: 'focus',
    name: 'Focus',
    blurb: 'The two you spend in a fight, huge. Everything else one tap away.',
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'What teller shipped first — the one to beat.',
  },
] as const;

export type SeatLayout = (typeof SEAT_LAYOUTS)[number]['id'];

/** The one a screen gets before anybody has an opinion. */
export const DEFAULT_LAYOUT: SeatLayout = 'gauges';

export function isSeatLayout(value: unknown): value is SeatLayout {
  return SEAT_LAYOUTS.some((l) => l.id === value);
}

/** Whatever a screen has stored, coerced to something renderable. */
export function layoutOf(value: unknown): SeatLayout {
  return isSeatLayout(value) ? value : DEFAULT_LAYOUT;
}

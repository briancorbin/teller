import { useState } from 'react';
import type { Counter, Field } from '../../../worker/types';
import { bumped } from '../counters/shared';

// The header — one thin row that answers the glance questions.
//
// Whose seat is this, who's the character, what can they spend: the
// paper sheet answers all three at the top of the page, and for a while
// this card answered only one (the trade, set in a plate that was the
// tallest single-purpose thing on the rail). The plate's ruled-line
// treatment survives — it carries the printed-sheet feel and the theme
// colour — but what stands IN it is the character now, with the trade
// as its caption. A name is the identity; a trade is a description of
// it, and the row read wrong with the description as the loud part.
//
// Everything here is declared, nothing known (rule 2): the name is the
// character's own column, the player and trade are whatever fields
// `groups.player` / `groups.title` point at, and the spend chip is the
// counter `use.costCounter` names — Grit here, mana somewhere else, and
// absent entirely in a system that doesn't price its actions. The chip
// sits in the header because it's the currency other screens spend:
// firing happens on Weapons, and the drain should be visible from
// every screen, not just the one holding the gauge.

export function SheetHeader({
  name,
  player,
  trade,
  accent,
  costs = [],
  onCost,
  mounted = false,
}: {
  /** The character's name — a column, not a field. */
  name?: string;
  /** The field `groups.player` names, when the system declares one. */
  player?: Field;
  /** The field `groups.title` names — the role, and the theme. */
  trade?: Field;
  accent?: string;
  /**
   * The currencies `use` prices — costCounter first, then every
   * `use.costs` counter — each with the face `dials` gives it: a
   * cylinder earns a cartridge chip, cards earn a mini card.
   */
  costs?: { counter: Counter; face?: 'cylinder' | 'cards' }[];
  onCost?: (next: Counter) => void;
  /**
   * Mounted glass, where all three answers fit on one line.
   *
   * In a hand they don't: 390px minus a name in 1.35rem serif left the
   * player truncated to "BR…", Grit hanging off the right edge and Aces
   * off the screen entirely — the two numbers you spend, invisible on
   * the sheet that prices them. So held glass gets the same three
   * answers stacked instead of squeezed.
   */
  mounted?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const tint = accent ?? '#f59e0b';
  const tradeValue = trade?.value?.trim();
  const playerValue = player?.value?.trim();

  if (!name && !tradeValue && !costs.length) return null;

  // The plate: who this is, with the trade as its caption. The same
  // block in both arrangements — only what surrounds it changes.
  const plate = (
    <span className="flex min-w-0 flex-col items-center px-1">
      {name && (
        <span
          className={`min-w-0 font-serif text-[1.35rem] font-bold leading-tight text-stone-100 ${
            mounted ? 'max-w-full truncate' : 'break-words text-center'
          }`}
        >
          {name}
        </span>
      )}
      {tradeValue && (
        <span
          className="whitespace-nowrap text-[0.7rem] uppercase leading-tight tracking-[0.18em]"
          style={{ color: tint }}
        >
          The {tradeValue}
        </span>
      )}
    </span>
  );

  // What's left to spend. Just the numbers — the gauges on the Sheet
  // screen keep the ceilings; up here the question is "can I afford the
  // next thing". Each chip is still a control (rule 1): tapping it opens
  // a stepper, so the header never shows a number nobody can change.
  const chips = costs.map(({ counter, face }) => (
    <div key={counter.id} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => (o === counter.id ? null : counter.id))}
        aria-label={`${counter.name}: ${counter.current}`}
        aria-expanded={open === counter.id}
        className="flex items-center gap-1.5"
      >
        <span className="text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
          {counter.name}
        </span>
        {/* The chip wears its counter's declared face, never its
            name: a cylinder is spent in cartridges (flat rim, round
            nose), a cards counter is a tiny card off the deck, and
            anything undialled is a plain pill. */}
        {face === 'cards' ? (
          <span className="flex h-8 w-6 items-center justify-center rounded-[4px] border border-stone-400 bg-[#f4efe4] font-mono text-sm font-bold text-stone-900">
            {counter.current}
          </span>
        ) : (
          <span
            className={`flex h-7 min-w-[2.6rem] items-center justify-center border font-mono text-sm text-stone-100 ${
              face === 'cylinder'
                ? 'rounded-l-sm rounded-r-full border-l-2 pl-1.5 pr-2.5'
                : 'rounded-full px-2.5'
            }`}
            style={{ borderColor: tint, background: `${tint}1f` }}
          >
            {counter.current}
          </span>
        )}
      </button>

      {open === counter.id && onCost && (
        <div className="absolute right-0 top-full z-20 mt-1 flex items-center gap-1 rounded-lg border border-stone-700 bg-stone-950 p-1 shadow-lg">
          <button
            type="button"
            aria-label={`decrease ${counter.name}`}
            onClick={() => onCost(bumped(counter, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-800 font-mono text-lg text-stone-100 hover:bg-stone-700"
          >
            −
          </button>
          <span className="min-w-[2rem] text-center font-mono text-sm text-stone-100">
            {counter.current}
          </span>
          <button
            type="button"
            aria-label={`increase ${counter.name}`}
            onClick={() => onCost(bumped(counter, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-md bg-stone-800 font-mono text-lg text-stone-100 hover:bg-stone-700"
          >
            +
          </button>
        </div>
      )}
    </div>
  ));

  // Held glass: two thin rows instead of three squeezed columns. The
  // plate keeps the whole width and its flanking rules, and underneath
  // it the row that never changes (whose hand this is) sits opposite
  // the numbers that change every turn.
  if (!mounted) {
    return (
      <div
        className="flex shrink-0 flex-col gap-1.5 rounded-md border px-3 py-1.5"
        style={{ borderColor: `${tint}66` }}
      >
        <div className="flex items-center gap-2.5">
          <span className="h-px flex-1" style={{ background: `${tint}55` }} />
          {plate}
          <span className="h-px flex-1" style={{ background: `${tint}55` }} />
        </div>
        {(playerValue || costs.length > 0) && (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
              {playerValue}
            </span>
            <div className="flex shrink-0 items-center gap-3">{chips}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      // A GRID, not a flex row, and that's the whole trick: equal outer
      // columns put the plate at the bar's true centre, while the rule
      // inside each column stretches from the plate out to whatever
      // that side is carrying. Flex could give one or the other —
      // centred name, or rules touching the edges — because a single
      // pair of equal `flex-1` rules can only centre the plate between
      // the side items, and the sides are never the same width.
      // Two rules of DIFFERENT lengths is what both asks require.
      className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 rounded-md border px-3 py-1.5"
      style={{ borderColor: `${tint}66` }}
    >
      {/* Whose hand is holding this, off to the left where the paper
          prints it — the quietest thing in the row, because it's the
          one fact that never changes mid-session. The rule picks up
          where the name leaves off and runs to the plate. */}
      <div className="flex min-w-0 items-center gap-2.5">
        {playerValue && (
          <span className="min-w-0 truncate text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
            {playerValue}
          </span>
        )}
        <span className="h-px flex-1" style={{ background: `${tint}55` }} />
      </div>

      {/* The CHARACTER in the plate now, with the trade as its caption
          (Brian, 2026-08-13) — the same shape the creation flow put
          its question in, so a sheet somebody built at the rail ends
          up wearing the header they filled in. The trade keeps the
          accent, because the trade is what chose the colour. */}
      {plate}

      <div className="flex min-w-0 items-center gap-3">
        <span className="h-px flex-1" style={{ background: `${tint}55` }} />
        {chips}
      </div>
    </div>
  );
}

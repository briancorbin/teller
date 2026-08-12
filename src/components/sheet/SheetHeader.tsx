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
// colour — but it shares the row now instead of owning it.
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
}) {
  const [open, setOpen] = useState<string | null>(null);
  const tint = accent ?? '#f59e0b';
  const tradeValue = trade?.value?.trim();
  const playerValue = player?.value?.trim();

  if (!name && !tradeValue && !costs.length) return null;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-1.5"
      style={{ borderColor: `${tint}66` }}
    >
      {/* Whose card: the name loudest — it's the identity, and it used
          to be the one thing the card never said — with the player
          beside it, the way the paper prints the two boxes side by
          side. */}
      {(name || playerValue) && (
        <div className="flex min-w-0 items-baseline gap-2">
          {name && (
            <span className="truncate font-serif text-[1.05rem] font-bold leading-tight text-stone-100">
              {name}
            </span>
          )}
          {playerValue && (
            <span className="whitespace-nowrap text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
              {playerValue}
            </span>
          )}
        </div>
      )}

      {/* The trade keeps its printed plate — article, rules and all —
          demoted from the whole row to the middle of it. */}
      {tradeValue && (
        <div className="flex min-w-[7rem] flex-1 items-center gap-2.5">
          <span className="h-px flex-1" style={{ background: `${tint}55` }} />
          <span
            className="whitespace-nowrap font-serif text-[1.05rem] font-bold uppercase leading-tight tracking-[0.12em]"
            style={{ color: tint }}
          >
            The {tradeValue}
          </span>
          <span className="h-px flex-1" style={{ background: `${tint}55` }} />
        </div>
      )}

      {/* What's left to spend. Just the numbers — the gauges on the
          Sheet screen keep the ceilings; up here the question is "can I
          afford the next thing". Each chip is still a control (rule 1):
          tapping it opens a stepper, so the header never shows a number
          nobody can change. */}
      {costs.map(({ counter, face }) => (
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
      ))}
    </div>
  );
}

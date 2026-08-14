import { useState } from 'react';
import type {
  CampaignData,
  CartLine,
  CatalogItem,
  Counter,
  Field,
  Item,
  PackEntry,
  RulesPack,
  SystemTemplate,
  Vendor,
} from '../../../worker/types';
import type { StockLine } from '../../../worker/items';
import type { Candidate } from '../sheet/NotchDialog';

// The parts every counter layout is built from.
//
// Layouts differ in ARRANGEMENT only. Clamping, what counts as low, and
// which counters are spendable resources are decided once, here, so a
// beta test compares how five layouts FEEL rather than which one someone
// remembered to clamp properly.

export type CounterViewProps = {
  counters: Counter[];
  onChange: (next: Counter[]) => void;
  /** Touch-sized targets (a seat, a rail panel) vs compact (the console). */
  big?: boolean;
  /** The character's name, for layouts that draw a header of their own. */
  name?: string;
  /**
   * The character's stats, for layouts that place them themselves.
   *
   * Most don't — the card puts them in a strip along the bottom. `Sheet`
   * does, because on paper the skills ARE the left-hand column, and a
   * layout that arranges everything except them isn't the sheet. Which
   * layouts take them over is declared in `seat-layouts.ts`.
   */
  fields?: Field[];
  /**
   * The system's dice, for layouts that draw a pool rather than print
   * it. Declared data, not knowledge: `parsePool` reads "3B1G" against
   * whatever faces the system says it has (rule 2).
   */
  dice?: SystemTemplate['dice'];
  /** Which fields belong to which block of the sheet, when declared. */
  groups?: SystemTemplate['groups'];
  /** Field value → accent colour, when the system themes its sheet. */
  accents?: SystemTemplate['accents'];
  /** Counter name → field keys that belong inside that counter's panel. */
  pins?: SystemTemplate['pins'];
  /** Counter name → the face to draw it with, when the system asks. */
  dials?: SystemTemplate['dials'];
  /** Counter name → glyph, for counters the system dresses compactly. */
  icons?: SystemTemplate['icons'];
  /** Physical money: which counters are the coins, and their worth. */
  currency?: SystemTemplate['currency'];
  /** Mounted glass too short to stack anything — see `strip` in SeatView. */
  strip?: boolean;
  /**
   * Mounted glass: fixed height, never scrolls, clips what overflows.
   *
   * The one device question worth asking (`wide` in SeatView), passed
   * down for the handful of decisions that genuinely turn on it — so
   * far, whether the segmented bar has anything to stick to.
   */
  mounted?: boolean;
  /**
   * The character's conditions, for layouts that place them themselves.
   *
   * Same bargain as `fields`: most layouts leave these to the card's own
   * tag strip, and `Sheet` takes them over because the printed page has
   * a STATUSES panel with a fixed list and a number in each box, which a
   * row of chips can't be. Declared in `seat-layouts.ts`.
   */
  tags?: string[];
  onTags?: (next: string[]) => void;
  /** The things the character carries, for layouts that place them. */
  items?: Item[];
  onItems?: (next: Item[]) => void;
  /** How using an item spends counters, when the system declares it. */
  use?: SystemTemplate['use'];
  /** How carried items split into screens, when the system declares it. */
  screens?: SystemTemplate['screens'];
  /** Tag-driven category marks (Talents), when the system declares them. */
  marks?: SystemTemplate['marks'];
  /** The progression purchases (Prestige), when the system declares them. */
  spends?: SystemTemplate['spends'];
  /** Standing scales (Reputation), when the system declares them. */
  ladders?: SystemTemplate['ladders'];
  /**
   * Writes the character's fields — the ladder panel setting a
   * standing. Receives the fields THIS surface was given; anything the
   * caller withheld (the description) must ride back in its handler,
   * or the first standing tap deletes it (the StatusPanel lesson).
   */
  onFields?: (next: Field[]) => void;
  /**
   * One write for a spend that touches more than one part of the sheet —
   * the fire button debits Grit and an ammo pool together, a Prestige
   * purchase debits a counter and grants a tag or an item — and two
   * separate patches would be two events and two undos for one act.
   * Absent (alongside `onItems`) on read-only surfaces.
   */
  onSpend?: (next: {
    counters?: Counter[];
    items?: Item[];
    fields?: Field[];
    tags?: string[];
  }) => void;
  itemsLabel?: string;
  /** The catalogue items may point into. */
  packs?: RulesPack[];
  /** This campaign's own gear, which outranks any pack's. */
  ownCatalog?: CampaignData['catalog'];
  /** The pack entries for the conditions block, and its heading. */
  conditions?: (PackEntry & { section?: string })[];
  conditionsLabel?: string;
  /** Finds a pack entry by name, so descriptions can open on tap. */
  lookup?: (name: string) => (PackEntry & { section: string }) | undefined;
  /** The caption a pack sets under a panel heading, keyed by that heading. */
  note?: (title: string) => string | undefined;
  /**
   * The shop that's OPEN, for the seat's Store screen — absent when no
   * vendor is on the table. Browsing and carting are live session
   * state; nothing here is a purchase (the DM's confirm is, and it
   * happens on the console).
   */
  shop?: {
    vendor: Vendor;
    shelf: StockLine[];
    cart: CartLine[];
    offered: boolean;
    /** The single money counter, for a system without denominations. */
    counter?: string;
    /** The purse declaration, when money is coins and paper. */
    currency?: SystemTemplate['currency'];
    /**
     * Everything the campaign can reach, for the detail view to resolve
     * what a bundle CONTAINS — an equipment pack is one card on the
     * shelf and a fistful of things once bought, and it should say so
     * before you buy it.
     */
    catalog?: Map<string, CatalogItem>;
    /** What the table calls the DM — "waiting on the Warden". */
    gm?: string;
    onCart: (lines: CartLine[]) => void;
    onOffer: (on: boolean) => void;
  };
  /**
   * Etching notches, when the system declares a ladder to climb — see
   * `SystemTemplate.growth` and `ItemPanel`'s `notch`.
   *
   * Live session data (who's in the fight, where, which round) reaching
   * an item panel, exactly as `shop` does. Absent on read-only surfaces
   * and on systems with no ladder.
   */
  notch?: {
    growth: NonNullable<SystemTemplate['growth']>;
    candidates: Candidate[];
    where?: string;
    round?: number;
  };
};

/** Clamped to [0, max]. A counter never goes negative or past its ceiling. */
export function bumped(counter: Counter, delta: number): Counter {
  let next = counter.current + delta;
  if (counter.max !== null) next = Math.min(next, counter.max);
  return { ...counter, current: Math.max(next, 0) };
}

/**
 * What one TAP of a stepper is worth. A money counter stores cents, and
 * nobody wants to press + a hundred times for a dollar — the odd nickel
 * arrives by typing, which parses cents exactly. Deliberately not baked
 * into `bumped`: a debit (the fire button, a purchase) is an amount, not
 * a number of taps.
 */
export function stepOf(counter: Counter): number {
  return counter.display === 'money' ? 100 : 1;
}

/** A money counter's value as its own notation — 450 → "$4.50". */
export function moneyText(counter: Counter, value = counter.current): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${counter.symbol ?? '$'}${Math.floor(abs / 100)}.${String(
    abs % 100,
  ).padStart(2, '0')}`;
}

/**
 * Does this counter have a ceiling you spend against?
 *
 * The one distinction every layout leans on, and it is derived from the
 * data rather than from knowing any game (rule 2). A max means Health,
 * Grit, ammo, spell slots — the things that empty during a fight and get
 * refilled. No max means a tally: money, scrap, Prestige, supplies.
 *
 * It isn't a guess about importance, it's a fact about shape, and a
 * person can move a counter between the two by typing a max — which is
 * the override rule 1 asks for.
 */
export function isGauge(counter: Counter): boolean {
  return counter.max !== null && counter.max > 0;
}

/** Fraction full, 0..1. Meaningless without a max — callers check first. */
export function fill(counter: Counter): number {
  if (!isGauge(counter)) return 0;
  return Math.max(0, Math.min(1, counter.current / counter.max!));
}

export function isLow(counter: Counter): boolean {
  return isGauge(counter) && fill(counter) <= 0.25;
}

/** Gauges first, tallies after, each keeping the order they were stored in. */
export function split(counters: Counter[]): {
  gauges: Counter[];
  tallies: Counter[];
} {
  return {
    gauges: counters.filter(isGauge),
    tallies: counters.filter((c) => !isGauge(c)),
  };
}

/**
 * A counter nobody has filled in: no ceiling and nothing counted.
 * Dimmed rather than shown as a bold 0, which reads as a corpse.
 */
export function isBlank(counter: Counter): boolean {
  return counter.max === null && counter.current === 0;
}

/** − and + get the same treatment everywhere: adjacent to the number, never across the card. */
export function Step({
  sign,
  onClick,
  label,
  big,
  className = '',
}: {
  sign: '−' | '+';
  onClick: () => void;
  label: string;
  big?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex shrink-0 select-none items-center justify-center rounded-lg bg-stone-800 text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950 ${
        big ? 'h-12 min-w-12 text-2xl' : 'h-8 min-w-8 text-lg'
      } ${className}`}
    >
      {sign}
    </button>
  );
}

/** Back to full. Always rendered so nothing shifts when it becomes available. */
export function Refill({
  counter,
  onChange,
  big,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
  big?: boolean;
}) {
  const canRefill = isGauge(counter) && counter.current < counter.max!;
  return (
    <button
      type="button"
      disabled={!canRefill}
      onClick={() => onChange({ ...counter, current: counter.max! })}
      aria-label={`refill ${counter.name}`}
      title="refill to max"
      className={`flex shrink-0 items-center justify-center rounded text-stone-500 transition-colors hover:bg-stone-800 hover:text-amber-300 disabled:pointer-events-none disabled:opacity-0 ${
        big ? 'h-7 w-7 text-base' : 'h-6 w-6 text-sm'
      }`}
    >
      ↻
    </button>
  );
}

/** A horizontal fill. Presentation of a number that's already on screen. */
export function Bar({ counter, thick }: { counter: Counter; thick?: boolean }) {
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-stone-800 ${
        thick ? 'h-2.5' : 'h-1.5'
      }`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-200 ${
          isLow(counter) ? 'bg-red-500' : 'bg-amber-500'
        }`}
        style={{ width: `${fill(counter) * 100}%` }}
      />
    </div>
  );
}

/**
 * A continuous ring, for when a wedge-per-point would be mush.
 *
 * `ClockFace` cuts the circle into `max` slices, which is right for a
 * 6-segment Grit clock and unreadable for a monster with 38 Health. Same
 * data, different renderer.
 */
export function Ring({
  counter,
  size = 96,
  children,
}: {
  counter: Counter;
  size?: number;
  children?: React.ReactNode;
}) {
  const stroke = size * 0.1;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#292524"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={isLow(counter) ? '#ef4444' : '#f59e0b'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fill(counter))}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/**
 * A Value you can tap and type.
 *
 * Steppers are fine for spending a Supply; they are misery for a $37
 * shop run. The input proposes into the same slot everything else does
 * — clamped, event-logged, console-overridable (rule 1).
 */
export function TypeableValue({
  counter,
  onChange,
  className = '',
  inputClassName = '',
  bare = false,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
  className?: string;
  inputClassName?: string;
  /** Passed through to `Value` — see the note there. */
  bare?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const money = counter.display === 'money';
  const commit = () => {
    if (draft === null) return;
    // A money counter is typed in its own notation — "4.50", "$37" —
    // and stored in cents. Everything else stays whole numbers.
    const typed = Number(draft.replace(/[^\d.-]/g, ''));
    const n = money ? Math.round(typed * 100) : Math.floor(typed);
    setDraft(null);
    if (!Number.isFinite(n) || draft.trim() === '') return;
    const capped = counter.max !== null ? Math.min(n, counter.max) : n;
    const next = Math.max(0, capped);
    if (next !== counter.current) onChange({ ...counter, current: next });
  };
  if (draft !== null) {
    return (
      <input
        autoFocus
        type={money ? 'text' : 'number'}
        inputMode="decimal"
        className={`rounded-md border border-stone-600 bg-stone-950 px-2 py-1 text-center font-mono text-stone-100 outline-none focus:border-amber-500 ${inputClassName}`}
        aria-label={`type a value for ${counter.name}`}
        defaultValue={money ? (counter.current / 100).toFixed(2) : counter.current}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`edit ${counter.name}`}
      className="rounded-md px-1 transition-colors hover:bg-stone-800"
      onClick={() => setDraft(String(counter.current))}
    >
      <Value counter={counter} className={className} bare={bare} />
    </button>
  );
}

/** The value, styled the same way wherever it appears. */
export function Value({
  counter,
  className = '',
  style,
  bare = false,
}: {
  counter: Counter;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Skip the `/—` suffix on an unbounded counter. The dash earns its
   * place on a gauge-shaped layout where a missing ceiling is worth
   * flagging; on a money chip it's noise — nobody expects a maximum
   * wallet. Bounded counters keep their `/max` either way.
   */
  bare?: boolean;
}) {
  const money = counter.display === 'money';
  return (
    <span
      style={style}
      className={`whitespace-nowrap font-mono tabular-nums ${
        isLow(counter)
          ? 'text-red-400'
          : isBlank(counter)
            ? 'text-stone-600'
            : 'text-stone-100'
      } ${className}`}
    >
      {money ? moneyText(counter) : counter.current}
      {/* An unset ceiling shows as "/—" rather than being left off: a
          bounded stat whose max nobody filled in otherwise renders as a
          bare 0. The dash says "no maximum" — except where `bare` says
          the shape is already understood (a money chip), and on money,
          where a ceiling is not a thing wallets have. */}
      {!((bare || money) && counter.max === null) && (
        <span className="text-stone-600">
          /{counter.max === null ? '—' : money ? moneyText(counter, counter.max) : counter.max}
        </span>
      )}
    </span>
  );
}

/**
 * A counter's name, in full.
 *
 * Never truncated — `truncate` is just "cut the text off" spelled as a
 * utility class, and it was in here, so every layout inherited it. Two
 * counters called "Prestige · Total" and "Prestige · Unclaimed" both
 * render as "Prestig…" in a narrow column, which is worse than useless:
 * it's two different things wearing the same label.
 *
 * Long names wrap and make the card taller, which mounted glass answers
 * by clipping. Smaller and complete beats bigger and guessing.
 */
export function Name({
  counter,
  className = '',
}: {
  counter: Counter;
  className?: string;
}) {
  return (
    <span className={`break-words ${className}`}>
      {counter.name}
      {counter.hidden && <span className="ml-1 text-stone-600">· hidden</span>}
    </span>
  );
}

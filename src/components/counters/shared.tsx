import type {
  CampaignData,
  Counter,
  Field,
  Item,
  PackEntry,
  RulesPack,
  SystemTemplate,
} from '../../../worker/types';

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
  /** Mounted glass too short to stack anything — see `strip` in SeatView. */
  strip?: boolean;
  /**
   * Mounted glass: fixed height, scaled to fit, and it never scrolls.
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
  /**
   * One write for a spend that touches counters AND items — the fire
   * button debits Grit and an ammo pool together, and two separate
   * patches would be two events and two undos for one squeeze of the
   * trigger. Absent (alongside `onItems`) on read-only surfaces.
   */
  onSpend?: (next: { counters?: Counter[]; items?: Item[] }) => void;
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
};

/** Clamped to [0, max]. A counter never goes negative or past its ceiling. */
export function bumped(counter: Counter, delta: number): Counter {
  let next = counter.current + delta;
  if (counter.max !== null) next = Math.min(next, counter.max);
  return { ...counter, current: Math.max(next, 0) };
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

/** The value, styled the same way wherever it appears. */
export function Value({
  counter,
  className = '',
  style,
}: {
  counter: Counter;
  className?: string;
  style?: React.CSSProperties;
}) {
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
      {counter.current}
      {/* An unset ceiling shows as "/—" rather than being left off: a
          bounded stat whose max nobody filled in otherwise renders as a
          bare 0. The dash says "no maximum". */}
      <span className="text-stone-600">/{counter.max ?? '—'}</span>
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
 * Long names wrap and make the card taller, which `FitBox` answers by
 * scaling. Smaller and complete beats bigger and guessing.
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

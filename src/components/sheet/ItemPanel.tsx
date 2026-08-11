import type {
  Counter,
  Item,
  RulesPack,
  SystemTemplate,
} from '../../../worker/types';
import {
  fittedUpgrades,
  resolveItem,
  type OwnCatalog,
} from '../../../worker/items';
import { bumped, isGauge, Step } from '../counters/shared';
import { SheetPanel } from './SheetPanel';
import { looksLikePool, Track } from './Track';

// One thing a character carries, laid out like the printed block.
//
// A WiW weapon on paper is: a maker and a model on write-in lines, a
// Grit cost in a box, three ranges each with a track of dice, a numbered
// list of upgrades, and a couple of rows of special ammunition with a
// count. This renders all of that and **knows none of it**.
//
// Every part comes from the generic shape (rule 2): fields render as
// rows, and a field whose value parses as dice becomes a track exactly
// the way a Skill does — so "Arm's Reach: 2G" draws itself without this
// file ever hearing the word "range". Counters become the ammunition
// steppers. Tags become chips. The same panel will draw an ability, a
// spell focus or a saddlebag when someone writes one down.
//
// The one judgement it does make is presentational and derived: a SHORT
// value gets a box, a long one gets a line. That's the difference
// between the Grit box and the Manufacturer rule on the printed page,
// and it is a fact about the string rather than about the game.

/** Past this a value is a word on a line, not a number in a box. */
const BOXY = 4;
/** Past this it is prose, and prose does not belong in a label column. */
const PROSE = 22;

/**
 * One line of an item, shaped by what the value IS.
 *
 * Three shapes, all derived rather than declared, which is what lets one
 * renderer draw a weapon's Grit cost, its ranges and its upgrades
 * without being told which is which:
 *
 *   * **a pool** → the track, exactly as a Skill draws it
 *   * **something short** → a box, like the printed Grit square
 *   * **prose** → the label on its own line with the text beneath, which
 *     is how the sheet prints upgrades: a name, then what it does.
 *     Forcing those through a label column crushed "Kickback Stabilizer"
 *     into a two-line sliver beside its own effect.
 */
function ItemRow({
  label,
  value,
  dice,
  overridden,
  derived,
}: {
  label: string;
  value: string;
  dice?: SystemTemplate['dice'];
  /** A person typed this and the derivation stepped aside (rule 1). */
  overridden?: boolean;
  derived?: string;
}) {
  const pool = looksLikePool(value, dice);
  const boxy = !pool && value.length > 0 && value.length <= BOXY;
  const prose = !pool && !boxy && value.length > PROSE;

  const Label = (
    <span
      className={`break-words text-[0.7rem] uppercase leading-tight tracking-[0.1em] ${
        prose ? '' : 'w-[6.5rem] shrink-0 text-right'
      }`}
      style={{ color: 'var(--sheet-accent, #f59e0b)' }}
    >
      {label}
    </span>
  );

  if (prose) {
    return (
      <div className="flex flex-col gap-0.5 border-l-2 border-stone-700 py-1 pl-2">
        {Label}
        <span className="break-words text-[0.8rem] leading-snug text-stone-300">
          {value}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      {Label}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {boxy ? (
          <span className="flex h-7 min-w-8 items-center justify-center rounded-[3px] border-2 border-stone-400 px-1.5 font-mono text-sm text-stone-100">
            {value}
          </span>
        ) : (
          <Track value={value} dice={dice} bonus={0} />
        )}
        {/* Marked, not hidden. A number somebody typed over the book's
            beats it (rule 1) — and the player should be able to see
            that it was overridden, and what it was. */}
        {overridden && (
          <span
            className="whitespace-nowrap text-[0.6rem] uppercase tracking-wider text-stone-500"
            title={derived ? `the book and its upgrades say ${derived}` : undefined}
          >
            · set by hand{derived ? ` (was ${derived})` : ''}
          </span>
        )}
      </div>
    </div>
  );
}

/** Ammunition and anything else the item counts down. */
function ItemCounter({
  counter,
  onChange,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-stone-800 bg-stone-900/60 px-2 py-1">
      <span className="min-w-0 flex-1 break-words text-[0.65rem] uppercase tracking-widest text-stone-500">
        {counter.name}
      </span>
      <span className="whitespace-nowrap font-mono text-sm tabular-nums text-stone-100">
        {counter.current}
        {isGauge(counter) && <span className="text-stone-600">/{counter.max}</span>}
      </span>
      <Step
        sign="−"
        label={`decrease ${counter.name}`}
        onClick={() => onChange(bumped(counter, -1))}
      />
      <Step
        sign="+"
        label={`increase ${counter.name}`}
        onClick={() => onChange(bumped(counter, 1))}
      />
    </div>
  );
}

export function ItemPanel({
  item,
  dice,
  packs = [],
  ownCatalog,
  onChange,
  fill = false,
}: {
  item: Item;
  dice?: SystemTemplate['dice'];
  /** The catalogue this item may point into. */
  packs?: RulesPack[];
  /** The campaign's own gear, which outranks any pack's. */
  ownCatalog?: OwnCatalog;
  onChange: (next: Item) => void;
  fill?: boolean;
}) {
  // Base stats from the catalogue, upgrades applied, anything a person
  // typed on top — see `worker/items.ts`. An item that points at nothing
  // comes back exactly as it was stored.
  const resolved = resolveItem(item, packs, dice, ownCatalog);
  const fitted = fittedUpgrades(item, packs, ownCatalog);
  const setCounter = (next: Counter) =>
    onChange({
      ...item,
      counters: item.counters.map((c) => (c.id === next.id ? next : c)),
    });

  return (
    <SheetPanel title={item.name} fill={fill} className="w-full">
      <div className="flex flex-col gap-1">
        {resolved.fields.map((field) => (
          <ItemRow
            key={field.key}
            label={field.label}
            value={field.value}
            dice={dice}
            overridden={field.overridden}
            derived={field.derived}
          />
        ))}

        {/* What's bolted on, and how much room is left. The slot count
            is the book's own constraint and the thing a player actually
            asks at the table — "can I fit another one?" */}
        {fitted.length > 0 && (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
              Upgrades {resolved.slots ? `${resolved.slotsUsed}/${resolved.slots}` : ''}
            </span>
            {fitted.map(({ upgrade, range }, i) => (
              <div key={`${upgrade.id}${i}`} className="border-l-2 border-stone-700 pl-2">
                <span
                  className="block break-words text-[0.7rem] uppercase tracking-[0.1em]"
                  style={{ color: 'var(--sheet-accent, #f59e0b)' }}
                >
                  {upgrade.name}
                  {range ? ` · ${range}` : ''}
                </span>
                {upgrade.text && (
                  <span className="block break-words text-[0.75rem] leading-snug text-stone-400">
                    {upgrade.text}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Chips, because a tag is a word that is either there or not —
            the printed sheet's own version is a box beside the model
            that is either ticked or blank. What it MEANS is the
            publisher's business and this doesn't ask. */}
        {item.tags && item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider"
                style={{
                  borderColor: 'var(--sheet-accent, #f59e0b)',
                  color: 'var(--sheet-accent, #f59e0b)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {item.counters.length > 0 && (
          <div className="flex flex-col gap-1 pt-0.5">
            {item.counters.map((counter) => (
              <ItemCounter
                key={counter.id}
                counter={counter}
                onChange={setCounter}
              />
            ))}
          </div>
        )}
      </div>
    </SheetPanel>
  );
}

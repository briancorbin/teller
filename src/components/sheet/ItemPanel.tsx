import { useState } from 'react';
import type {
  Counter,
  Item,
  RulesPack,
  SystemTemplate,
} from '../../../worker/types';
import {
  catalogOf,
  describeEffect,
  fittedUpgrades,
  resolveItem,
  type OwnCatalog,
} from '../../../worker/items';
import { bumped, isGauge, Step } from '../counters/shared';
import { Reticle } from './Reticle';
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
  use,
  ammo = [],
  acts = [],
  armed = [],
  spent = [],
  onToggleAct,
  onFire,
  extraCost = 0,
  available,
  balances = {},
  tags = [],
  marks,
}: {
  item: Item;
  dice?: SystemTemplate['dice'];
  /** The catalogue this item may point into. */
  packs?: RulesPack[];
  /** The campaign's own gear, which outranks any pack's. */
  ownCatalog?: OwnCatalog;
  onChange: (next: Item) => void;
  fill?: boolean;
  /** How using an item spends counters, when the system declares it. */
  use?: SystemTemplate['use'];
  /** The character's consumable pools — siblings this item can chamber. */
  ammo?: Item[];
  /**
   * The system's per-turn moves (Aim), worn as a reticle beside this
   * trigger. GLOBAL state rendered locally: there is one Aim, not one
   * per gun, so the same armed list lights every panel's reticle and
   * toggling any one of them toggles them all. Empty off the arming
   * screen — you don't aim a speech.
   */
  acts?: { name: string; cost: number; text?: string }[];
  armed?: string[];
  spent?: string[];
  onToggleAct?: (name: string) => void;
  /**
   * Spend this item's cost from the priced counter — the caller adds
   * any armed actions (Aim) on top and clears them. `extras` are the
   * item's additional prices (`use.costs`), resolved here because only
   * this panel holds the catalogue-merged fields.
   */
  onFire?: (cost: number, extras?: { counter: string; amount: number }[]) => void;
  /** Armed actions' cost, already decided upstream — shown in the price. */
  extraCost?: number;
  /** What the cost counter currently holds, for the disabled state. */
  available?: number;
  /** What each `use.costs` counter holds, for the disabled state. */
  balances?: Record<string, number>;
  /** The character's tags — where a Talent lives ("Talent: Rifles"). */
  tags?: string[];
  /** The system's mark declaration — see `SystemTemplate.marks`. */
  marks?: SystemTemplate['marks'];
}) {
  // A pool that's gone missing (deleted, traded away) simply deselects.
  const chambered = ammo.find((a) => a.id === item.loaded);
  const catalog = catalogOf(packs, ownCatalog).items;
  // The chambered round's catalogue entry — its pool effects flow into
  // the tracks below, and its prose is shown at the moment of the shot.
  const round = chambered?.from ? catalog.get(chambered.from) : undefined;

  // The Talent tick (see `SystemTemplate.marks`): the catalogue GROUP is
  // the category — carry a rifle, hold "Talent: Rifles", and the panel
  // wears the printed sheet's ✶. Display only; the reroll is real dice.
  const group = item.from ? catalog.get(item.from)?.group : undefined;
  const talent =
    marks && group
      ? tags.find(
          (t) =>
            t.trim().toLowerCase() ===
            `${marks.prefix}${group}`.trim().toLowerCase(),
        )
      : undefined;

  // Base stats from the catalogue, upgrades applied, the chambered
  // round last, anything a person typed on top — see `worker/items.ts`.
  // An item that points at nothing comes back exactly as it was stored.
  const resolved = resolveItem(item, packs, dice, ownCatalog, chambered);
  const fitted = fittedUpgrades(item, packs, ownCatalog);
  // The panel has two FACES: stats, and the upgrades bolted on. A flip
  // rather than a disclosure, because an inline expansion changes the
  // panel's height and three weapons in a row stop lining up — the
  // back face borrows the front's frame and gives it back.
  const [flipped, setFlipped] = useState(false);
  // An effect names a field KEY; the sheet's own word for it is on the
  // resolved field, so an upgrade reads "Long Range +2B" rather than
  // "long +2B" without this file knowing any range names.
  const labelOf = (key: string) =>
    resolved.fields.find((f) => f.key === key)?.label ?? key;
  const setCounter = (next: Counter) =>
    onChange({
      ...item,
      counters: item.counters.map((c) => (c.id === next.id ? next : c)),
    });

  // The price of using this thing, read off the RESOLVED fields so a
  // value somebody typed over the book's wins here too (rule 1). A
  // non-numeric price gets no button — derived, like every other shape
  // choice in this file — which is also what keeps the button off the
  // ammo pools themselves: a box of rounds has no cost field.
  const price = use
    ? Number(resolved.fields.find((f) => f.key === use.costField)?.value)
    : NaN;
  const fireable = Boolean(onFire) && Number.isFinite(price) && price > 0;
  // The trigger's word for THIS kind of thing — you fire a weapon, you
  // use an ability. Declared per kind, falling back to the one verb.
  const verb = use?.verbs?.[item.kind ?? ''] ?? use?.verb;
  // The item's additional prices (`use.costs`): an ability carrying
  // `aces: 6` also sweeps the Ace tally. Read off the resolved fields
  // like the main price, so a typed-over value wins (rule 1) and an
  // item without the field pays nothing extra.
  const extras = (use?.costs ?? []).flatMap((c) => {
    const amount = Number(resolved.fields.find((f) => f.key === c.field)?.value);
    return Number.isFinite(amount) && amount > 0
      ? [{ counter: c.counter, amount }]
      : [];
  });

  // A FIXED order, so three panels in a row read as one table: the
  // priced field first (declared — `use.costField`, the printed sheet's
  // Grit box), then everything else in catalogue order, which is the
  // same for every entry in a pack. Alignment is the whole point of a
  // row of weapons; a field that wanders panel to panel costs more
  // than it tells.
  const shown = resolved.fields.filter((f) => !f.filing);
  const costRow = use ? shown.find((f) => f.key === use.costField) : undefined;
  const bodyRows = costRow ? shown.filter((f) => f !== costRow) : shown;
  /** The back face exists when there's upgrade real estate at all. */
  const flippable = resolved.slots != null || fitted.length > 0;

  return (
    <SheetPanel
      title={item.name}
      fill={fill}
      className="w-full"
      mark={talent ? { title: `${talent} — ${marks?.text ?? ''}` } : undefined}
    >
      <div className={`flex flex-col gap-1 ${fill ? 'min-h-0 flex-1' : ''}`}>
        {/* The FRONT face: stats. Filing information stays in the
            catalogue, where you're choosing the thing — Quality and
            Cost are most of the decision at the gunsmith's and pure
            noise above the dice mid-fight (see `Field.filing`). */}
        {!flipped &&
          [...(costRow ? [costRow] : []), ...bodyRows].map((field) => (
          <ItemRow
            key={field.key}
            label={field.label}
            value={field.value}
            dice={dice}
            overridden={field.overridden}
            derived={field.derived}
          />
          ))}

        {/* The BACK face: what's bolted on, in full — a flip rather
            than an inline expansion, so reading your upgrades never
            changes the panel's height or anyone's alignment. */}
        {flipped && (
          <div className="flex flex-col gap-1">
            {fitted.length === 0 && (
              <span className="text-[0.75rem] leading-snug text-stone-500">
                nothing fitted yet — fitting happens at the console
              </span>
            )}
            {fitted.map(({ upgrade, range }, i) => (
              <div key={`${upgrade.id}${i}`} className="border-l-2 border-stone-700 pl-2">
                {/* The NAME, and under it what it does. Not its level,
                    not which weapons it fits, not what it cost — that's
                    filing information, and a player is asking what the
                    thing on their rifle actually does. */}
                <span
                  className="block break-words text-[0.7rem] uppercase tracking-[0.1em]"
                  style={{ color: 'var(--sheet-accent, #f59e0b)' }}
                >
                  {upgrade.name}
                </span>
                {(upgrade.effects ?? []).map((effect, j) => (
                  <span
                    key={j}
                    className="block break-words font-mono text-[0.75rem] leading-snug text-stone-200"
                  >
                    {describeEffect(effect, range ?? effect.range, labelOf)}
                  </span>
                ))}
                {upgrade.text && (
                  <span className="block break-words text-[0.75rem] leading-snug text-stone-400">
                    {upgrade.text}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* The bottom cluster, pinned (`mt-auto`) and IDENTICAL on both
            faces, which is what makes a row of panels read as one
            table: every chamber select, reticle, trigger and flip
            button sits at the same height on every weapon, whatever
            the middle of each panel got up to. */}
        <div className="mt-auto flex flex-col gap-1 pt-1">
        {/* What's chambered, at the moment it matters. Pool effects are
            already IN the tracks above; everything a round does after
            the dice (push, burn, pierce) is prose, and this is the shot
            where it applies. Prose-length fields only — "Fits: Firearms"
            is the pool panel's business, not the trigger's. */}
        {fireable && round && (
          <div className="border-l-2 border-stone-700 pl-2">
            <span
              className="block break-words text-[0.7rem] uppercase tracking-[0.1em]"
              style={{ color: 'var(--sheet-accent, #f59e0b)' }}
            >
              {chambered?.name}
            </span>
            {(round.effects ?? []).map((effect, i) => (
              <span
                key={i}
                className="block break-words font-mono text-[0.75rem] leading-snug text-stone-200"
              >
                {describeEffect(
                  effect,
                  effect.range,
                  (key) => resolved.fields.find((f) => f.key === key)?.label ?? key,
                )}
              </span>
            ))}
            {round.fields
              .filter((f) => !f.filing && f.value.length > PROSE)
              .map((f) => (
                <span
                  key={f.key}
                  className="block break-words text-[0.75rem] leading-snug text-stone-400"
                >
                  {f.value}
                </span>
              ))}
          </div>
        )}

        {/* The trigger. One tap spends the item's declared cost and one
            of whatever's chambered — bookkeeping through the same
            counter arithmetic a stepper does, event-logged and undoable
            (rule 1). The verb on the button is the SYSTEM's word
            (`use.verb` — "Fire"), never teller's, and the price beside
            it is the receipt. */}
        {fireable && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {use?.consumesKind && ammo.length > 0 && (
              <select
                className="h-9 min-w-0 flex-1 basis-32 rounded-md border border-stone-700 bg-stone-900 px-2 text-[0.75rem] text-stone-200 focus:border-stone-500 focus:outline-none"
                value={chambered?.id ?? ''}
                onChange={(e) =>
                  onChange({ ...item, loaded: e.target.value || undefined })
                }
                aria-label={`what ${item.name} is loaded with`}
              >
                {/* The untracked default — WiW doesn't count regular
                    rounds, so there is nothing to decrement. */}
                <option value="">—</option>
                {ammo.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {pool.name}
                    {pool.counters[0] ? ` · ${pool.counters[0].current}` : ''}
                  </option>
                ))}
              </select>
            )}
            {/* The turn's moves, one reticle each, on the trigger row
                where the price they add is felt. Arm it here or on any
                other weapon — same state, one Aim. */}
            {acts.map((action) => {
              const isArmed = armed.includes(action.name);
              const isSpent = spent.includes(action.name);
              const broke =
                available !== undefined && !isArmed && available < action.cost;
              return (
                <Reticle
                  key={action.name}
                  armed={isArmed}
                  spent={isSpent}
                  disabled={broke || !onToggleAct}
                  label={
                    isSpent
                      ? `${action.name}: used this turn — back when your ${use?.costCounter} reloads`
                      : `${action.name}: +${action.cost} ${use?.costCounter} on your next shot. ${action.text ?? ''}`
                  }
                  onToggle={() => onToggleAct?.(action.name)}
                />
              );
            })}
            {/* The price is the WHOLE price — an armed Aim rides on the
                same squeeze (deduct-at-fire, one event, one undo), so
                the label already includes it. Unaffordable is DISABLED,
                not clamped: teller declines to automate a spend the
                counter can't cover, and the steppers stay right there
                for the table to rule otherwise (rule 1). */}
            {(() => {
              const total = price + extraCost;
              // Every price must clear: the main counter AND each of
              // the item's extra currencies (an Ace-in-the-Hole ability
              // waits for its six Aces the same way a shot waits for
              // its Grit).
              const short = [
                ...(available !== undefined && available < total
                  ? [use?.costCounter]
                  : []),
                ...extras
                  .filter((e) => (balances[e.counter] ?? 0) < e.amount)
                  .map((e) => e.counter),
              ];
              const broke = short.length > 0;
              return (
                <button
                  type="button"
                  className="flex h-9 shrink-0 items-center justify-center rounded-md border-2 px-3 font-mono text-sm font-bold tracking-wider transition-colors active:bg-stone-800 disabled:opacity-35"
                  style={{
                    borderColor: 'var(--sheet-accent, #f59e0b)',
                    color: 'var(--sheet-accent, #f59e0b)',
                  }}
                  disabled={broke}
                  onClick={() => onFire?.(price, extras)}
                  aria-label={`${verb ?? 'use'} ${item.name}: spend ${total} ${use?.costCounter}${
                    extras.length
                      ? ` and ${extras
                          .map((e) => `${e.amount} ${e.counter}`)
                          .join(' and ')}`
                      : ''
                  }${chambered ? ` and one ${chambered.name}` : ''}${
                    broke ? ` (not enough ${short.join(', ')})` : ''
                  }`}
                >
                  {verb
                    ? `${verb} −${total} ${use?.costCounter}`
                    : `− ${total} ${use?.costCounter}`}
                </button>
              );
            })()}
          </div>
        )}

        {/* The flip. The slot count is the book's own constraint and
            the thing a player actually asks — "can I fit another
            one?" — so it IS the button. Same line on every panel. */}
        {flippable && (
          <button
            type="button"
            className="self-start text-left text-[0.65rem] uppercase tracking-widest text-stone-500 transition-colors hover:text-stone-300"
            onClick={() => setFlipped(!flipped)}
            aria-expanded={flipped}
          >
            {flipped
              ? '◂ stats'
              : `Upgrades ${
                  resolved.slots ? `${resolved.slotsUsed}/${resolved.slots}` : fitted.length
                } ▸`}
          </button>
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
      </div>
    </SheetPanel>
  );
}

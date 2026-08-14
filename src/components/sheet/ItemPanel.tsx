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
  standingOf,
  type OwnCatalog,
} from '../../../worker/items';
import { bumped, isGauge, Step } from '../counters/shared';
import type { Candidate } from './NotchDialog';
import { Reticle } from './Reticle';
import { SheetPanel } from './SheetPanel';
import { PROSE, StatRow } from './StatRow';

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
// The one judgement it does make is presentational and derived — a
// SHORT value gets a box, a long one gets a line — and that judgement
// lives in `StatRow`, shared with the store's detail view so a rifle
// reads the same on the shelf as it does in your hands.

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
  notch,
  onNotch,
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
  /**
   * Etching, when the system declares a ladder to climb
   * (`SystemTemplate.growth`) and this surface can write.
   *
   * Absent means no history face and no button — which is also what a
   * system without a ladder gets, and what a read-only screen gets.
   * Present with an empty `candidates` still works: outside a fight you
   * type the name yourself.
   */
  notch?: {
    growth: NonNullable<SystemTemplate['growth']>;
    candidates: Candidate[];
    where?: string;
    round?: number;
  };
  /**
   * Ask for the cutting dialog — which is rendered by the SCREEN, not
   * here.
   *
   * It lived in this panel first and pinned itself to it, which broke
   * the moment anyone opened it on a knife: a panel's height comes from
   * how many stat rows its catalogue entry has, so a rifle's panel is
   * 453px and the Colorado Toothpick's is 162px, and a dialog needing
   * ~172px spilled straight out of the bottom of the short one. The
   * dialog's room must not depend on which weapon you tapped, so the
   * screen owns it — the same answer the store's detail view reached.
   */
  onNotch?: () => void;
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
  // The panel has FACES: stats, the upgrades bolted on, and what it's
  // been through. A flip rather than a disclosure, because an inline
  // expansion changes the panel's height and three weapons in a row
  // stop lining up — a back face borrows the front's frame and gives
  // it back.
  const [face, setFace] = useState<'stats' | 'upgrades' | 'history'>('stats');
  /** The notch being read, picked off the strip. Tapping it again lets go. */
  const [picked, setPicked] = useState<string | null>(null);
  const flipped = face === 'upgrades';
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
  // Where this thing stands on its system's ladder, read off its own
  // resolved tier field and the deeds it carries. Pure arithmetic that
  // PROPOSES: `ready` lights a word on a button, and a human decides
  // whether anything happens (rule 1).
  const standing = standingOf(item.history, resolved.fields, notch?.growth);
  const deeds = item.history ?? [];

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
        {face === 'stats' &&
          [...(costRow ? [costRow] : []), ...bodyRows].map((field) => (
          <StatRow
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

        {/* The HISTORY face: what this thing has been through, newest
            first, because the notch you just cut is the one you want
            to see.

            **A mark per DEED, not a progress bar** (Brian, 2026-08-14).
            This began as `TallyPanel` — the Ace tally's tick boxes —
            with the next rung as its max, and that was wrong twice
            over. It carried steppers, and there is nothing here to
            step: the count is derived from the deeds, and cutting one
            is the only way it moves. And a box that stands for a
            fraction of a threshold is a box you can't tap, whereas a
            box that IS a notch has something to say — which is what
            these do. They're the marks on the stock; the rung is a
            line of text, where a number belongs. */}
        {face === 'history' && (
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            {deeds.length > 0 && (
              <div className="flex max-h-[4.5rem] flex-wrap gap-1 overflow-y-auto">
                {deeds.map((deed, i) => (
                  <button
                    key={deed.id}
                    type="button"
                    onClick={() =>
                      setPicked(picked === deed.id ? null : deed.id)
                    }
                    aria-pressed={picked === deed.id}
                    aria-label={`${notch?.growth.noun ?? 'notch'} ${i + 1}: ${deed.what}`}
                    className={`h-5 w-3 shrink-0 rounded-[2px] border transition-colors ${
                      picked === deed.id
                        ? 'border-stone-100'
                        : 'border-transparent opacity-80 hover:opacity-100'
                    }`}
                    style={{ background: 'var(--sheet-accent, #f59e0b)' }}
                  />
                ))}
              </div>
            )}
            {standing.next && (
              <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
                {standing.ready ? (
                  // No name for who rules on it: this panel doesn't
                  // hold the campaign's word for its GM, and guessing
                  // "DM" at a table that says "Warden" is worse than
                  // saying nothing (rule 4 — the vocabulary is the
                  // template's).
                  <span style={{ color: 'var(--sheet-accent, #f59e0b)' }}>
                    ready to rise to {standing.next.to}
                  </span>
                ) : (
                  `${standing.next.at - standing.deeds} more to ${standing.next.to}`
                )}
              </span>
            )}
            {deeds.length === 0 && (
              <span className="text-[0.75rem] leading-snug text-stone-500">
                nothing yet
              </span>
            )}
            {/* A bounded shelf that may scroll DOWN — a history is
                genuinely unbounded, which is the case that earned
                mounted touch glass its exception (rule 6). The page
                still never moves. */}
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {/* Picking a mark brings its own line up here rather than
                  opening anything: the story is already on this face,
                  and a popover over a list you can read is a second
                  place to look at the same words. So the strip and the
                  list are one control — tap a notch, its line lights
                  and comes into view. */}
              {[...deeds].reverse().map((deed) => (
                <div
                  key={deed.id}
                  ref={(el) => {
                    if (el && picked === deed.id) {
                      el.scrollIntoView({ block: 'nearest' });
                    }
                  }}
                  className={`flex items-baseline gap-2 border-l-2 pl-2 transition-colors ${
                    picked === deed.id ? '' : 'border-stone-700'
                  }`}
                  style={
                    picked === deed.id
                      ? { borderColor: 'var(--sheet-accent, #f59e0b)' }
                      : undefined
                  }
                >
                  <div className="min-w-0 flex-1">
                    <span className="block break-words text-[0.75rem] leading-snug text-stone-200">
                      {deed.what}
                    </span>
                    <span className="block break-words text-[0.6rem] uppercase tracking-widest text-stone-500">
                      {[
                        deed.where,
                        deed.round != null ? `round ${deed.round}` : null,
                        deed.when.slice(0, 10),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {deed.note && (
                      <span className="block break-words text-[0.75rem] leading-snug text-stone-400">
                        {deed.note}
                      </span>
                    )}
                  </div>
                  {/* A mis-tap mid-fight is the likeliest way this goes
                      wrong, and a record nobody can correct would be a
                      rule 1 hole. Removing one is the player's own, on
                      their own weapon. */}
                  <button
                    type="button"
                    aria-label={`remove ${deed.what}`}
                    onClick={() =>
                      onChange({
                        ...item,
                        history: deeds.filter((d) => d.id !== deed.id),
                      })
                    }
                    className="shrink-0 px-1 text-stone-600 transition-colors hover:text-stone-300"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
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

        {/* The flips. A count is the book's own constraint and the
            thing a player actually asks — "can I fit another one?",
            "how close am I?" — so the count IS the button, and neither
            face costs the panel any height until you're on it. One
            line on every panel, whatever it offers. */}
        {(flippable || notch) && (
          <div className="flex flex-wrap items-baseline gap-x-3">
            {flippable && face !== 'upgrades' && (
              <button
                type="button"
                className="text-left text-[0.65rem] uppercase tracking-widest text-stone-500 transition-colors hover:text-stone-300"
                onClick={() => setFace('upgrades')}
              >
                {`Upgrades ${
                  resolved.slots ? `${resolved.slotsUsed}/${resolved.slots}` : fitted.length
                } ▸`}
              </button>
            )}
            {/* The tally, worn as the way IN to it. A weapon nobody has
                started etching says so plainly rather than showing a
                zero — starting is a choice, and an empty counter on
                every gun in the game is what opting in avoids. */}
            {notch && face !== 'history' && (
              <button
                type="button"
                className="text-left text-[0.65rem] uppercase tracking-widest transition-colors hover:text-stone-300"
                style={
                  standing.ready
                    ? { color: 'var(--sheet-accent, #f59e0b)' }
                    : { color: 'rgb(120 113 108)' }
                }
                onClick={() => setFace('history')}
              >
                {deeds.length === 0
                  ? `${notch.growth.noun ?? 'notch'}es ▸`
                  : `${notch.growth.noun ?? 'notch'}es ${standing.deeds}${
                      standing.next ? `/${standing.next.at}` : ''
                    } ▸`}
              </button>
            )}
            {face !== 'stats' && (
              <button
                type="button"
                className="text-left text-[0.65rem] uppercase tracking-widest text-stone-500 transition-colors hover:text-stone-300"
                onClick={() => setFace('stats')}
              >
                ◂ stats
              </button>
            )}
            {/* Cutting one is only offered on the face that shows
                them, so the front of a weapon never grows a control
                for a thing you may never do with it. */}
            {notch && face === 'history' && (
              <button
                type="button"
                className="text-left text-[0.65rem] uppercase tracking-widest transition-colors hover:text-stone-300"
                style={{ color: 'var(--sheet-accent, #f59e0b)' }}
                onClick={onNotch}
              >
                + cut a {notch.growth.noun ?? 'notch'}
              </button>
            )}
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
      </div>
    </SheetPanel>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Counter, Field, Item } from '../../../worker/types';
import { HealthPanel } from '../sheet/HealthPanel';
import { Cylinder, dialable } from '../sheet/Cylinder';
import { ItemPanel } from '../sheet/ItemPanel';
import { Reticle } from '../sheet/Reticle';
import { Screens } from '../sheet/Screens';
import { TallyPanel } from '../sheet/TallyPanel';
import { SkillPanel } from '../sheet/SkillPanel';
import { StatusPanel } from '../sheet/StatusPanel';
import { TradePlate } from '../sheet/TradePlate';
import {
  Bar,
  bumped,
  Name,
  Refill,
  split,
  Step,
  Value,
  type CounterViewProps,
} from './shared';

// Sheet — arranged like the paper.
//
// Read off the actual WiW character sheet rather than invented: skills
// boxed down the left, the spendable resources in the middle, statuses
// down the right. A player who has filled one of these in already knows
// where to look, which is worth more than any arrangement I'd come up
// with.
//
// **It is built a block at a time, and shows only the blocks that are
// built.** Anything without its proper home on the page — Wallet, Scrap,
// Prestige, Speed — is HIDDEN here rather than improvised into a strip
// of chips along the edge. Those chips were the difference between a
// card that looked designed and one that looked like a to-do list.
//
// Hidden, emphatically not deleted. Every one of those is still a real
// number on the character (rule 1): the console shows it, so do the
// other five seat layouts, and each returns to this layout the moment
// the page's lower half — gear, abilities, prestige — is drawn.
//
// Two devices are lifted directly because they're better than what we
// had:
//
//   * **Grit is a ring of numbers you mark**, not a bar. On paper you
//     circle where you are, so tapping a number SETS it — one touch to
//     go from 6 to 2, where −/+ takes four.
//   * **A stat is a box with the value big and the name small under it**,
//     which is how every sheet in the hobby prints them.
//
// What is NOT lifted is the sheet's text. The status descriptions, the
// ability wording, the trade blurbs — that's the publisher's prose and
// it stays in your pack, where the conditions list already reads it from
// (rule 4). This file knows about boxes and rings, not about the West.
//
// Nothing here is game-specific either (rule 2). "Ring it if the max is
// small, otherwise show a bar" is a statement about numbers; it lands on
// Grit for WiW and on spell slots or ammo somewhere else.

/** Past this, a ring of numbers stops being countable and becomes noise. */
const RING_LIMIT = 12;

/**
 * What the skills block calls itself.
 *
 * The one heading on this card teller supplies rather than reads off the
 * data — Health and Grit are counter names, Statuses is the campaign's
 * own word. It's named here because it's both the heading AND the key a
 * pack's caption is looked up under, and two copies of a string that
 * must match is one copy too many.
 */
const SKILLS_TITLE = 'Skills';

/**
 * The sheet's own control: the numbers, marked up to where you are.
 *
 * Tapping the number you're already on steps back one, so the ring can
 * reach zero without a separate control — the same gesture a row of
 * stars uses, and it means the whole range is one touch away in both
 * directions.
 */
function NumberRing({
  counter,
  onChange,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
}) {
  const max = counter.max!;
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1;
        const marked = n <= counter.current;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ ...counter, current: n === counter.current ? n - 1 : n })}
            aria-label={`set ${counter.name} to ${n === counter.current ? n - 1 : n}`}
            aria-pressed={marked}
            className={`flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm transition-colors ${
              marked ? 'text-stone-950' : 'border-stone-700 text-stone-500 hover:border-stone-500'
            }`}
            style={
              marked
                ? {
                    background: 'var(--sheet-accent, #f59e0b)',
                    borderColor: 'var(--sheet-accent, #f59e0b)',
                  }
                : undefined
            }
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** A boxed resource, the way the sheet prints Health. */
function SheetGauge({
  counter,
  onChange,
}: {
  counter: Counter;
  onChange: (next: Counter) => void;
}) {
  const ringable = counter.max! <= RING_LIMIT;
  return (
    // `inline-size`, NOT `size`. `container-type: size` applies size
    // containment in BOTH axes, which means the box stops taking its
    // height from its contents — fine when a grid row fixes the height,
    // fatal here, where rows are content-sized: every tile collapsed and
    // the rings drew on top of each other.
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-stone-700 bg-stone-900/60 p-2.5"
      style={{ containerType: 'inline-size' }}
    >
      <div className="flex items-baseline gap-2">
        <Name
          counter={counter}
          className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400"
        />
        <Refill counter={counter} onChange={onChange} />
      </div>

      {ringable ? (
        <div className="flex flex-1 items-center justify-center">
          <NumberRing counter={counter} onChange={onChange} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          <div className="flex items-end gap-2">
            <Value
              counter={counter}
              className="leading-none"
              style={{ fontSize: '2rem' }}
            />
          </div>
          <Bar counter={counter} thick />
          <div className="flex gap-1.5">
            <Step
              sign="−"
              className="h-9 flex-1"
              label={`decrease ${counter.name}`}
              onClick={() => onChange(bumped(counter, -1))}
            />
            <Step
              sign="+"
              className="h-9 flex-1"
              label={`increase ${counter.name}`}
              onClick={() => onChange(bumped(counter, 1))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function Sheet({
  counters,
  onChange,
  fields = [],
  dice,
  groups,
  accents,
  pins,
  dials,
  tags = [],
  onTags,
  conditions = [],
  conditionsLabel = 'Conditions',
  lookup,
  note,
  strip = false,
  mounted = false,
  use,
  screens,
  onSpend,
  items = [],
  onItems,
  itemsLabel = 'Items',
  packs = [],
  ownCatalog,
}: CounterViewProps) {
  const { gauges, tallies } = split(counters);
  const update = (next: Counter) =>
    onChange(counters.map((c) => (c.id === next.id ? next : c)));

  // The sheet's SKILLS panel is a declared set, not "every stat" — see
  // `SystemTemplate.groups`. WiW's holds exactly Charm, Finesse,
  // Intuition and Nerve; Trade names the character, Defense sits beside
  // Health, and Speed has no block on this half of the page yet.
  const skillKeys = groups?.skills;
  const skills = skillKeys
    ? skillKeys
        .map((key) => fields.find((f) => f.key === key))
        .filter((f): f is NonNullable<typeof f> => Boolean(f))
    : fields;
  // The field that names the role, and with it the sheet's colour. Both
  // declared: `groups.title` says which field, `accents` maps its value.
  const titleKey = groups?.title?.[0];
  const title = titleKey ? fields.find((f) => f.key === titleKey) : undefined;
  const accent = (title?.value && accents?.[title.value.trim()]) || undefined;

  // Fields the system pinned into a counter's own panel (WiW: Defense
  // lives inside HEALTH). Looked up per counter so a system can pin to
  // several, and so a pin naming a field nobody has just does nothing.
  const pinnedTo = (counter: Counter): Field[] =>
    (pins?.[counter.name] ?? [])
      .map((key) => fields.find((f) => f.key === key))
      .filter((f): f is Field => Boolean(f));

  // A gauge with pinned fields gets the sheet's own panel for it; the
  // rest keep the generic tile. Nothing is game-specific — "has pins"
  // is a fact about the declaration, not about Health.
  const panelled = gauges.filter((c) => pinnedTo(c).length > 0);
  // A counter the system asked to be drawn with a face of its own — and
  // only when its shape suits one, so a declaration can't produce a
  // hundred-chamber revolver.
  const dialled = gauges.filter(
    (c) => !pinnedTo(c).length && dials?.[c.name] === 'cylinder' && dialable(c),
  );
  /**
   * Has this system said where anything goes on its sheet?
   *
   * The gate that lets this layout be built a block at a time without
   * breaking systems it was never drawn for. A system that has declared
   * homes is one whose sheet is being designed, so it gets EXACTLY the
   * declared blocks and nothing else — an undrawn counter waits rather
   * than appearing as a loose tile, because a designed page with three
   * strays taped to the edge looks worse than a page missing a block.
   *
   * A system that has declared nothing has no sheet to be partway
   * through, so it keeps the generic treatment and everything shows.
   * That preserves the promise made for `groups`: nothing disappears for
   * want of a declaration.
   *
   * The stakes are low either way — the counters are untouched, and
   * every other layout still shows the lot.
   */
  const designed =
    Object.keys(pins ?? {}).length > 0 || Object.keys(dials ?? {}).length > 0;

  /** Fields with no block of their own. Only shown on an undesigned sheet. */
  const allPinned = new Set(Object.values(pins ?? {}).flat());
  const rest = fields.filter(
    (f) =>
      !(skillKeys ?? []).includes(f.key) &&
      f.key !== titleKey &&
      !allPinned.has(f.key),
  );

  /**
   * Counters and stats with no block of their own yet.
   *
   * On a designed sheet these move to a screen of their own rather than
   * being hidden — which is the whole reason the seat became several
   * screens. On an undeclared one they stay where they always were, on
   * the only screen there is.
   */
  // A counter a declared screen claims (the Ace tally on Abilities) has
  // a home there — it must not ALSO haunt the spare screen.
  const claimedCounters = new Set(
    (screens ?? []).flatMap((s) => s.counters ?? []),
  );
  const homeless = gauges.filter(
    (c) =>
      !pinnedTo(c).length &&
      !dialled.includes(c) &&
      !claimedCounters.has(c.name),
  );
  const plain = designed ? [] : homeless;
  const strays = designed
    ? []
    : tallies.filter((c) => !claimedCounters.has(c.name));
  const spare = designed
    ? {
        gauges: homeless,
        tallies: tallies.filter((c) => !claimedCounters.has(c.name)),
        fields: rest,
      }
    : { gauges: [], tallies: [], fields: [] };
  const hasSpare =
    spare.gauges.length + spare.tallies.length + spare.fields.length > 0;

  // Screen one: the blocks the page has actually been drawn for.
  const drawn = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Every block is a SIBLING in one wrapping row, in the page's own
          order: Skills, Health, Grit, Statuses.

          Flat rather than nested, and that one change serves both kinds
          of glass. On the rail bar there is width to spare and height is
          the scarce thing, so four blocks side by side beat three with
          two of them stacked — stacking spends the dimension there is
          least of. On a phone the row simply wraps, and wrapping a flat
          list gives the same single column a nested one did.

          Symmetry still holds, it's just paired now: the outer two match
          each other and the inner two match each other, so the
          composition has a centre line even though no single panel sits
          on it.

          A flex row rather than an auto-fit grid because these are not
          equal — auto-fit hands every column the same track, and Grit is
          a circle while Skills is four rows of dice. */}
      <div
        className={`flex min-h-0 flex-1 flex-wrap gap-2 ${
          strip ? 'items-stretch' : 'content-start'
        }`}
      >
        <div
          className={`flex min-w-[13rem] flex-[1.25] flex-col gap-2 ${
            strip ? 'self-stretch' : 'self-start'
          }`}
        >
          {/* Title passed explicitly rather than left to the default, so
              the heading and the caption are looked up under one string
              instead of two that have to stay equal. */}
          <SkillPanel
            fields={skills}
            dice={dice}
            lookup={lookup}
            title={SKILLS_TITLE}
            note={note?.(SKILLS_TITLE)}
            fill={strip}
          />
          {/* Stats with no block of their own — Speed, for WiW — used to
              hang here as loose chips, and don't any more for the same
              reason as the counters. A system with no declared sheet
              still shows everything: `ownsFields` is what makes the card
              skip its own stat strip, and it only applies to layouts
              that place fields themselves. */}
          {!designed && rest.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {rest.map((field) => (
                <span
                  key={field.key}
                  className="rounded-md bg-stone-900 px-2 py-1 text-xs"
                >
                  <span className="font-mono text-stone-100">
                    {field.value || '—'}
                  </span>
                  <span className="ml-1 uppercase tracking-wider text-stone-500">
                    {field.label}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* On a STRIP each vital gets its own column, because 515px of
            height cannot stack two panels and width is what there is
            spare of. Anywhere taller they stack in one column, which is
            how the page prints them and what a tablet has the height
            for. Same components either way — only the arrangement and
            Health's own orientation change. */}
        {strip ? (
          <>
            {panelled.map((counter) => (
              <div
                key={counter.id}
                className="flex min-w-[9rem] flex-[0.8] flex-col gap-2 self-stretch"
              >
                <HealthPanel
                  counter={counter}
                  pinned={pinnedTo(counter)}
                  onChange={update}
                  note={note?.(counter.name)}
                  vertical
                  fill
                />
              </div>
            ))}
            {dialled.map((counter) => (
              <div
                key={counter.id}
                className="flex min-w-[10rem] flex-[0.85] flex-col gap-2 self-stretch"
              >
                <Cylinder
                  counter={counter}
                  onChange={update}
                  note={note?.(counter.name)}
                  fill
                />
              </div>
            ))}
          </>
        ) : (
          (panelled.length > 0 || dialled.length > 0) && (
            <section className="flex min-w-[13rem] flex-[1.35] flex-col gap-2 self-start">
              {panelled.map((counter) => (
                <HealthPanel
                  key={counter.id}
                  counter={counter}
                  pinned={pinnedTo(counter)}
                  onChange={update}
                  note={note?.(counter.name)}
                />
              ))}
              {dialled.map((counter) => (
                <Cylinder
                  key={counter.id}
                  counter={counter}
                  onChange={update}
                  note={note?.(counter.name)}
                />
              ))}
            </section>
          )
        )}
        {plain.length > 0 && (
          <div
            className="grid min-w-[12rem] flex-1 gap-2 self-start"
            // A ring is as tall as it is; stretching the row just puts
            // a void above and below it. Content-sized rows keep the
            // boxes tight, which is also how they sit on paper.
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
              gridAutoRows: 'minmax(0, max-content)',
            }}
          >
            {plain.map((counter) => (
              <SheetGauge key={counter.id} counter={counter} onChange={update} />
            ))}
          </div>
        )}
        {/* Matched to Skills, not sized to its own content, so the pair
            of outer columns stays symmetric. */}
        {onTags && (
          <div
            className={`flex min-w-[13rem] flex-[1.25] flex-col gap-2 ${
              strip ? 'self-stretch' : 'self-start'
            }`}
          >
            <StatusPanel
              entries={conditions}
              tags={tags}
              onChange={onTags}
              title={conditionsLabel}
              note={note?.(conditionsLabel)}
              relievers={skills.map((f) => f.label)}
              fill={strip}
            />
          </div>
        )}
      </div>

      {/* The generic strip, for a system with no declared sheet. On a
          designed one these live on the spare screen instead. */}
      {strays.length > 0 && (
        <div
          className="grid shrink-0 gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}
        >
          {strays.map((counter) => (
            <div
              key={counter.id}
              className="flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
                <Name
                  counter={counter}
                  className="text-[10px] uppercase tracking-widest text-stone-500"
                />
                <Value counter={counter} className="text-base" />
              </div>
              <Step
                sign="−"
                label={`decrease ${counter.name}`}
                onClick={() => update(bumped(counter, -1))}
              />
              <Step
                sign="+"
                label={`increase ${counter.name}`}
                onClick={() => update(bumped(counter, 1))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /**
   * Screen two: everything the page hasn't been drawn for yet.
   *
   * A holding pen, and named so — it is NOT a design, it's the honest
   * answer to "where did my Wallet go" while the lower half of the sheet
   * is still being built. As Weapons, Abilities and the rest get their
   * blocks, they leave here for screens of their own and this shrinks to
   * nothing, at which point the bar goes back to one segment and
   * disappears on its own.
   */
  const spareScreen = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {spare.fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {spare.fields.map((field) => (
            <span
              key={field.key}
              className="rounded-md bg-stone-900 px-2 py-1 text-xs"
            >
              <span className="font-mono text-stone-100">
                {field.value || '—'}
              </span>
              <span className="ml-1 uppercase tracking-wider text-stone-500">
                {field.label}
              </span>
            </span>
          ))}
        </div>
      )}

      {spare.gauges.length > 0 && (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
            gridAutoRows: 'minmax(0, max-content)',
          }}
        >
          {spare.gauges.map((counter) => (
            <SheetGauge key={counter.id} counter={counter} onChange={update} />
          ))}
        </div>
      )}

      {spare.tallies.length > 0 && (
        <div
          className="grid shrink-0 gap-1.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}
        >
          {spare.tallies.map((counter) => (
            <div
              key={counter.id}
              className="flex items-center gap-1.5 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
                <Name
                  counter={counter}
                  className="text-[10px] uppercase tracking-widest text-stone-500"
                />
                <Value counter={counter} className="text-base" />
              </div>
              <Step
                sign="−"
                label={`decrease ${counter.name}`}
                onClick={() => update(bumped(counter, -1))}
              />
              <Step
                sign="+"
                label={`increase ${counter.name}`}
                onClick={() => update(bumped(counter, 1))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  /**
   * The things the character carries, on a screen of their own.
   *
   * Their own screen rather than a block on the first one, because the
   * printed page gives WEAPONS half a page and the strip has four
   * columns already spoken for. Each item is a panel and they wrap the
   * same way the sheet's blocks do — three weapons across a rail bar,
   * one under another on a phone.
   */
  /**
   * The character's consumable pools, as the system names them
   * (`use.consumesKind`). What a weapon's chamber select offers, and
   * what a fire spends from — a character-level pool by the book: two
   * weapons loaded with the same box of rounds spend from one count.
   */
  const pools = use?.consumesKind
    ? items.filter((i) => i.kind === use.consumesKind)
    : [];

  /**
   * The system's per-turn moves (WiW's Aim), armed and spent.
   *
   * Armed is INTENT — the reticle lights, the fire buttons reprice, and
   * nothing is written anywhere until the trigger goes (deduct-at-fire,
   * as agreed: an armed-then-abandoned Aim costs nothing, and a table
   * that rules it should is one cylinder tap from charging it).
   *
   * Spent is the once-per-turn lock, and its release is DERIVED: the
   * cost counter going UP is what "your turn came back around" looks
   * like in the data — the cylinder's ↻, the console's stepper, an SSE
   * edit from across the room all read the same. Local state, on
   * purpose: whether you've aimed is the player's own reminder; the
   * Grit spend is the shared truth.
   */
  const costCounter = counters.find((c) => c.name === use?.costCounter);
  const available = costCounter?.current;
  const [armed, setArmed] = useState<string[]>([]);
  const [spentActs, setSpentActs] = useState<string[]>([]);
  const lastAvail = useRef(available);
  useEffect(() => {
    if (
      available !== undefined &&
      lastAvail.current !== undefined &&
      available > lastAvail.current
    ) {
      setSpentActs([]);
    }
    lastAvail.current = available;
  }, [available]);

  const acts = use?.actions ?? [];
  const armedCost = acts
    .filter((a) => armed.includes(a.name))
    .reduce((n, a) => n + a.cost, 0);

  /**
   * One squeeze of the trigger: debit the cost counter, and one round
   * off whatever's chambered — in a SINGLE write, so it's one event and
   * one /undo. `bumped` clamps at zero the same as a stepper would;
   * teller never invents Grit or rounds that aren't there, and never
   * blocks the shot either — whether you could afford it is the
   * table's argument, not teller's (rule 1).
   */
  const fire = (item: Item, cost: number) => {
    if (!use || !onSpend) return;
    // One squeeze: the weapon's cost AND every armed action, together —
    // Aim's Grit rides on the shot it improves.
    const total = cost + armedCost;
    const next: { counters?: Counter[]; items?: Item[] } = {};
    if (costCounter) {
      next.counters = counters.map((c) =>
        c.name === use.costCounter ? bumped(c, -total) : c,
      );
    }
    const pool = item.loaded ? pools.find((p) => p.id === item.loaded) : undefined;
    if (pool && pool.counters.length) {
      next.items = items.map((i) =>
        i.id === pool.id
          ? { ...i, counters: [bumped(i.counters[0], -1), ...i.counters.slice(1)] }
          : i,
      );
    }
    onSpend(next);
    if (armed.length) {
      setSpentActs([...spentActs, ...armed]);
      setArmed([]);
    }
  };

  /**
   * The carried screens, as the SYSTEM declares them (`screens` —
   * WiW: Weapons, then Abilities with the Ace tally alongside). No
   * declaration = one screen holding everything, exactly as before.
   *
   * A kind no screen claims lands on the FIRST screen rather than
   * vanishing: nothing a person carries may disappear over a missing
   * declaration (the `groups` promise again).
   */
  const shelfDefs: NonNullable<CounterViewProps['screens']> = screens?.length
    ? screens
    : [{ name: itemsLabel, kinds: [] }];
  const claimedKinds = new Set((screens ?? []).flatMap((s) => s.kinds));
  const shelfItems = (
    def: (typeof shelfDefs)[number],
    first: boolean,
  ): Item[] =>
    screens?.length
      ? items.filter(
          (i) =>
            def.kinds.includes(i.kind ?? '') ||
            (first && !claimedKinds.has(i.kind ?? '')),
        )
      : items;

  const itemRow = (
    row: Item[],
    lead?: React.ReactNode,
    // The chamber select is offered only where the pools LIVE — an
    // Ability is fireable (it costs Grit) but nothing loads into a
    // speech. The fighting screen passes the pools; others pass none.
    chamber: Item[] = [],
  ) => (
    <div
      className={`flex min-h-0 flex-wrap gap-2 ${
        strip ? 'flex-1 items-stretch' : 'content-start'
      }`}
    >
      {lead}
      {row.map((item) => (
        <div
          key={item.id}
          className={`flex min-w-[15rem] flex-1 flex-col gap-2 ${
            strip ? 'self-stretch' : 'self-start'
          }`}
        >
          <ItemPanel
            item={item}
            dice={dice}
            packs={packs}
            ownCatalog={ownCatalog}
            fill={strip}
            use={use}
            ammo={chamber}
            extraCost={armedCost}
            available={available}
            onFire={onSpend ? (cost) => fire(item, cost) : undefined}
            onChange={(next) =>
              onItems?.(items.map((i) => (i.id === next.id ? next : i)))
            }
          />
        </div>
      ))}
    </div>
  );

  /* The turn's moves, once per fighting screen — Aim is a global
     once-per-turn Action (Guidebook p. 41), not a property of any
     weapon. Arm the reticle and every trigger reprices; the spend
     happens on the shot. It renders on the screen that holds the
     consumable pools — data deciding again, not a screen name. */
  const actionRow = acts.length > 0 && onSpend && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {acts.map((action) => {
            const isArmed = armed.includes(action.name);
            const isSpent = spentActs.includes(action.name);
            const broke =
              available !== undefined && !isArmed && available < action.cost;
            return (
              <div key={action.name} className="flex items-center gap-2">
                <Reticle
                  armed={isArmed}
                  spent={isSpent}
                  disabled={broke}
                  label={`${action.name}: +${action.cost} ${use?.costCounter} on your next shot. ${action.text ?? ''}`}
                  onToggle={() =>
                    setArmed(
                      isArmed
                        ? armed.filter((n) => n !== action.name)
                        : [...armed, action.name],
                    )
                  }
                />
                <div className="flex flex-col">
                  <span
                    className="text-[0.7rem] font-bold uppercase tracking-[0.14em]"
                    style={{
                      color: isArmed
                        ? 'var(--sheet-accent, #f59e0b)'
                        : '#a8a29e',
                    }}
                  >
                    {action.name}
                    <span className="ml-1.5 font-mono font-normal normal-case text-stone-500">
                      +{action.cost} {use?.costCounter}
                    </span>
                  </span>
                  <span className="text-[0.65rem] leading-tight text-stone-500">
                    {isSpent
                      ? `used this turn — back when your ${use?.costCounter} reloads`
                      : action.text}
                  </span>
                </div>
              </div>
            );
          })}
    </div>
  );

  /**
   * One carried screen: its declared counters as panels in the same
   * wrapping row as its items (the Ace tally stands beside the
   * abilities it unlocks), consumable pools beneath their own rule —
   * the printed page's split, grouped by the template's `consumesKind`.
   */
  const carriedScreen = (
    def: (typeof shelfDefs)[number],
    first: boolean,
  ) => {
    const mine = shelfItems(def, first);
    const minePools = mine.filter((i) => pools.includes(i));
    const mineRest = mine.filter((i) => !pools.includes(i));
    const tallyPanels = (def.counters ?? [])
      .map((name) => counters.find((c) => c.name === name))
      .filter((c): c is Counter => Boolean(c))
      .map((c) => (
        <div
          key={c.id}
          className={`flex min-w-[15rem] flex-1 flex-col gap-2 ${
            strip ? 'self-stretch' : 'self-start'
          }`}
        >
          <TallyPanel
            counter={c}
            note={note?.(c.name)}
            onChange={update}
            fill={strip}
          />
        </div>
      ));
    const fighting =
      !screens?.length ||
      (use?.consumesKind != null && def.kinds.includes(use.consumesKind));
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {fighting && actionRow}
        {itemRow(
          mineRest,
          tallyPanels.length ? tallyPanels : undefined,
          fighting ? pools : [],
        )}
        {minePools.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
                {use?.consumesKind}
              </span>
              <div className="h-px flex-1 bg-stone-800" />
            </div>
            {itemRow(minePools)}
          </>
        )}
      </div>
    );
  };

  return (
    // The accent rides on a CSS variable rather than a prop threaded
    // through every box: a themed sheet tints a dozen small things, and
    // passing a colour to each of them is how one gets missed. It's on
    // the ROOT so the segmented bar is tinted too — the bar belongs to
    // the card, not to any one screen.
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      style={
        {
          '--sheet-accent': accent ?? '#f59e0b',
          containerType: 'inline-size',
        } as React.CSSProperties
      }
    >
      {/* Outside the screens: whose card this is doesn't change when you
          swipe, and it carries the colour. */}
      <TradePlate field={title} accent={accent} />

      <Screens
        mounted={mounted}
        screens={[
          { name: 'Sheet', render: () => drawn },
          // A declared screen appears when it has something to show —
          // items, or a claimed counter the character actually has. An
          // empty screen advertises somewhere to go and then shows
          // nothing.
          ...shelfDefs.flatMap((def, i) => {
            if (!onItems) return [];
            const populated =
              shelfItems(def, i === 0).length > 0 ||
              (def.counters ?? []).some((name) =>
                counters.some((c) => c.name === name),
              );
            return populated
              ? [{ name: def.name, render: () => carriedScreen(def, i === 0) }]
              : [];
          }),
          ...(hasSpare ? [{ name: 'More', render: () => spareScreen }] : []),
        ]}
      />
    </div>
  );
}

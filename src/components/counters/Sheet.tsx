import type { Counter, Field } from '../../../worker/types';
import { HealthPanel } from '../sheet/HealthPanel';
import { Cylinder, dialable } from '../sheet/Cylinder';
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
              style={{ fontSize: 'clamp(1.25rem, 26cqw, 3.5rem)' }}
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

  const plain = designed
    ? []
    : gauges.filter((c) => !pinnedTo(c).length && !dialled.includes(c));
  const strays = designed ? [] : tallies;

  return (
    // The accent rides on a CSS variable rather than a prop threaded
    // through every box: a themed sheet tints a dozen small things, and
    // passing a colour to each of them is how one gets missed.
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      style={
        {
          '--sheet-accent': accent ?? '#f59e0b',
          containerType: 'inline-size',
        } as React.CSSProperties
      }
    >
      <TradePlate field={title} accent={accent} />
      {/* The page's three blocks, in the page's order: Skills, then the
          vitals, then Statuses.

          The two OUTER columns are deliberately identical — same basis,
          same grow, same minimum — because that is the only way the
          middle one is actually centred. Give the sides different widths
          and the vitals sit off-axis by half the difference, which on
          this card reads as a mistake even when nobody can say why.
          Symmetry costs Statuses a little width it doesn't need, and
          buys a centre line the eye can trust.

          A flex row rather than an auto-fit grid so the middle can be
          wider than the sides — auto-fit hands every column the same
          track. Wrapping replaces the grid's collapse: on a phone they
          stack, in the same order. */}
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2">
        <div className="flex min-w-[13rem] flex-1 flex-col gap-2 self-start">
          {/* Title passed explicitly rather than left to the default, so
              the heading and the caption are looked up under one string
              instead of two that have to stay equal. */}
          <SkillPanel
            fields={skills}
            dice={dice}
            lookup={lookup}
            title={SKILLS_TITLE}
            note={note?.(SKILLS_TITLE)}
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

        {gauges.length > 0 && (
          <section
            className="flex min-w-[13rem] flex-[1.35] flex-col gap-2 self-start"
            style={{ containerType: 'inline-size' }}
          >
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
            <div
              className="grid min-h-0 gap-2"
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
          </section>
        )}
        {/* Third column — matched to the first, not sized to its own
            content, so the vitals stay on the centre line. */}
        {onTags && (
          <div className="flex min-w-[13rem] flex-1 flex-col gap-2 self-start">
            <StatusPanel
              entries={conditions}
              tags={tags}
              onChange={onTags}
              title={conditionsLabel}
              note={note?.(conditionsLabel)}
              relievers={skills.map((f) => f.label)}
            />
          </div>
        )}
      </div>

      {/* The generic strip, for a system with no declared sheet. WiW's
          Wallet, Scrap and Prestige do NOT appear here — they have real
          homes further down the printed page, and a chip strip pretending
          to be that home is what made the card look unfinished. */}
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
}

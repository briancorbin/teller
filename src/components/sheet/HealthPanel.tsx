import type { Counter, Field } from '../../../worker/types';
import { bumped, fill as fraction, isLow, Refill } from '../counters/shared';
import { SheetPanel } from './SheetPanel';

// The HEALTH block: the resource, flanked by the two numbers that bound
// it — the ceiling on one side, Defense on the other.
//
// **This one deliberately departs from the paper**, and it's worth saying
// why. On the sheet the middle of this panel is a long blank strip, and a
// filled-in example shows what actually goes there: `7`, struck through,
// then `8`. It's a scratch trail — a running history — because paper
// cannot change a number in place. A screen can. Reproducing the trail
// would be copying paper's limitation and calling it design.
//
// So the strip becomes the live control, and everything around it stays
// exactly as printed:
//
//   * `max` keeps its own box, and keeps the accent border the sheet
//     gives it — it's the one number on the panel you set rather than
//     spend.
//   * `def` keeps its box on the right. It holds a die pool written as
//     text ("2B"), and the sheet gives it no track, so neither do we.
//   * the middle holds the current value, a bar, and the two controls,
//     sized for a thumb rather than a pencil.
//
// The history isn't lost by dropping the trail — every change already
// appends to the event log (rule 3). Rendering it is TEL-5's job, and a
// second half-version of it inside this panel would be the wrong place.
//
// Nothing here is game-specific (rule 2). "A gauge with some fields
// pinned beside it" is a shape; `SystemTemplate.pins` says which.

/**
 * The height every box on the row shares — max, the strip, def, and both
 * controls.
 *
 * Explicit rather than emergent. Letting each box take its height from
 * its own contents made the strip (one huge numeral) taller than the two
 * flanking boxes (one small one), so the row read as three unrelated
 * things instead of one instrument. The font clamps below are all kept
 * under `height / 1.15` so nothing can outgrow it.
 */
const BOX_H = '3rem';

/** One of the small flanking boxes: value big, label under it. */
function StatBox({
  value,
  label,
  accented,
}: {
  value: string;
  label: string;
  /** The sheet rules `max` in the trade's colour and leaves `def` plain. */
  accented?: boolean;
}) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-center gap-0.5">
      <div
        className="flex min-w-[2.8rem] items-center justify-center rounded-[3px] border-2 px-1.5"
        style={{
          height: BOX_H,
          borderColor: accented ? 'var(--sheet-accent, #f59e0b)' : '#a8a29e',
        }}
      >
        <span className="whitespace-nowrap font-mono text-[1.1rem] tabular-nums text-stone-100">
          {value}
        </span>
      </div>
      {/* Never truncated — a label that's been cut off is a label that
          says something else. It wraps, and the card scales to fit. */}
      <span className="max-w-[4.5rem] break-words text-center text-[9px] uppercase leading-tight tracking-[0.18em] text-stone-500">
        {label}
      </span>
    </div>
  );
}

/** A big square control. Sized for a rail panel, not a mouse. */
function Bump({
  sign,
  label,
  onClick,
  grow,
}: {
  sign: '−' | '+';
  label: string;
  onClick: () => void;
  /** Share the width of the column rather than staying square. */
  grow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={grow ? { height: BOX_H } : { height: BOX_H, width: BOX_H }}
      className={`flex select-none items-center justify-center rounded-md border border-stone-600 bg-stone-800 text-2xl leading-none text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-600 active:text-stone-950 ${
        grow ? 'min-w-0 flex-1' : 'shrink-0'
      }`}
    >
      {sign}
    </button>
  );
}

export function HealthPanel({
  counter,
  pinned,
  onChange,
  title,
  note,
  vertical = false,
  fill = false,
}: {
  counter: Counter;
  /** Fields the system pinned to this counter — Defense, for WiW. */
  pinned: Field[];
  onChange: (next: Counter) => void;
  /** The sheet's own heading. Defaults to the counter's name. */
  title?: string;
  /** Pack-supplied instruction line. Nothing in this repo supplies one. */
  note?: string;
  /**
   * Stack the row instead of laying it out across.
   *
   * Not a different design — the same five parts in the same order, read
   * top-to-bottom instead of left-to-right. It exists because of what
   * the rail bar measures: with four blocks side by side, Health took
   * 430px of width while using 143px of a row 336px tall. Stacking
   * spends the dimension there is spare of and hands ~200px back to the
   * two blocks that are lists.
   *
   * Printed sheets lay it across, and on a phone so does this. The bar
   * is the shape paper never had to deal with.
   */
  vertical?: boolean;
  /** Grow to fill the column — see `SheetPanel`. */
  fill?: boolean;
}) {
  const low = isLow(counter);

  return (
    <SheetPanel title={title ?? counter.name} note={note} fill={fill}>
      <div
        className={`flex justify-center gap-2 ${
          vertical ? 'flex-col items-stretch' : 'items-start'
        }`}
      >
        {counter.max !== null && (
          // Read-only here on purpose: raising a ceiling is a character
          // change, not a play action, and it belongs with the editor
          // the console already has. Rule 1 is satisfied by that being
          // reachable, not by every surface growing a field.
          <StatBox value={String(counter.max)} label="max" accented />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Stacked, the controls move under the number rather than
              flanking it — side-by-side steppers in a narrow column
              would each be a sliver. */}
          <div
            className={`flex gap-1.5 ${
              vertical ? 'flex-col items-stretch' : 'items-center'
            }`}
          >
            {!vertical && (
              <Bump
                sign="−"
                label={`decrease ${counter.name}`}
                onClick={() => onChange(bumped(counter, -1))}
              />
            )}
            {/* The strip. Where the trail of struck-through numbers went
                on paper, the current one simply lives. */}
            <div
              className="flex min-w-0 flex-1 items-center justify-center rounded-[3px] border-2 border-stone-400 px-2"
              style={{ height: BOX_H }}
            >
              <span
                // Not `leading-none` — at this size the digits' own em
                // box is smaller than the glyphs, so the line box clips
                // them by a couple of pixels. Same bug the trade plate
                // had; it is invisible in a screenshot and obvious to
                // the overflow assertion.
                className={`whitespace-nowrap font-mono tabular-nums leading-[1.15] ${
                  low ? 'text-red-400' : 'text-stone-100'
                }`}
                // Capped so `fontSize × 1.15` stays inside `BOX_H` at
                // both ends of the clamp — that's what keeps a fixed
                // height from becoming a clipped one.
                style={{ fontSize: '2rem' }}
              >
                {counter.current}
              </span>
            </div>
            {vertical ? (
              <div className="flex gap-1.5">
                <Bump
                  sign="−"
                  label={`decrease ${counter.name}`}
                  onClick={() => onChange(bumped(counter, -1))}
                  grow
                />
                <Bump
                  sign="+"
                  label={`increase ${counter.name}`}
                  onClick={() => onChange(bumped(counter, 1))}
                  grow
                />
              </div>
            ) : (
              <Bump
                sign="+"
                label={`increase ${counter.name}`}
                onClick={() => onChange(bumped(counter, 1))}
              />
            )}
          </div>

          {counter.max !== null && (
            <div className="flex items-center gap-1.5">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: `${fraction(counter) * 100}%`,
                    background: low ? '#ef4444' : 'var(--sheet-accent, #f59e0b)',
                  }}
                />
              </div>
              <Refill counter={counter} onChange={onChange} />
            </div>
          )}
        </div>

        {pinned.map((field) => (
          <StatBox key={field.key} value={field.value || '—'} label={field.label} />
        ))}
      </div>
    </SheetPanel>
  );
}

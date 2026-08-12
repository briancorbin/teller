import { useState } from 'react';
import type { Character } from '../../worker/types';
import { SEAT_LAYOUTS, layoutOf, type SeatLayout } from '../lib/seat-layouts';
import { card, input, sectionLabel } from '../lib/ui';
import { SeatView } from '../views/SeatView';
import {
  CARD_INCHES,
  SEAT_SIZES,
  SizeFrame,
  getScreenPpi,
  setScreenPpi,
  type SeatSize,
} from './SizeFrame';

// The seat, rendered on glass you don't own yet — the console's rig
// for two decisions the table keeps having to make: which LAYOUT suits
// a player, and which PANEL is worth buying. It used to live on the
// seat itself; it moved here by ruling (2026-08-12) — a screen renders
// its assignment and doesn't negotiate it, so every knob about a seat
// belongs on the console.
//
// Everything here is a viewing aid, local and ephemeral — nothing
// writes to any display. The one exception to ephemerality is the
// calibration: this screen's CSS px/inch is a fact about the monitor,
// so it persists (see `SizeFrame`).
//
// TRUE SIZE: a preset that knows its physical inches can render at
// them, so a candidate bar is judged with eyes before hardware is
// bought. Browser pixels lie about inches and no web API tells the
// truth, so the missing number comes from a person once: drag an
// on-screen credit card until it matches a real one.

export function SeatPreview({ characters }: { characters: Character[] }) {
  const [open, setOpen] = useState(false);
  const [characterId, setCharacterId] = useState('');
  const [layout, setLayout] = useState<SeatLayout>(layoutOf(null));
  const [size, setSize] = useState<NonNullable<SeatSize>>(
    SEAT_SIZES.find((s) => s.id === 'rail') ?? SEAT_SIZES[0],
  );
  const [ppi, setPpi] = useState<number | null>(() => getScreenPpi());
  // Off by default: the stage is a slice of the console, so true size
  // usually clips — it's a deliberate act, not a starting state.
  const [trueSize, setTrueSize] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [ppiDraft, setPpiDraft] = useState(() => getScreenPpi() ?? 110);

  const chosen = characterId || characters[0]?.id || '';

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex items-baseline gap-2">
        <span className={sectionLabel}>Preview a seat</span>
        <span className="text-xs text-stone-600">
          any card, on any glass — including glass you're deciding whether
          to buy
        </span>
        <button
          className="ml-auto font-mono text-xs text-stone-500 underline-offset-2 hover:text-amber-300 hover:underline"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? 'close' : 'open'}
        </button>
      </div>

      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={input}
              value={chosen}
              onChange={(e) => setCharacterId(e.target.value)}
              aria-label="whose card to preview"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className={input}
              value={layout}
              onChange={(e) => setLayout(layoutOf(e.target.value))}
              aria-label="which arrangement to preview"
            >
              {SEAT_LAYOUTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} — {option.blurb}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SEAT_SIZES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSize(option)}
                aria-pressed={size.id === option.id}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  size.id === option.id
                    ? 'bg-amber-700 text-stone-950'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
              >
                {option.name}
                <span
                  className={`ml-1.5 font-mono ${
                    size.id === option.id ? 'text-stone-800' : 'text-stone-500'
                  }`}
                >
                  {option.w}×{option.h}
                </span>
              </button>
            ))}
          </div>

          {/* Physical truth, offered only when the chosen preset knows
              its inches. Uncalibrated, the toggle explains itself and
              opens the card instead of silently doing nothing. */}
          {size.inches && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  ppi ? setTrueSize(!trueSize) : setCalibrating(true)
                }
                aria-pressed={Boolean(ppi) && trueSize}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  ppi && trueSize
                    ? 'bg-amber-700 text-stone-950'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
              >
                ⌖ True size
                <span
                  className={`ml-1.5 font-mono ${
                    ppi && trueSize ? 'text-stone-800' : 'text-stone-500'
                  }`}
                >
                  {size.inches.w.toFixed(1)}″×{size.inches.h.toFixed(1)}″
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPpiDraft(ppi ?? 110);
                  setCalibrating(!calibrating);
                }}
                aria-expanded={calibrating}
                className="rounded-md px-2.5 py-1.5 text-xs text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
              >
                {ppi
                  ? `calibrated · ${Math.round(ppi)} px/in`
                  : 'calibrate this screen'}
              </button>
            </div>
          )}

          {calibrating && (
            <div className="space-y-2 rounded-md bg-stone-900 p-2">
              <p className="text-xs text-stone-400">
                Hold a real credit card against the screen and drag until the
                outline matches it. That teaches teller how big a pixel is on
                this monitor — once, ever.
              </p>
              <div
                className="flex items-center justify-center rounded-md border-2 border-dashed border-amber-500/70 bg-stone-800/40 text-[10px] uppercase tracking-widest text-stone-500"
                style={{
                  width: ppiDraft * CARD_INCHES.w,
                  height: ppiDraft * CARD_INCHES.h,
                }}
              >
                credit card
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="range"
                  min={70}
                  max={280}
                  step={0.5}
                  value={ppiDraft}
                  onChange={(e) => setPpiDraft(Number(e.target.value))}
                  aria-label="match the outline to a real credit card"
                  className="w-64 max-w-full accent-amber-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    setScreenPpi(ppiDraft);
                    setPpi(ppiDraft);
                    setTrueSize(true);
                    setCalibrating(false);
                  }}
                  className="rounded-md bg-amber-700 px-2.5 py-1.5 text-xs text-stone-950"
                >
                  matches
                </button>
                <button
                  type="button"
                  onClick={() => setCalibrating(false)}
                  className="rounded-md px-2.5 py-1.5 text-xs text-stone-500 hover:bg-stone-800"
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {/* The glass. A fixed-height stage the frame letterboxes into;
              the card inside is the REAL SeatView, live data and all —
              what the player would see, because it's the same code. */}
          {chosen ? (
            <div className="flex h-[26rem] flex-col overflow-hidden rounded-md">
              <SizeFrame size={size} ppi={trueSize ? ppi : null}>
                <SeatView
                  key={`${chosen}-${layout}`}
                  characterId={chosen}
                  layout={layout}
                  frame={size}
                />
              </SizeFrame>
            </div>
          ) : (
            <p className="text-sm text-stone-500">no characters yet</p>
          )}
        </>
      )}
    </section>
  );
}

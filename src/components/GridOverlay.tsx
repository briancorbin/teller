import { useState } from 'react';

// True-inch grid overlay for the table TV (v0 of the calibrated grid).
// Spacing is a property of the PHYSICAL DISPLAY, not the campaign, so
// it lives in this device's localStorage: calibrate once on the TV by
// holding a ruler (or a mini base) against the reference square.
// The full version (per-map alignment, fog, tokens) is the battlemap
// phase; this just puts honest squares on the glass.

const ON_KEY = 'teller.grid.on';
const PPI_KEY = 'teller.grid.ppi';

function readSettings() {
  return {
    on: localStorage.getItem(ON_KEY) === '1',
    ppi: Number(localStorage.getItem(PPI_KEY)) || 40,
  };
}

export function GridOverlay() {
  const [{ on, ppi }, setState] = useState(readSettings);
  const [open, setOpen] = useState(false);

  // Functional update so rapid ± taps never compute from a stale base.
  const save = (fn: (prev: { on: boolean; ppi: number }) => { on: boolean; ppi: number }) => {
    setState((prev) => {
      const next = fn(prev);
      localStorage.setItem(ON_KEY, next.on ? '1' : '0');
      localStorage.setItem(PPI_KEY, String(next.ppi));
      return next;
    });
  };

  const line = 'rgba(251, 191, 36, 0.22)'; // faint amber hairlines

  return (
    <>
      {on && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to right, ${line} 0 1px, transparent 1px 100%), linear-gradient(to bottom, ${line} 0 1px, transparent 1px 100%)`,
            backgroundSize: `${ppi}px ${ppi}px`,
          }}
        />
      )}

      {open ? (
        <div className="absolute bottom-4 right-4 z-50 w-64 space-y-3 rounded-2xl border border-stone-800 bg-stone-950/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-stone-500">
              Grid
            </span>
            <button
              className="rounded px-2 py-0.5 text-sm text-stone-400 hover:bg-stone-800"
              onClick={() => setOpen(false)}
            >
              done
            </button>
          </div>
          <button
            className={`w-full rounded-lg px-3 py-2 text-sm ${
              on ? 'bg-amber-700 text-stone-950' : 'bg-stone-800 text-stone-300'
            }`}
            onClick={() => save((p) => ({ ...p, on: !p.on }))}
          >
            {on ? 'grid on' : 'grid off'}
          </button>
          <div className="flex items-center justify-between gap-2">
            <button
              className="h-9 w-9 rounded-lg bg-stone-800 text-lg text-stone-200"
              onClick={() => save((p) => ({ ...p, ppi: Math.max(10, p.ppi - 0.5) }))}
              aria-label="smaller squares"
            >
              −
            </button>
            <span className="font-mono text-sm text-stone-300">
              {ppi.toFixed(1)} px/in
            </span>
            <button
              className="h-9 w-9 rounded-lg bg-stone-800 text-lg text-stone-200"
              onClick={() => save((p) => ({ ...p, ppi: p.ppi + 0.5 }))}
              aria-label="larger squares"
            >
              +
            </button>
          </div>
          <div className="space-y-1">
            <div
              className="border-2 border-amber-500"
              style={{ width: ppi, height: ppi }}
            />
            <p className="text-xs leading-snug text-stone-500">
              hold a ruler (or a mini base) to this square — adjust until it
              measures exactly 1 inch on the glass
            </p>
          </div>
        </div>
      ) : (
        <button
          className="absolute bottom-3 right-3 z-50 rounded-full bg-stone-950/60 px-3 py-1.5 font-mono text-xs text-stone-500 opacity-40 backdrop-blur transition-opacity hover:opacity-100"
          onClick={() => setOpen(true)}
          title="grid calibration (per display)"
        >
          ▦ grid
        </button>
      )}
    </>
  );
}

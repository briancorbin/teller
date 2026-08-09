// True-inch grid overlay for the table TV. Pure render: the table is
// passive glass, so all control (on/off, calibration nudges) lives on
// the DM console and arrives here through campaign data over SSE.
// Calibrate by holding a mini base in any square at the table and
// tapping ± on the console until it fits.

export function GridOverlay({ grid }: { grid?: { on: boolean; ppi: number } }) {
  if (!grid?.on || !grid.ppi) return null;
  const line = 'rgba(251, 191, 36, 0.22)'; // faint amber hairlines
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(to right, ${line} 0 1px, transparent 1px 100%), linear-gradient(to bottom, ${line} 0 1px, transparent 1px 100%)`,
        backgroundSize: `${grid.ppi}px ${grid.ppi}px`,
      }}
    />
  );
}

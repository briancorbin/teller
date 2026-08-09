// The map's inch grid, drawn in MAP space — on the map's own inch
// lines, inside the same transformed layer as tokens, painted ground
// and fog. That's why the table and the workshop agree by
// construction: there is no second, screen-fixed grid to drift out of
// alignment. At true scale one cell is physically one inch.

export function GridOverlay({ cellPx, on }: { cellPx: number; on: boolean }) {
  if (!on || !cellPx) return null;
  const line = 'rgba(251, 191, 36, 0.22)';
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(to right, ${line} 0 1px, transparent 1px 100%), linear-gradient(to bottom, ${line} 0 1px, transparent 1px 100%)`,
        backgroundSize: `${cellPx}px ${cellPx}px`,
      }}
      aria-hidden
    />
  );
}

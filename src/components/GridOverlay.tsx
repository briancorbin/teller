// The map's inch grid, drawn in MAP space — on the map's own inch
// lines, inside the same transformed layer as tokens, painted ground
// and fog. That's why the table and the workshop agree by
// construction: there is no second, screen-fixed grid to drift out of
// alignment. At true scale one cell is physically one inch.

export const GRID_COLORS = [
  { value: '#fbbf24', label: 'amber' },
  { value: '#ffffff', label: 'white' },
  { value: '#0c0a09', label: 'ink' },
  { value: '#67e8f9', label: 'cyan' },
  { value: '#f87171', label: 'red' },
  { value: '#a3e635', label: 'lime' },
];

export const GRID_DEFAULTS = { color: '#fbbf24', opacity: 0.22 };

/** '#rrggbb' → 'rgba(r, g, b, a)' */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function GridOverlay({
  cellPx,
  grid,
}: {
  cellPx: number;
  grid?: { on: boolean; color?: string; opacity?: number };
}) {
  if (grid?.on === false || !cellPx) return null;
  const line = rgba(
    grid?.color ?? GRID_DEFAULTS.color,
    grid?.opacity ?? GRID_DEFAULTS.opacity,
  );
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

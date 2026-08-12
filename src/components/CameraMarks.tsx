import { useEffect, useState } from 'react';
import type { CameraOverlay } from '../../worker/types';

// The overhead camera's overlay on the table: the four corner
// fiducials it solves against, and an amber ring under every position
// it believes a physical mini occupies (BATTLEMAP.md's "someday" —
// TEL-77). Drawn ON the ground, never instead of it: the scene stays
// the scene, and the camera watches over its shoulder.
//
// The marker layout formula (6% margin, 12% side, of the smaller
// viewport dimension) is shared verbatim with rnd/camera — the solver
// recomputes marker positions from the viewport size alone, so the
// formula IS the calibration contract. Change it in both places or
// not at all.
//
// Markers are ArUco DICT_4X4_50 ids 0–3, rendered as SVG from their
// bit matrices (6×6 cells: black border ring + the 4×4 payload) — no
// image assets, crisp at any size. '1' = white cell. The white ring
// AROUND each marker is the quiet zone detection needs on dark art.

const MARKS = [
  ['000000', '010110', '001010', '000110', '000100', '000000'],
  ['000000', '000000', '011110', '010010', '010100', '000000'],
  ['000000', '000110', '000110', '000100', '011010', '000000'],
  ['000000', '010010', '010010', '001000', '001100', '000000'],
];

function Marker({ bits, x, y, side }: {
  bits: string[]; x: number; y: number; side: number;
}) {
  const cell = side / 6;
  const pad = Math.round(side / 8);
  return (
    <g>
      <rect
        x={x - pad} y={y - pad}
        width={side + 2 * pad} height={side + 2 * pad}
        fill="#fff"
      />
      <rect x={x} y={y} width={side} height={side} fill="#000" />
      {bits.flatMap((row, r) =>
        [...row].map((bit, c) =>
          bit === '1' ? (
            <rect
              key={`${r}-${c}`}
              x={x + c * cell} y={y + r * cell}
              width={cell + 0.5} height={cell + 0.5}
              fill="#fff"
            />
          ) : null,
        ),
      )}
    </g>
  );
}

export function CameraMarks({ camera }: { camera: CameraOverlay }) {
  const [size, setSize] = useState<[number, number]>([
    window.innerWidth,
    window.innerHeight,
  ]);
  useEffect(() => {
    const onResize = () => setSize([window.innerWidth, window.innerHeight]);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [w, h] = size;
  const m = Math.round(0.06 * Math.min(w, h));
  const s = Math.round(0.12 * Math.min(w, h));
  const corners: [number, number][] = [
    [m, m],
    [w - m - s, m],
    [m, h - m - s],
    [w - m - s, h - m - s],
  ];

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="pointer-events-none absolute inset-0"
    >
      {camera.markers &&
        corners.map(([x, y], i) => (
          <Marker key={i} bits={MARKS[i]} x={x} y={y} side={s} />
        ))}
      {camera.rings.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={34}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={5}
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

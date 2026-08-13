import { useEffect, useState } from 'react';
import type { CameraOverlay } from '../../worker/types';

// The overhead camera's overlay on the table: the four corner
// fiducials it solves against, and an amber ring under every position
// it believes a physical mini occupies (BATTLEMAP.md's "someday" —
// TEL-77). Drawn ON the ground, never instead of it: the scene stays
// the scene, and the camera watches over its shoulder.
//
// The marker layout formula (1% margin, 7% side, of the smaller
// viewport dimension) is shared verbatim with rnd/camera — the solver
// recomputes marker positions from the viewport size alone, so the
// formula IS the calibration contract. Change it in both places or
// not at all. Corner-hugging on purpose: a wider quad conditions the
// solve better, and the scene keeps almost all of its glass.
//
// Markers are ArUco DICT_4X4_50 ids 0–3, rendered as SVG from their
// bit matrices (6×6 cells: border ring + the 4×4 payload) — no image
// assets, crisp at any size. '1' = light cell. The light ring AROUND
// each marker is the quiet zone detection needs on dark art.
//
// Themed as warding glyphs, not barcodes: detection is grayscale
// CONTRAST, not literal black-and-white, so "white" is parchment and
// "black" is ink — and the brass frame lives outside the quiet zone,
// where decoration is free. The glyph grid itself must stay square,
// high-contrast cells; everything else is costume.

const MARKS = [
  ['000000', '010110', '001010', '000110', '000100', '000000'],
  ['000000', '000000', '011110', '010010', '010100', '000000'],
  ['000000', '000110', '000110', '000100', '011010', '000000'],
  ['000000', '010010', '010010', '001000', '001100', '000000'],
];

const PARCHMENT = '#ede3cd'; // the "white" — lum ~228, plenty for ArUco
const INK = '#221709'; // the "black" — lum ~24
const BRASS = '#b45309';

function Marker({ bits, x, y, side }: {
  bits: string[]; x: number; y: number; side: number;
}) {
  const cell = side / 6;
  const pad = Math.round(side / 8);
  const t = { x: x - pad, y: y - pad, s: side + 2 * pad }; // parchment tile
  return (
    <g>
      {/* Brass frame — OUTSIDE the quiet zone, pure costume. */}
      <rect
        x={t.x - 3.5} y={t.y - 3.5}
        width={t.s + 7} height={t.s + 7}
        rx={pad / 2 + 2}
        fill="none" stroke={BRASS} strokeWidth={2} opacity={0.65}
      />
      {[[t.x - 3.5, t.y - 3.5], [t.x + t.s + 3.5, t.y - 3.5],
        [t.x - 3.5, t.y + t.s + 3.5], [t.x + t.s + 3.5, t.y + t.s + 3.5],
      ].map(([dx, dy], i) => (
        <rect
          key={i}
          x={dx - 3} y={dy - 3} width={6} height={6}
          transform={`rotate(45 ${dx} ${dy})`}
          fill="#f59e0b" opacity={0.8}
        />
      ))}
      <rect
        x={t.x} y={t.y} width={t.s} height={t.s} rx={pad / 2}
        fill={PARCHMENT}
      />
      <rect x={x} y={y} width={side} height={side} fill={INK} />
      {bits.flatMap((row, r) =>
        [...row].map((bit, c) =>
          bit === '1' ? (
            <rect
              key={`${r}-${c}`}
              x={x + c * cell} y={y + r * cell}
              width={cell + 0.5} height={cell + 0.5}
              fill={PARCHMENT}
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
  const m = Math.round(0.01 * Math.min(w, h));
  const s = Math.round(0.07 * Math.min(w, h));
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

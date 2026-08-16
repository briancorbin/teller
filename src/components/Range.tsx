import { useState } from 'react';
import type { SystemTemplate } from '../../worker/types';

// How far away something is, said the way the world says it — with the
// tabletop measurement one tap underneath (Brian, 2026-08-15: "could we
// translate inches into actual distance in game? … maybe the in game
// unit, but highlighted and clickable to show what that means on the
// table").
//
// Inches are teller's unit and nobody else's: nothing in a western is
// two inches from anything. So the BAND leads, because that's what a
// ruling turns on, and the measurement is there for the moment someone
// wants to check the mat rather than the fiction.
//
// A system that declares no bands renders nothing — teller has no
// opinion about how far away things are (rule 4).

/** The band a gap falls in, from the system's own table. */
export function bandOf(
  inches: number,
  bands: SystemTemplate['bands'],
): { name: string; world?: string } | undefined {
  for (const b of bands ?? []) {
    if (inches >= (b.from ?? 0) && (b.to === undefined || inches < b.to)) return b;
  }
  return undefined;
}

export function Range({
  inches,
  bands,
  className = '',
}: {
  inches: number;
  bands: SystemTemplate['bands'];
  className?: string;
}) {
  const [onTable, setOnTable] = useState(false);
  const band = bandOf(inches, bands);
  if (!band) return null;
  return (
    <button
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
        onTable
          ? 'bg-stone-800 text-stone-300'
          : 'bg-sky-950/70 text-sky-300 hover:bg-sky-900/70'
      } ${className}`}
      title={
        onTable
          ? 'what the world calls it'
          : `${Math.round(inches * 100) / 100} inches on the table — tap to show`
      }
      onClick={(e) => {
        e.stopPropagation();
        setOnTable((v) => !v);
      }}
    >
      {onTable
        ? `${Math.round(inches * 10) / 10} in on the table`
        : `${band.name}${band.world ? ` · ${band.world}` : ''}`}
    </button>
  );
}

import type { SystemTemplate } from '../../worker/types';
import { expandPool, rollPool, tallyFaces } from '../lib/dice';
import { packArtUrl } from '../lib/creation';

// A printed pool, as dice you can touch.
//
// Tapping a die cycles what the PLASTIC showed — this is a recording
// instrument first and a random number generator second. `onRoll` is
// offered only where teller is allowed to roll at all (foes), and even
// then every die it fills stays one tap from being overruled (rule 1).
//
// Faces render as the book's own art when the pack ships it
// (`creation.marks`, the same pictures the character builder uses) and
// fall back to the face's name. A pack with no art loses the pictures
// and keeps the dice.

export type DieArt = { marks: Record<string, string>; version: number };

export function DicePool({
  pool,
  faces,
  onFaces,
  dice,
  dieArt,
  onRoll,
  size = 'md',
}: {
  pool: string;
  faces: (string | null)[] | undefined;
  onFaces: (faces: (string | null)[]) => void;
  dice: SystemTemplate['dice'];
  dieArt?: DieArt;
  /** Present = teller may throw these. Absent = recording only. */
  onRoll?: () => void;
  size?: 'sm' | 'md';
}) {
  const letters = expandPool(pool);
  if (!letters.length || !dice) return null;
  const box = size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';
  const art = size === 'sm' ? 'h-5 w-5' : 'h-8 w-8';
  const { set, total } = tallyFaces(faces ?? [], dice);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {letters.map((letter, i) => {
        const face = faces?.[i] ?? null;
        const order = [...new Set(dice.faces[letter] ?? [])];
        const mark = face && dieArt?.marks[face];
        return (
          <button
            key={i}
            className={`relative flex ${box} items-center justify-center rounded-lg ring-1 transition-colors ${
              letter === 'G'
                ? 'bg-amber-900/40 ring-amber-600 hover:bg-amber-900/70'
                : 'bg-stone-800 ring-stone-600 hover:bg-stone-700'
            } ${face ? '' : 'opacity-45'}`}
            title={`${letter} die — tap to record what it showed`}
            onClick={() => {
              const next = [...(faces ?? letters.map(() => null))];
              const at = order.indexOf(next[i] ?? '');
              next[i] = at < 0 ? order[0] : at + 1 < order.length ? order[at + 1] : null;
              onFaces(next);
            }}
          >
            {mark ? (
              <img
                src={packArtUrl(mark, dieArt!.version)}
                alt={face ?? letter}
                className={`${art} object-contain`}
              />
            ) : (
              <span className="font-mono text-[10px] text-stone-300">{face ?? letter}</span>
            )}
            <span
              className={`absolute -bottom-1 -right-1 rounded px-0.5 font-mono text-[8px] leading-tight ${
                letter === 'G' ? 'bg-amber-700 text-stone-950' : 'bg-stone-600 text-stone-100'
              }`}
            >
              {letter}
            </span>
          </button>
        );
      })}
      {set > 0 && (
        <span className="ml-1 font-mono text-sm text-amber-200">
          = {total} {dice.unit ?? ''}
        </span>
      )}
      {onRoll && (
        <button
          className="ml-auto rounded-md border border-stone-600 px-2.5 py-1 text-[11px] text-stone-300 transition-colors hover:border-amber-600 hover:text-amber-200"
          title="teller rolls these — tap any die to correct it"
          onClick={onRoll}
        >
          roll for me
        </button>
      )}
    </div>
  );
}

/** Throw a pool — exported so callers don't reach past this module. */
export { rollPool };

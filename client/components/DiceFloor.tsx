// The neutral dice grid — the FLOOR under a summoned `DicePool` (§L
// phase 3.5).
//
// teller's own `DicePool` is gone: §M sorted it to the SYSTEM ("the
// `dice` record is system data and this draws it"), and the WiW system
// carries its own. But teller's runner still has to let somebody record
// what the plastic showed on a host whose system declares dice and
// ships no face for them — §M-5's manual floor is compatibility law,
// and a campaign on a data-only system plays fully. So this is what
// `presentationOf('DicePool')` degrades TO, and nothing more.
//
// What makes it the floor rather than the same component renamed: it is
// SHAPE-DERIVED end to end. A pool spelling expands to letters, each
// letter's face list comes off the `dice` record, tapping a die cycles
// through that list, and the tally is the record's own values under the
// record's own unit. Every die is drawn the same — the one thing §L
// named as a mechanic hiding in this file, `letter === 'G'` tinting the
// special die amber, is exactly the kind of thing a floor may not know,
// and a system that wants its special die to look special ships a face.
//
// Recording first, rolling second (rule 1): `onRoll` is offered only
// where teller is allowed to throw at all, and every die it fills stays
// one tap from being overruled.

import { expandPool, tallyFaces, type DiceRecord } from '../lib/dice.ts';

/** What every dice face — teller's floor and a system's own — is handed. */
export type DicePoolProps = {
  pool: string;
  dice: DiceRecord | undefined;
  faces: (string | null)[] | undefined;
  onFaces: (faces: (string | null)[]) => void;
  /** Face name → glyph key, from the `icons` record. Text either way. */
  icons?: Record<string, string>;
  /** Present = teller may throw these. Absent = recording only. */
  onRoll?: () => void;
  size?: 'sm' | 'md';
};

export function DiceFloor({
  pool,
  dice,
  faces,
  onFaces,
  icons,
  onRoll,
  size = 'md',
}: DicePoolProps) {
  const letters = expandPool(pool);
  if (!letters.length || !dice) return null;
  const box = size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';
  const { set, total } = tallyFaces(faces ?? [], dice);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {letters.map((letter, i) => {
        const face = faces?.[i] ?? null;
        // A letter can repeat a face twice in its list — de-duping keeps
        // one tap-stop per DISTINCT face rather than cycling through the
        // same label twice.
        const order = [...new Set(dice.faces[letter] ?? [])];
        const label = face ? (icons?.[face] ?? face) : letter;
        return (
          <button
            key={i}
            type="button"
            className={`relative flex ${box} items-center justify-center rounded-lg bg-stone-800 ring-1 ring-stone-600 transition-colors hover:bg-stone-700 ${
              face ? '' : 'opacity-45'
            }`}
            title={`${letter} die — tap to record what it showed`}
            onClick={() => {
              const next = [...(faces ?? letters.map(() => null))];
              const at = order.indexOf(next[i] ?? '');
              next[i] = at < 0 ? order[0] : at + 1 < order.length ? order[at + 1] : null;
              onFaces(next);
            }}
          >
            <span className="font-mono text-[10px] text-stone-300">{label}</span>
            <span className="absolute -bottom-1 -right-1 rounded bg-stone-600 px-0.5 font-mono text-[8px] leading-tight text-stone-100">
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
          type="button"
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

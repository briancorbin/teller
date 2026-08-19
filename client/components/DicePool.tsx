// The tappable dice grid — ported from the old app
// (src/components/DicePool.tsx). Tapping a die cycles what the PLASTIC
// showed: this is a recording instrument first and a random number
// generator second. `onRoll` is offered only where teller is allowed to
// roll at all (foes — rule 5), and even then every die it fills stays
// one tap from being overruled (rule 1).
//
// The old version drew a pack's own face art (`dieArt`, sourced from
// `pack.creation.marks`, an image keyed by face name). That pipeline —
// a pack shipping per-face pictures, resolved through `packArtUrl` —
// has no equivalent yet on this branch (`docs/CORE-NEXT.md` §J only
// designed the `dice`/`marks` records, not pack art). The `icons` stack
// record that DOES exist today (`GET /api/stack/record/icons`) maps a
// face name to a short glyph KEY ("ace" → "ace", "hit" → "hit"), not to
// an image — there is nothing to fetch behind it. So this ports the
// same idea one rung down the ladder: pass `icons` when you have it and
// a die shows its glyph key as its label; pass nothing (or a face with
// no entry) and it shows the face name outright. Either way it's text —
// true image art is a follow-up once a pack can ship per-face pictures.

import { expandPool, tallyFaces, type DiceRecord } from '../lib/dice.ts';

export function DicePool({
  pool,
  dice,
  faces,
  onFaces,
  icons,
  onRoll,
  size = 'md',
}: {
  pool: string;
  dice: DiceRecord | undefined;
  faces: (string | null)[] | undefined;
  onFaces: (faces: (string | null)[]) => void;
  /** Face name → glyph key, from the `icons` record. Text either way — see above. */
  icons?: Record<string, string>;
  /** Present = teller may throw these. Absent = recording only. */
  onRoll?: () => void;
  size?: 'sm' | 'md';
}) {
  const letters = expandPool(pool);
  if (!letters.length || !dice) return null;
  const box = size === 'sm' ? 'h-8 w-8' : 'h-11 w-11';
  const { set, total } = tallyFaces(faces ?? [], dice);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {letters.map((letter, i) => {
        const face = faces?.[i] ?? null;
        // A letter can repeat a face twice in its list (B's two hits,
        // two blanks) — de-duping keeps one tap-stop per DISTINCT face
        // rather than cycling through the same label twice.
        const order = [...new Set(dice.faces[letter] ?? [])];
        const label = face ? (icons?.[face] ?? face) : letter;
        return (
          <button
            key={i}
            type="button"
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
            <span className="font-mono text-[10px] text-stone-300">{label}</span>
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

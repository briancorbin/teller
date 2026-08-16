import type { Character } from '../../worker/types';
import { namedBlocks } from '../lib/statblock';
import { sectionLabel } from '../lib/ui';

// A printed statblock, rendered the same way wherever it appears.
//
// The creature sheet already had a shape worth keeping — pools in a
// grid of cells, prose under the heading the book gave it — and the
// stage grew a second, worse version of the same thing (Brian,
// 2026-08-15: "could we organize and theme this info a bit better …
// similar to how it exists in the popup would be fine"). So it lives
// in one place and both screens render it, at two densities: roomy in
// the dialog you opened to read, tight on the stage you're deciding
// a turn from.
//
// ORDER is presentation, not knowledge. These lists put a familiar
// sheet in a familiar order; anything they don't name still renders,
// after them, because a field teller doesn't recognise is a field
// somebody typed on purpose (rule 2). The sheet used to drop those
// silently — it only ever rendered the keys it knew.

const POOL_ORDER = ['defense', 'speed', 'size', 'charm', 'finesse', 'intuition', 'nerve'];
const PROSE_ORDER = ['description', 'behavior', 'features', 'trophies', 'tolerances', 'frenzy'];
/** Rendered by their own screens, in their own way. */
const ELSEWHERE = ['attacks', 'kz'];

type Field = { key: string; label: string; value: string };

const rank = (order: string[], key: string) => {
  const at = order.indexOf(key);
  return at < 0 ? order.length : at;
};

/** Short printed values — the numbers along the top of a sheet. */
export function poolFields(character: Character): Field[] {
  return character.data.fields
    .filter(
      (f) =>
        f.value &&
        !ELSEWHERE.includes(f.key) &&
        !PROSE_ORDER.includes(f.key) &&
        !f.value.includes('\n') &&
        f.value.length <= 40,
    )
    .sort((a, b) => rank(POOL_ORDER, a.key) - rank(POOL_ORDER, b.key));
}

/** Everything that reads as prose, in the book's own sections. */
export function proseFields(character: Character): Field[] {
  const pooled = new Set(poolFields(character).map((f) => f.key));
  return character.data.fields
    .filter((f) => f.value && !ELSEWHERE.includes(f.key) && !pooled.has(f.key))
    .sort((a, b) => rank(PROSE_ORDER, a.key) - rank(PROSE_ORDER, b.key));
}

export function PoolGrid({
  character,
  dense = false,
}: {
  character: Character;
  dense?: boolean;
}) {
  const pools = poolFields(character);
  if (!pools.length) return null;
  return (
    <div>
      <span className={sectionLabel}>Stats</span>
      <div
        className={`mt-2 grid gap-1.5 ${
          dense
            ? 'grid-cols-3 @lg:grid-cols-4 @2xl:grid-cols-7'
            : 'grid-cols-2 gap-2 sm:grid-cols-4'
        }`}
      >
        {pools.map((p) => (
          <div
            key={p.key}
            className={`rounded-lg bg-stone-950/60 ${dense ? 'px-2 py-1.5' : 'px-3 py-2'}`}
          >
            <div className={`font-mono text-amber-200 ${dense ? 'text-[13px]' : 'text-sm'}`}>
              {p.value}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-stone-600">{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProseSections({
  character,
  dense = false,
}: {
  character: Character;
  dense?: boolean;
}) {
  const sections = proseFields(character);
  if (!sections.length) return null;
  // On the stage this goes two-up when the panel is wide enough, and a
  // section never splits across the break — half a trait at the foot of
  // a column is worse than a longer column.
  return (
    <div className={dense ? 'gap-x-6 @2xl:columns-2' : 'space-y-5'}>
      {sections.map((f) => (
        <div key={f.key} className={dense ? 'mb-3 break-inside-avoid' : undefined}>
          <span className={sectionLabel}>{f.label}</span>
          <div className={dense ? 'mt-1 space-y-1' : 'mt-2 space-y-2'}>
            {namedBlocks(f.value).map((b, i) => (
              <p
                key={i}
                className={
                  dense
                    ? 'text-[11px] leading-snug text-stone-400'
                    : 'text-[13px] leading-relaxed text-stone-300'
                }
              >
                {b.name && <span className="text-amber-200">{b.name}. </span>}
                {b.text}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

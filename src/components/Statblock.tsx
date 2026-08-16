import { namedBlocks, parseAttacks, weaponAttacks } from '../lib/statblock';
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

/**
 * Fields, not a Character. A bestiary entry is a BLUEPRINT — it has no
 * counters, no tags and no id — and it prints the same statblock, so
 * the renderer takes the only thing all three screens actually share.
 */
export type Field = { key: string; label: string; value: string };

const rank = (order: string[], key: string) => {
  const at = order.indexOf(key);
  return at < 0 ? order.length : at;
};

/** Short printed values — the numbers along the top of a sheet. */
export function poolFields(fields: Field[]): Field[] {
  return fields
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
export function proseFields(fields: Field[]): Field[] {
  const pooled = new Set(poolFields(fields).map((f) => f.key));
  return fields
    .filter((f) => f.value && !ELSEWHERE.includes(f.key) && !pooled.has(f.key))
    .sort((a, b) => rank(PROSE_ORDER, a.key) - rank(PROSE_ORDER, b.key));
}

export function PoolGrid({
  fields,
  dense = false,
}: {
  fields: Field[];
  dense?: boolean;
}) {
  const pools = poolFields(fields);
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
  fields,
  dense = false,
}: {
  fields: Field[];
  dense?: boolean;
}) {
  const sections = proseFields(fields);
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

/**
 * The attack lines, grouped by the band they're printed under.
 *
 * The bestiary rendered these as one raw `Attacks <the whole field>`
 * string in monospace — every attack, every cost and every status run
 * together in a paragraph you had to parse by eye. Same parse the
 * console has used all along; a band is a heading and a status is a
 * chip.
 */
export function AttackLines({
  fields,
  items,
  catalog,
  dense = false,
}: {
  fields: Field[];
  items?: Parameters<typeof weaponAttacks>[0];
  catalog?: Parameters<typeof weaponAttacks>[1];
  dense?: boolean;
}) {
  const printed = fields.find((f) => f.key === 'attacks')?.value ?? '';
  const attacks = [
    ...parseAttacks(printed),
    ...(items ? weaponAttacks(items, catalog ?? new Map()) : []),
  ];
  if (!attacks.length) return null;
  const bands = [...new Set(attacks.map((a) => a.band))];
  return (
    <div>
      <span className={sectionLabel}>Attacks</span>
      <div className={dense ? 'mt-1.5 space-y-1.5' : 'mt-2 space-y-2'}>
        {bands.map((band) => (
          <div key={band}>
            {band && (
              <div className="font-mono text-[10px] uppercase tracking-wide text-stone-600">
                {band}
              </div>
            )}
            <div className="mt-1 space-y-1">
              {attacks
                .filter((a) => a.band === band)
                .map((a, i) => (
                  <div
                    key={i}
                    className={`flex flex-wrap items-baseline gap-x-2 rounded-md bg-stone-950/60 ${
                      dense ? 'px-2 py-1' : 'px-3 py-1.5'
                    }`}
                  >
                    <span className={dense ? 'text-[12px] text-stone-100' : 'text-sm text-stone-100'}>
                      {a.name}
                    </span>
                    {a.dice && (
                      <span
                        className={`font-mono text-amber-300 ${dense ? 'text-[12px]' : 'text-sm'}`}
                      >
                        {a.dice}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-stone-500">
                      {a.cost} {a.costUnit.toLowerCase()}
                    </span>
                    {a.statuses.map((s) => (
                      <span
                        key={s.name}
                        className="rounded bg-sky-950 px-1.5 font-mono text-[10px] text-sky-300"
                      >
                        {s.name} {s.dice ?? s.severity}
                      </span>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

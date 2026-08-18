// One merge shape: system → packs (declared order) → campaign, later
// wins by name.
//
// This is the resolution law (`docs/ARCHITECTURE.md`) as a function.
// Everything template-shaped resolves through it — kind declarations,
// bestiaries, statuses, catalogues — which is what makes "the campaign
// overrides a status by restating it" one rule instead of four
// implementations that drift.
//
// Names match case-insensitively, because "trapped" and "Trapped" are
// one condition and always were. A later layer's entry replaces an
// earlier one IN PLACE — the book's ordering survives a correction —
// and genuinely new names append in the order their layer declared.

// The coupling line (§10) decides the key: VOCABULARY couples by name —
// a campaign overrides a status by restating it — while IDENTITY
// couples by id — a campaign overrides a pack's monster by carrying the
// same minted id. Two keys, one merge.

export function mergeBy<T>(
  keyOf: (item: T) => string,
  ...layers: (readonly T[] | undefined)[]
): T[] {
  const out: T[] = [];
  for (const layer of layers) {
    if (!layer) continue;
    for (const item of layer) {
      const key = keyOf(item);
      const at = out.findIndex((held) => keyOf(held) === key);
      if (at < 0) out.push(item);
      else out[at] = item;
    }
  }
  return out;
}

/** Vocabulary-coupled content — statuses, kind declarations. */
export function mergeNamed<T extends { name: string }>(
  ...layers: (readonly T[] | undefined)[]
): T[] {
  return mergeBy((item) => item.name.trim().toLowerCase(), ...layers);
}

/** Identity-coupled content — bestiaries, catalogues, anything stamped. */
export function mergeById<T extends { id: string }>(
  ...layers: (readonly T[] | undefined)[]
): T[] {
  return mergeBy((item) => item.id, ...layers);
}

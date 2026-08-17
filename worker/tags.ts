// A condition on a character, and the one place that shape is read or
// written.
//
// A stacked condition — WiW's Severity, a D&D exhaustion level, anything
// counted — is a NAME and an optional NUMBER. It used to be neither: it
// was a bare string with the number on the end, and every reader was
// expected to remember to parse it.
//
// That cost us the same bug twice. First the two hand-rolled parsers
// disagreed, so real campaign data holding `"Dazed [2]"` met a reader
// that only accepted `"Dazed 2"` and the character walked around with a
// status the app rendered as a name and never as a number. Then, after
// `parseTag` was written to settle it, calling it stayed OPTIONAL — and
// `tags.includes(state.name)` still type-checked, so six surfaces kept
// comparing raw strings. `"Trapped 4"` never matched the state
// `"Trapped"`: the roster dot never lit, the pill read off while the
// character was held, tapping it appended a SECOND bare tag beside the
// numbered one, and the table TV showed nothing on the token at all.
//
// So the number stopped being punctuation and became a field. The
// failure isn't fixed here so much as made unrepresentable: there is no
// string left to compare by accident.
//
// Reading is forgiving and writing is strict, exactly as before. A
// `.story` written last week, and a pack someone authored against the
// old shape, both still load — `toTags` eats either and normalises —
// and everything written back comes out structured. That tolerance is
// permanent, not a migration window: files authored against the old
// shape can arrive at any time, and a database migration cannot reach a
// file that doesn't exist yet.

export type Tag = {
  name: string;
  /**
   * Absent means a plain condition — Prone, Ally, Gunslinger.
   *
   * A NUMBER is a count: Severity, an exhaustion level, anything that
   * steps. A STRING is a named position on a scale — a standing's rung
   * ("Friendly"), which is a value the system declares rather than one
   * you add to. Both are the same fact from a human's side, which is
   * why they share a slot: a thing you hold, and how much or which.
   *
   * Anything doing arithmetic must go through `numberOf`, not read
   * this directly.
   */
  value?: number | string;
};

/** `"Afraid 3"` and `"Afraid [3]"` both parse; anything else is a name. */
function fromString(tag: string): Tag {
  const m = tag.match(/^(.*?)\s+\[?(\d+)\]?$/);
  return m ? { name: m[1].trim(), value: Number(m[2]) } : { name: tag.trim() };
}

/**
 * Whatever shape it arrived in, as tags.
 *
 * Accepts the current shape, the legacy `string[]`, and a mixture —
 * an imported bundle can hold both if it was edited across the change.
 * Anything unrecognisable is dropped rather than guessed at, but a tag
 * someone typed by hand is still a fact about their character, so an
 * unparseable NAME is kept verbatim.
 */
export function toTags(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) return [];
  const out: Tag[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push(fromString(entry));
      continue;
    }
    if (entry && typeof entry === 'object') {
      const name = String((entry as Tag).name ?? '').trim();
      if (!name) continue;
      const value = (entry as Tag).value;
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.push({ name, value });
      } else if (typeof value === 'string' && value.trim()) {
        out.push({ name, value: value.trim() });
      } else {
        out.push({ name });
      }
    }
  }
  return out;
}

/** How it reads to a human — and to a model, which wants the number. */
export function formatTag(tag: Tag): string {
  return tag.value === undefined ? tag.name : `${tag.name} ${tag.value}`;
}

/**
 * The value as a NUMBER, when it is one.
 *
 * The single door for arithmetic. A standing's rung is a string, so
 * `tag.value - 1` is a real mistake the type system can now catch —
 * this is the thing to reach for instead, and `undefined` back means
 * "not a countable value", which is not the same as zero.
 */
export function numberOf(tag: Tag | undefined): number | undefined {
  return typeof tag?.value === 'number' ? tag.value : undefined;
}

/** Do these name the same condition, whatever numbers they carry? */
export function sameTag(a: Tag | string, b: Tag | string): boolean {
  const nameOf = (t: Tag | string) =>
    (typeof t === 'string' ? fromString(t) : t).name.trim().toLowerCase();
  return nameOf(a) === nameOf(b);
}

/** Does this character carry that condition, at any severity? */
export function hasTag(tags: Tag[], name: Tag | string): boolean {
  return tags.some((t) => sameTag(t, name));
}

/** That condition, if they have it. */
export function findTag(tags: Tag[], name: Tag | string): Tag | undefined {
  return tags.find((t) => sameTag(t, name));
}

/** Every tag except that condition — whatever number it was wearing. */
export function withoutTag(tags: Tag[], name: Tag | string): Tag[] {
  return tags.filter((t) => !sameTag(t, name));
}

/**
 * Set a condition, in place if it's already there.
 *
 * A value at or below zero takes it off entirely: a Severity that's been
 * eased to nothing is not a condition worth carrying, and every surface
 * that eases one wants the same answer.
 */
export function setTag(
  tags: Tag[],
  name: string,
  value?: number | string,
): Tag[] {
  // Only a COUNT eases away to nothing. A named rung of zero doesn't
  // exist, and a standing of "Hostile" must not vanish for sorting low.
  if (typeof value === 'number' && value <= 0) return withoutTag(tags, name);
  const next: Tag = value === undefined ? { name } : { name, value };
  const at = tags.findIndex((t) => sameTag(t, name));
  if (at < 0) return [...tags, next];
  return tags.map((t, i) => (i === at ? next : t));
}

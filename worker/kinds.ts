import { toTags, type Tag } from './tags';

// Where a character's answer to a system-declared KIND is kept.
//
// A system declares several kinds of thing a character can hold —
// statuses, Talents, standings — and the character had exactly four
// named lists to hold them in. So every kind after the first carved a
// namespace inside a list that already had another job: severity on the
// end of a tag string, a Talent's category behind a `"Talent: "` prefix,
// a standing behind a `rep_` field key. Three hacks, one cause, and all
// three are the same primitive underneath — `{ name, value? }`.
//
// This is that one place. The kind's id is the key; Core never learns
// the word "Talent". Which is what `docs/ARCHITECTURE.md` means by
// Core's primitive list being CLOSED: a system decides what goes in the
// store and how it's presented, and it never gets to invent storage. A
// kind this build has never heard of still lands somewhere, still
// renders as a list a human can edit, and costs no migration.
//
// The values are ordinary `Tag`s, so `findTag`/`setTag`/`withoutTag`
// work here unchanged — the store is a namespace, not a new type.

export type Kinds = Record<string, Tag[]>;

/**
 * Whatever shape it arrived in, as a kind store.
 *
 * Tolerant for the same reason `toTags` is, and permanently: a bundle
 * authored against any past shape can arrive at any time, and no
 * database migration reaches a file that doesn't exist yet. A key whose
 * value isn't a list of tags is dropped rather than guessed at; an
 * empty one is dropped too, so a round-trip doesn't accumulate husks.
 */
export function toKinds(raw: unknown): Kinds | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Kinds = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim();
    if (!key) continue;
    const tags = toTags(value);
    if (tags.length) out[key] = tags;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What this character holds of that kind. Never null — an absent kind is none. */
export function held(kinds: Kinds | undefined, id: string): Tag[] {
  return kinds?.[id] ?? [];
}

/**
 * The store with that kind replaced.
 *
 * An empty result removes the key entirely rather than storing `[]` —
 * "holds none of these" and "this kind was never mentioned" are the
 * same fact, and keeping both spellings would mean every reader had to
 * handle two.
 */
export function withHeld(
  kinds: Kinds | undefined,
  id: string,
  next: Tag[],
): Kinds | undefined {
  const out: Kinds = { ...(kinds ?? {}) };
  if (next.length) out[id] = next;
  else delete out[id];
  return Object.keys(out).length ? out : undefined;
}

// A tag with a number on it.
//
// A stacked condition — WiW's Severity, a D&D exhaustion level, anything
// counted — is stored as a plain string with the number on the end, so
// the schema stays `tags: string[]` and every system and every old datum
// keeps working (rule 2). This is the one place that convention is read
// or written, because it was previously spelled out twice and the two
// copies had already disagreed: real campaign data contains `"Dazed [2]"`
// while the parser only accepted `"Dazed 2"`, so that character had been
// walking around with a status the app rendered as a name and never as a
// number.
//
// Reading is therefore forgiving and writing is strict: both `"Afraid 3"`
// and `"Afraid [3]"` parse, and anything written back comes out in the
// bare form. A tag someone typed by hand is still a fact about their
// character, so a shape we don't recognise is kept verbatim as a name
// rather than dropped.

export type ParsedTag = { name: string; value: number | null };

/** `"Afraid 3"` or `"Afraid [3]"` → `{ name: 'Afraid', value: 3 }`. */
export function parseTag(tag: string): ParsedTag {
  const m = tag.match(/^(.*?)\s+\[?(\d+)\]?$/);
  return m ? { name: m[1].trim(), value: Number(m[2]) } : { name: tag, value: null };
}

/** The canonical form. Zero or less means the tag shouldn't exist at all. */
export function formatTag(name: string, value: number | null): string {
  return value === null ? name : `${name} ${value}`;
}

/** Do these two tags name the same thing, whatever their numbers are? */
export function sameTag(a: string, b: string): boolean {
  return (
    parseTag(a).name.trim().toLowerCase() === parseTag(b).name.trim().toLowerCase()
  );
}

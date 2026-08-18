// The extension-point registry — ONE file, and only this file.
//
// The `panes.ts` precedent, applied to plugins (`docs/CORE-NEXT.md`
// §15): a point not in this registry isn't a point. A plugin's manifest
// may CLAIM anything; what it provides only becomes callable if the
// name is declared here, and an unrecognised provide is refused out
// loud at load — never silently accepted, never silently dropped.
//
// It starts tiny on purpose. `propose.*` is what the assistant needs to
// exist as plugin №1; `control.*` (generalising `dials`) and `pane.*`
// are named in the design and arrive when a real plugin needs them —
// the empirical-ceiling rule, not a roadmap.
//
// Every point is a PROPOSER by construction: a serializable snapshot
// goes in, a serializable proposal comes out, and whatever comes out
// lands somewhere a human can overrule (rule 1). A plugin never holds
// a live object and never queries — snapshots are pushed to it.

export const POINTS = {
  /** Given the table's state, whose turn should come next — a proposal for the tracker, never a decision. */
  'propose.turn': 'suggest the next turn from a session snapshot',
  /** Given what just happened, words for it — narration the DM may read, edit, or ignore. */
  'propose.narrate': 'offer narration for a resolved outcome',
} as const;

export type Point = keyof typeof POINTS;

export function isPoint(name: string): name is Point {
  return name in POINTS;
}

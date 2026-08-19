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

/**
 * What a `propose.turn` provider hands back.
 *
 * The point owns this shape, not any plugin: it's the contract a
 * provider implements and the thing teller's own proposal UI draws.
 * That separation is what lets a surface render a proposal without
 * knowing what produced it — the runner asks for a POINT and gets
 * words, and a second provider tomorrow renders identically.
 *
 * Every field is optional and none of it is load-bearing: a provider
 * that answers with less renders less, and a surface must degrade to
 * showing whatever came back rather than refusing it. `premises` is the
 * honesty mechanism — the assumptions the proposal leans on, surfaced
 * so the DM can check them at a glance before believing any of it.
 */
export type TurnProposal = {
  premises?: string[];
  action?: string;
  rationale?: string;
  /** The pool the action calls for, and what it's for. Rolled by a human. */
  roll?: { dice?: string; for?: string };
};

/** What a `propose.narrate` provider hands back — words, and only words. */
export type NarrationProposal = { narration?: string };

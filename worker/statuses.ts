import type { Env } from './db';
import { packsFor } from './packs';
import { getSystem } from './systems';
import { sameTag } from './tags';
import type { Campaign, StatusDef } from './types';

// What conditions this table has, and where they come from.
//
// Three sources, in precedence order — the same shape `bestiaryFor`
// uses for foes, for the same reason.
//
//   * The SYSTEM brings the real list. Trapped, Afraid and Poisoned are
//     how the game works, not optional content (see `StatusDef`). Every
//     host running this system has them, pack or no pack.
//   * A PACK may add its own. A supplement that introduces a condition
//     is making a mechanical claim, and that's the author's affair —
//     the same latitude rule 4 gives a pack over everything else it
//     carries. It may also RESTATE one the system already has, which is
//     how a pack corrects a spelling or supplies the visual the system
//     left off.
//   * The CAMPAIGN brings its own, and wins. A homebrew condition, or
//     one a ruling invented mid-session. Rule 1 says that has to be
//     possible without editing a system row or a pack, and the table's
//     version of a word beats the book's.
//
// ---------------------------------------------------------------------
// What is deliberately NOT here: DERIVED readings.
//
// Bloodied, Down and Out of Grit used to live in this list, each with a
// threshold teller watched. They were never conditions — they were a
// view of a counter, stored as a fact, which is how a healed character
// stayed Bloodied until somebody noticed. Removed 2026-08-16.
//
// Whether they come back as something COMPUTED is open (Brian, same
// day), and the interesting case is Frenzy: most WiW creatures have an
// ability that unlocks under a Health threshold, which looks exactly
// like a derived state. Two reasons it isn't built:
//
//   * The tell may be the creature simply USING the ability, in which
//     case nothing needs deriving and a "Frenzied" marker is noise.
//   * The one place a threshold genuinely has to be known already
//     computes it — `thresholdOf` in assistant.ts renders "THRESHOLD MET
//     — Health 17, at or under 18" into the prompt, because a
//     comparison the model has to make is a comparison it can get
//     wrong. That's derivation at the point of use, which never goes
//     stale, and it is probably the whole answer.
//
// So: an option left open on purpose, with nothing standing in for it.

/**
 * This table's conditions, system first, then packs, campaign last.
 *
 * Collisions resolve BY NAME, not string equality — "trapped" and
 * "Trapped" are one condition and always were (worker/tags.ts).
 */
export async function statusesFor(
  env: Env,
  campaign: Campaign,
): Promise<StatusDef[]> {
  const out: StatusDef[] = [];
  const put = (status: StatusDef) => {
    if (!status?.name?.trim()) return;
    const at = out.findIndex((s) => sameTag(s.name, status.name));
    if (at < 0) out.push(status);
    else out[at] = status;
  };

  const system = await getSystem(env, campaign.system);
  for (const status of system?.statuses?.list ?? []) put(status);
  // In the campaign's declared order, which IS the precedence.
  for (const record of await packsFor(env, campaign)) {
    for (const status of record.pack.statuses ?? []) put(status);
  }
  for (const status of campaign.data?.states ?? []) put(status);
  return out;
}

/** The declaration for a condition someone is actually carrying. */
export function statusDef(
  statuses: StatusDef[],
  name: string,
): StatusDef | undefined {
  return statuses.find((s) => sameTag(s.name, name));
}

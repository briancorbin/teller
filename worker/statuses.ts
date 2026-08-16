import { sameTag } from './tags';
import type { Campaign, StatusDef, SystemTemplate } from './types';

// What conditions this table has, and where they come from.
//
// Two sources, and the order matters — the same shape `bestiaryFor`
// uses for foes, for the same reason.
//
//   * The SYSTEM brings the real list. Trapped, Afraid, Poisoned are
//     how the game works, not optional content (see `StatusDef`). Every
//     host running this system has them, pack or no pack.
//   * The CAMPAIGN brings its own. A homebrew condition, or one a
//     ruling invented mid-session — rule 1 says that has to be possible
//     without editing a system row, and it wins on a name collision
//     because the table's version of a word beats the book's.
//
// A pack cannot add one yet, deliberately. It's the obvious next seam —
// a supplement introducing a condition is a real case — but a pack
// declaring mechanics is a format change, and statuses only just
// stopped living in a pack's prose. Left undone rather than half-done.

/**
 * This table's conditions, system first, campaign layered over.
 *
 * Collisions are resolved BY NAME, not by string equality, because
 * "trapped" and "Trapped" are one condition and always were
 * (worker/tags.ts).
 */
export function statusesFor(
  template: SystemTemplate | undefined,
  campaign: Pick<Campaign, 'data'> | undefined,
): StatusDef[] {
  const out: StatusDef[] = [];
  const put = (status: StatusDef) => {
    if (!status?.name?.trim()) return;
    const at = out.findIndex((s) => sameTag(s.name, status.name));
    if (at < 0) out.push(status);
    else out[at] = status;
  };
  for (const status of template?.statuses?.list ?? []) put(status);
  for (const status of campaign?.data.states ?? []) put(status);
  return out;
}

/** The declaration for a condition someone is actually carrying. */
export function statusDef(
  statuses: StatusDef[],
  name: string,
): StatusDef | undefined {
  return statuses.find((s) => sameTag(s.name, name));
}

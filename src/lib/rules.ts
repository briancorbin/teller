import { useMemo } from 'react';
import type { PackEntry, PackRecord } from '../../worker/types';

export type RuleLookup = (name: string) => (PackEntry & { section: string }) | undefined;

/** Case-insensitive rule-entry lookup across every loaded pack. */
export function useRuleLookup(packs: PackRecord[]): RuleLookup {
  return useMemo(() => {
    const map = new Map<string, PackEntry & { section: string }>();
    for (const record of packs) {
      for (const section of record.pack.sections) {
        for (const entry of section.entries) {
          map.set(entry.name.toLowerCase(), { ...entry, section: section.title });
        }
      }
    }
    return (name: string) => map.get(name.trim().toLowerCase());
  }, [packs]);
}

/**
 * The caption a pack sets under a panel heading, if any.
 *
 * The sheet's own subtitles — "practice & master with Prestige" — which
 * are the publisher's words and so live only in the reader's pack. Later
 * packs win, as everywhere else.
 */
export function usePanelNote(packs: PackRecord[]): (title: string) => string | undefined {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const record of packs) {
      for (const [title, note] of Object.entries(record.pack.notes ?? {})) {
        map.set(title.trim().toLowerCase(), note);
      }
    }
    return (title: string) => map.get(title.trim().toLowerCase());
  }, [packs]);
}

/**
 * Every entry in one named section, across every loaded pack.
 *
 * This is how a sheet block gets its CONTENT without the repo carrying
 * any: WiW's STATUSES panel is a fixed list of seven, and all seven —
 * their names, the skill that relieves each, and the effect text — live
 * in the pack's "Statuses" section (rule 4). Which section that is comes
 * from the campaign's own vocabulary, so nothing here knows the word.
 *
 * Later packs win on a name collision, matching how the bestiary already
 * resolves one. No section by that title, or no packs at all, and the
 * block simply doesn't render — a host with no pack still plays.
 */
export function useRuleSection(
  packs: PackRecord[],
  title: string | undefined,
): (PackEntry & { section: string })[] {
  return useMemo(() => {
    if (!title) return [];
    const wanted = title.trim().toLowerCase();
    const byName = new Map<string, PackEntry & { section: string }>();
    for (const record of packs) {
      for (const section of record.pack.sections) {
        if (section.title.trim().toLowerCase() !== wanted) continue;
        for (const entry of section.entries) {
          byName.set(entry.name.toLowerCase(), { ...entry, section: section.title });
        }
      }
    }
    return [...byName.values()];
  }, [packs, title]);
}

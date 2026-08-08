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

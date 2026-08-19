// Mid-game rule lookups off the merged SECTIONS declaration
// (`/api/stack/declarations/sections`, §E) — ported search from the old
// app's `useRuleLookup` (src/lib/rules.ts). The merge already happened
// server-side (`Loaded.declarations`, name-keyed, later pack wins), so
// this file only has to flatten and search what it's handed.

import { useMemo } from 'react';
import { api } from './api.ts';
import { useLive } from './use-session.ts';

export type RuleEntry = {
  name: string;
  meta?: string;
  text: string;
  page?: number;
  book?: string;
};

export type RuleSection = { name: string; entries: RuleEntry[] };

export type RuleHit = RuleEntry & { section: string };

/** The declared sections, live — empty on a host with no pack. */
export function useRuleSections(): RuleSection[] {
  const { data } = useLive(() => api<RuleSection[]>('/api/stack/declarations/sections'), []);
  return data ?? [];
}

/** Case-insensitive rule-entry lookup by exact name, across every section. */
export function useRuleLookup(): (name: string) => RuleHit | undefined {
  const sections = useRuleSections();
  return useMemo(() => {
    const map = new Map<string, RuleHit>();
    for (const section of sections) {
      for (const entry of section.entries) {
        map.set(entry.name.trim().toLowerCase(), { ...entry, section: section.name });
      }
    }
    return (name: string) => map.get(name.trim().toLowerCase());
  }, [sections]);
}

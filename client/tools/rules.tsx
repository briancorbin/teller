// The 'rules' tool — browse the declared sections, search across
// entries, read one. Ported grammar from the old app's rulebook shelf
// (src/components/RulesPanel.tsx): a search box, chips when there's
// more than one section to choose between, a hit list that expands in
// place. What didn't port: pack claim/upload live in the 'shelf' tool
// now, and `/api/stack/declarations/sections` is already the merged,
// later-pack-wins reading (core/boot.ts `Loaded.declarations`) — there's
// no per-hit "which pack" here, same reason the bestiary tool lost its
// shelf-source chips.

import { useMemo, useState } from 'react';
import { useRuleSections, type RuleHit } from '../lib/rules.ts';
import { card, input, sectionLabel } from '../lib/ui.ts';
import { registerTool } from './index.ts';

function matches(hit: RuleHit, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    hit.name.toLowerCase().includes(q) ||
    hit.section.toLowerCase().includes(q) ||
    (hit.meta ?? '').toLowerCase().includes(q) ||
    hit.text.toLowerCase().includes(q)
  );
}

function RulesTool() {
  const sections = useRuleSections();
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const entries = useMemo<RuleHit[]>(
    () => sections.flatMap((s) => s.entries.map((e) => ({ ...e, section: s.name }))),
    [sections],
  );

  const q = query.trim();
  const found = useMemo(
    () => entries.filter((e) => matches(e, q) && (!section || e.section === section)),
    [entries, q, section],
  );

  return (
    <section className={`${card} @container space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Rules</span>
        <span className="font-mono text-[11px] text-stone-600">
          {q || section ? `${found.length} of ${entries.length}` : `${entries.length} entries`}
        </span>
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-stone-600">
          no rules for this system yet — a pack brings them
        </p>
      ) : (
        <>
          <input
            className={`${input} w-full`}
            placeholder={`search ${entries.length} entries — try a status, action, or item`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {sections.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors hover:bg-stone-800 ${
                  section ? 'text-stone-600' : 'text-amber-400'
                }`}
                onClick={() => setSection(null)}
                aria-pressed={!section}
              >
                all
              </button>
              {sections.map((s) => (
                <button
                  key={s.name}
                  className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors hover:bg-stone-800 ${
                    section === s.name ? 'text-amber-400' : 'text-stone-600'
                  }`}
                  onClick={() => setSection(section === s.name ? null : s.name)}
                  aria-pressed={section === s.name}
                >
                  {s.name} <span className="text-stone-700">{s.entries.length}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            {found.map((hit) => {
              const key = `${hit.section}·${hit.name}`;
              const expanded = open === key;
              return (
                <div
                  key={key}
                  className="rounded-md bg-stone-900 transition-colors hover:bg-stone-800"
                >
                  <button
                    className="block w-full px-3 py-2 text-left"
                    onClick={() => setOpen(expanded ? null : key)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-stone-100">{hit.name}</span>
                      {hit.meta && (
                        <span className="font-mono text-xs text-amber-400">{hit.meta}</span>
                      )}
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-600">
                        {hit.section}
                      </span>
                    </div>
                    <p
                      className={`mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-400 ${
                        expanded ? '' : 'line-clamp-2'
                      }`}
                    >
                      {hit.text}
                    </p>
                  </button>
                </div>
              );
            })}
            {(q || section) && found.length === 0 && (
              <p className="text-sm text-stone-600">nothing matches “{query}”</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

registerTool('rules', () => <RulesTool />);

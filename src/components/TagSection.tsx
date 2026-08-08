import { useState } from 'react';
import { input, sectionLabel } from '../lib/ui';

// Conditions, statuses, trophies — any list of words on an entity.
//
// Numbered tags: a tag ending in a number ("Afraid 3") is a stacked
// status — tapping it decrements the number (WIW-style Severity
// relief), reaching 0 removes it. The ✕ removes outright. Plain tags
// keep tap-to-remove. Pure convention: the stored value is still just
// a string, so every system and old datum works unchanged.

function parseTag(tag: string): { name: string; value: number | null } {
  const m = tag.match(/^(.*?)\s+(\d+)$/);
  return m ? { name: m[1], value: Number(m[2]) } : { name: tag, value: null };
}

export function TagSection({
  tags,
  onChange,
  label = 'Tags',
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = draft.trim();
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const decrement = (tag: string) => {
    const { name, value } = parseTag(tag);
    if (value === null) return remove(tag);
    if (value <= 1) return remove(tag);
    onChange(tags.map((t) => (t === tag ? `${name} ${value - 1}` : t)));
  };

  return (
    <section className="space-y-2">
      <span className={sectionLabel}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => {
          const { name, value } = parseTag(tag);
          return (
            <span
              key={tag}
              className="flex items-center overflow-hidden rounded-full bg-amber-950/60 text-xs text-amber-200"
            >
              <button
                className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 transition-colors hover:bg-amber-900/60"
                onClick={() => decrement(tag)}
                title={value !== null ? 'tap to reduce severity' : 'tap to remove'}
              >
                {name}
                {value !== null && (
                  <span className="rounded-full bg-amber-800 px-1.5 font-mono text-amber-100">
                    {value}
                  </span>
                )}
              </button>
              <button
                className="py-1 pl-0.5 pr-2 text-amber-500/60 transition-colors hover:bg-red-950 hover:text-red-300"
                onClick={() => remove(tag)}
                title="remove"
              >
                ✕
              </button>
            </span>
          );
        })}
        <input
          className={`${input} w-28 py-1 text-xs`}
          placeholder="+ add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          onBlur={() => draft.trim() && add()}
        />
      </div>
    </section>
  );
}

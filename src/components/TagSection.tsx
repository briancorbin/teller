import { useState } from 'react';
import type { PackEntry } from '../../worker/types';
import { formatTag, parseTag } from '../lib/tags';
import { input, sectionLabel } from '../lib/ui';

// Conditions, statuses, trophies — any list of words on an entity.
//
// Numbered tags: a tag ending in a number ("Afraid 3") is a stacked
// status — tapping it decrements the number (WIW-style Severity
// relief), reaching 0 removes it. The ✕ removes outright. Plain tags
// keep tap-to-remove. Pure convention: the stored value is still just
// a string, so every system and old datum works unchanged.
//
// When a `lookup` is provided (rules packs), tags with a matching
// rules entry grow an ⓘ — tapping it opens the rule card inline.

export function TagSection({
  tags,
  onChange,
  label = 'Tags',
  lookup,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  label?: string;
  lookup?: (name: string) => (PackEntry & { section: string }) | undefined;
}) {
  const [draft, setDraft] = useState('');
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const add = () => {
    const tag = draft.trim();
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  const decrement = (tag: string) => {
    const { name, value } = parseTag(tag);
    if (value === null || value <= 1) return remove(tag);
    onChange(tags.map((t) => (t === tag ? formatTag(name, value - 1) : t)));
  };

  const info = openInfo ? lookup?.(openInfo) : undefined;

  return (
    <section className="space-y-2">
      <span className={sectionLabel}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => {
          const { name, value } = parseTag(tag);
          const entry = lookup?.(name);
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
              {entry && (
                <button
                  className="py-1 px-1 text-amber-500/70 transition-colors hover:bg-amber-900 hover:text-amber-100"
                  onClick={() => setOpenInfo(openInfo === name ? null : name)}
                  title="rule"
                >
                  ⓘ
                </button>
              )}
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

      {info && (
        <div className="rounded-lg border border-amber-900/60 bg-stone-900 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-amber-200">{openInfo}</span>
            {info.meta && (
              <span className="font-mono text-xs text-amber-400">{info.meta}</span>
            )}
            <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-600">
              {info.section}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-300">
            {info.text}
          </p>
        </div>
      )}
    </section>
  );
}

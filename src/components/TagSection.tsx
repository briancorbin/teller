import { useState } from 'react';
import type { PackEntry } from '../../worker/types';
import { hasTag, numberOf, setTag, toTags, withoutTag, type Tag } from '../../worker/tags';
import { input, sectionLabel } from '../lib/ui';

// Conditions, statuses, trophies — any list of words on an entity.
//
// A tag carrying a number ("Afraid 3") is a stacked status — tapping it
// decrements (WIW-style Severity relief), reaching 0 removes it. The ✕
// removes outright. Plain tags keep tap-to-remove.
//
// Typing is still free-text, because a Warden writing "Afraid 3" into a
// box shouldn't have to meet a second field: `toTags` reads what they
// meant. What's stored is structured (worker/tags.ts).
//
// When a `lookup` is provided (rules packs), tags with a matching
// rules entry grow an ⓘ — tapping it opens the rule card inline.

export function TagSection({
  tags,
  onChange,
  label = 'Tags',
  lookup,
}: {
  tags: Tag[];
  onChange: (next: Tag[]) => void;
  label?: string;
  lookup?: (name: string) => (PackEntry & { section: string }) | undefined;
}) {
  const [draft, setDraft] = useState('');
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  const add = () => {
    const [tag] = toTags([draft]);
    if (!tag || hasTag(tags, tag)) return;
    onChange(setTag(tags, tag.name, tag.value));
    setDraft('');
  };

  const remove = (tag: Tag) => onChange(withoutTag(tags, tag));

  const decrement = (tag: Tag) => {
    // Only a COUNT eases down. A tag wearing a word (a standing's rung)
    // has nothing to subtract, so tapping it takes it off, same as a
    // bare one.
    const n = numberOf(tag);
    if (n === undefined) return remove(tag);
    // setTag drops it at zero, so one call covers "ease it" and "that
    // was the last of it".
    onChange(setTag(tags, tag.name, n - 1));
  };

  const info = openInfo ? lookup?.(openInfo) : undefined;

  return (
    <section className="space-y-2">
      <span className={sectionLabel}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => {
          const { name, value } = tag;
          const entry = lookup?.(name);
          return (
            <span
              key={name}
              className="flex items-center overflow-hidden rounded-full bg-amber-950/60 text-xs text-amber-200"
            >
              <button
                className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 transition-colors hover:bg-amber-900/60"
                onClick={() => decrement(tag)}
                title={value !== undefined ? 'tap to reduce severity' : 'tap to remove'}
              >
                {name}
                {value !== undefined && (
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

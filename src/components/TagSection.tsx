import { useState } from 'react';
import { input, sectionLabel } from '../lib/ui';

// Conditions, statuses, trophies — any list of words on an entity.

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

  return (
    <section className="space-y-2">
      <span className={sectionLabel}>{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <button
            key={tag}
            className="group flex items-center gap-1 rounded-full bg-amber-950/60 px-2.5 py-1 text-xs text-amber-200 transition-colors hover:bg-red-950 hover:text-red-200"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            title="remove"
          >
            {tag}
            <span className="text-amber-500/60 group-hover:text-red-300">✕</span>
          </button>
        ))}
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

import { useState } from 'react';
import type { Character, CharacterData } from '../../worker/types';
import { seatLink } from '../lib/api';
import type { RuleLookup } from '../lib/rules';
import { btnGhost, card, input, sectionLabel } from '../lib/ui';
import { CounterSection } from './CounterSection';
import { FieldSection } from './FieldSection';
import { TagSection } from './TagSection';

// The DM's view of one character. Pure schema renderer: fields,
// counters, tags, notes — whatever the JSON holds, no game knowledge.

export function CharacterCard({
  character,
  vocabulary,
  onPatch,
  onDelete,
  lookup,
}: {
  character: Character;
  vocabulary: Record<string, string>;
  onPatch: (patch: { name?: string; data?: Partial<CharacterData> }) => void;
  onDelete: () => void;
  lookup?: RuleLookup;
}) {
  const [copied, setCopied] = useState(false);
  const d = character.data;

  const copySeatLink = async () => {
    await navigator.clipboard.writeText(seatLink(character));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className={`${card} space-y-4`}>
      <header className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent font-serif text-xl text-stone-100 focus:outline-none"
          defaultValue={character.name}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== character.name &&
            onPatch({ name: e.target.value.trim() })
          }
          aria-label="character name"
        />
        {character.kind === 'npc' && (
          <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-400">
            npc
          </span>
        )}
        <button className={btnGhost} onClick={copySeatLink} title="copy seat link">
          {copied ? 'copied!' : 'seat link'}
        </button>
        <a
          className={btnGhost}
          href={`/badge/${character.id}`}
          target="_blank"
          rel="noreferrer"
          title="table-facing player badge (public info only)"
        >
          badge ↗
        </a>
        <button
          className={`${btnGhost} hover:text-red-300`}
          onClick={() => window.confirm(`Delete ${character.name}?`) && onDelete()}
          title="delete character"
        >
          ✕
        </button>
      </header>

      <FieldSection
        fields={d.fields}
        editable
        onChange={(fields) => onPatch({ data: { fields } })}
      />

      <CounterSection
        counters={d.counters}
        editable
        onChange={(counters) => onPatch({ data: { counters } })}
      />

      <TagSection
        tags={d.tags}
        label={vocabulary.conditions ?? 'Tags'}
        lookup={lookup}
        onChange={(tags) => onPatch({ data: { tags } })}
      />

      <section className="space-y-2">
        <span className={sectionLabel}>Notes</span>
        <textarea
          className={`${input} min-h-16 w-full resize-y`}
          defaultValue={d.notes}
          onBlur={(e) =>
            e.target.value !== d.notes && onPatch({ data: { notes: e.target.value } })
          }
          aria-label="notes"
        />
      </section>
    </article>
  );
}

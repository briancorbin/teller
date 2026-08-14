import type {
  Character,
  CharacterData,
  RulesPack,
  SystemTemplate,
} from '../../worker/types';
import type { OwnCatalog } from '../../worker/items';
import type { RuleLookup } from '../lib/rules';
import { btnGhost, card, input, sectionLabel } from '../lib/ui';
import { CounterSection } from './CounterSection';
import { FieldSection } from './FieldSection';
import { ItemSection } from './ItemSection';
import { TagSection } from './TagSection';

// The DM's view of one character. Pure schema renderer: fields,
// counters, tags, notes — whatever the JSON holds, no game knowledge.

export function CharacterCard({
  character,
  vocabulary,
  onPatch,
  onDelete,
  onDuplicate,
  onSaveBlueprint,
  lookup,
  packs = [],
  ownCatalog,
  template,
  holders,
  onOwnCatalog,
}: {
  character: Character;
  vocabulary: Record<string, string>;
  onPatch: (patch: { name?: string; data?: Partial<CharacterData> }) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  /** NPCs only: keep this sheet in the bestiary to stamp out later. */
  onSaveBlueprint?: () => void;
  lookup?: RuleLookup;
  /** This campaign's packs, in precedence order — the gear catalogue. */
  packs?: RulesPack[];
  /** The campaign's own gear, which outranks nothing and travels. */
  ownCatalog?: OwnCatalog;
  template?: SystemTemplate | null;
  /**
   * Tier → who in the posse already holds one, for the rise proposal's
   * one-of notice. Computed once across the whole cast by the caller —
   * it's a fact about the TABLE, and every card asking for it
   * separately would be the same sweep run once per character.
   */
  holders?: Map<string, { item: string; who: string; id: string }[]>;
  /** Absent on a surface that may look but not write to the campaign. */
  onOwnCatalog?: (next: NonNullable<OwnCatalog>) => void;
}) {
  // No seat link and no QR any more: a player's screen joins like every
  // other screen, and you point it at this character from the Displays
  // panel. Nothing here hands out a secret.
  const d = character.data;

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
        {onSaveBlueprint && (
          <button
            className={btnGhost}
            onClick={onSaveBlueprint}
            title="save to the bestiary — stamp copies of this into a fight later"
          >
            ⌂
          </button>
        )}
        {onDuplicate && (
          <button
            className={btnGhost}
            onClick={onDuplicate}
            title="duplicate — same sheet, fresh identity"
          >
            ⧉
          </button>
        )}
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

      <ItemSection
        items={d.items ?? []}
        packs={packs}
        own={ownCatalog}
        dice={template?.dice}
        growth={template?.growth}
        holders={holders}
        onChange={(items) => onPatch({ data: { items } })}
        onOwnChange={onOwnCatalog}
        label={vocabulary.gear ?? 'Gear'}
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

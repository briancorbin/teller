import { useState } from 'react';
import QRCode from 'qrcode';
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
  onDuplicate,
  lookup,
}: {
  character: Character;
  vocabulary: Record<string, string>;
  onPatch: (patch: { name?: string; data?: Partial<CharacterData> }) => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  lookup?: RuleLookup;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const d = character.data;

  const copySeatLink = async () => {
    await navigator.clipboard.writeText(seatLink(character));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const showQr = async () => {
    // Dark-on-white regardless of theme — scanners want contrast.
    const url = await QRCode.toDataURL(seatLink(character), {
      width: 640,
      margin: 2,
      color: { dark: '#1c1917', light: '#ffffff' },
    });
    setQr(url);
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
        <button
          className={btnGhost}
          onClick={showQr}
          title="show seat link as a QR code — player scans with their phone"
        >
          qr
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
        {onDuplicate && (
          <button
            className={btnGhost}
            onClick={onDuplicate}
            title="duplicate — same sheet, fresh seat token"
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

      {qr && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 bg-stone-950/90 p-6 backdrop-blur-sm"
          onClick={() => setQr(null)}
          role="dialog"
          aria-label={`seat link QR for ${character.name}`}
        >
          <p className="font-serif text-2xl text-stone-100">{character.name}</p>
          <img
            src={qr}
            alt={`QR code for ${character.name}'s seat link`}
            className="w-[min(75vw,20rem)] rounded-2xl bg-white p-3 shadow-2xl"
          />
          <p className="text-sm text-stone-400">
            scan to claim this seat · tap anywhere to close
          </p>
        </div>
      )}
    </article>
  );
}

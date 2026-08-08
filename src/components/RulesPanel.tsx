import { useMemo, useState } from 'react';
import type { PackEntry, PackRecord } from '../../worker/types';
import { api } from '../lib/api';
import { btnGhost, card, input, sectionLabel } from '../lib/ui';

// The Warden's rulebook shelf: searches across every uploaded pack for
// this system. Content comes from the packs table (uploaded JSON),
// never from the repo. Type "burn" → the Burned card.

type Hit = PackEntry & { section: string };

export function RulesPanel({
  packs,
  onUploaded,
}: {
  packs: PackRecord[];
  onUploaded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const entries = useMemo<Hit[]>(
    () =>
      packs.flatMap((record) =>
        record.pack.sections.flatMap((section) =>
          section.entries.map((entry) => ({ ...entry, section: section.title })),
        ),
      ),
    [packs],
  );

  const q = query.trim().toLowerCase();
  const hits = q
    ? entries
        .filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.section.toLowerCase().includes(q) ||
            (e.meta ?? '').toLowerCase().includes(q) ||
            e.text.toLowerCase().includes(q),
        )
        .slice(0, 12)
    : [];

  const upload = async (file: File) => {
    try {
      const pack = JSON.parse(await file.text());
      await api.putPack(pack);
      setStatus(`uploaded "${pack.name}"`);
      onUploaded();
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Rules</span>
        <label className={`${btnGhost} cursor-pointer`}>
          upload pack
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>

      {packs.length === 0 ? (
        <p className="text-sm text-stone-600">
          no rules packs for this system yet — upload a pack .json
        </p>
      ) : (
        <input
          className={`${input} w-full`}
          placeholder={`search ${entries.length} entries — try a status, action, or item`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {status && <p className="text-xs text-stone-500">{status}</p>}

      <div className="space-y-1.5">
        {hits.map((hit) => {
          const key = `${hit.section}·${hit.name}`;
          const expanded = open === key;
          return (
            <button
              key={key}
              className="block w-full rounded-md bg-stone-900 px-3 py-2 text-left transition-colors hover:bg-stone-800"
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
          );
        })}
        {q && hits.length === 0 && packs.length > 0 && (
          <p className="text-sm text-stone-600">nothing matches “{query}”</p>
        )}
      </div>
    </section>
  );
}

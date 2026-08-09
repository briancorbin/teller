import { useCallback, useEffect, useState } from 'react';
import type { Campaign, Character, CharacterData, PackRecord } from '../../worker/types';
import { api } from '../lib/api';
import { useRuleLookup } from '../lib/rules';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { card, input, sectionLabel } from '../lib/ui';
import { ConnectionHint } from '../components/ConnectionHint';
import { CounterSection } from '../components/CounterSection';
import { FieldSection } from '../components/FieldSection';
import { TagSection } from '../components/TagSection';

// The player's card. Two layouts from one component:
//  - portrait card (phones) — default flex-col
//  - instrument strip (the future 1920×515 rail panels) — a max-height
//    media query flips the root row-wise. Keep every control reachable
//    in both.

export function SeatView({ characterId }: { characterId: string }) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [packs, setPacks] = useState<PackRecord[]>([]);
  const [error, setError] = useState('');
  const lookup = useRuleLookup(packs);

  const refetch = useCallback(() => {
    api
      .seat(characterId)
      .then(({ character, campaign, packs }) => {
        setCharacter(character);
        setCampaign(campaign);
        setPacks(packs ?? []);
        setError('');
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [characterId]);

  useEffect(refetch, [refetch]);

  useWakeLock();
  const { session, connected } = useSession(character?.campaignId ?? null, (id) => {
    if (id === characterId || id === 'campaign') refetch();
  });

  const patch = (data: Partial<CharacterData>) => {
    if (!character) return;
    setCharacter({ ...character, data: { ...character.data, ...data } });
    api.patchCharacter(characterId, { data }).catch(() => refetch());
  };

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
        <h1 className="font-serif text-3xl">teller</h1>
        <p className="text-red-400">{error}</p>
        <p className="text-sm text-stone-500">
          ask your {campaign?.data.vocabulary.gm ?? 'DM'} for a fresh seat link
        </p>
      </main>
    );
  }

  if (!character) {
    return <main className="p-8 text-stone-500">taking your seat…</main>;
  }

  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const current = turn !== null ? initiative[turn] : null;
  const next =
    turn !== null && initiative.length > 0
      ? initiative[(turn + 1) % initiative.length]
      : null;
  const youreUp = current?.characterId === character.id;
  const onDeck = !youreUp && next?.characterId === character.id;

  return (
    <main
      className={`mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 ${
        youreUp ? 'ring-4 ring-inset ring-amber-600' : ''
      } [@media(max-height:560px)]:max-w-none [@media(max-height:560px)]:flex-row [@media(max-height:560px)]:items-stretch [@media(max-height:560px)]:gap-6 [@media(max-height:560px)]:overflow-hidden`}
    >
      <ConnectionHint connected={connected} />
      <header className="shrink-0 [@media(max-height:560px)]:flex [@media(max-height:560px)]:w-56 [@media(max-height:560px)]:flex-col [@media(max-height:560px)]:justify-center">
        <h1 className="font-serif text-3xl text-stone-100">{character.name}</h1>
        {campaign && (
          <p className="text-sm text-stone-500">{campaign.name}</p>
        )}
        {youreUp && (
          <p className="mt-1 inline-block animate-pulse rounded bg-amber-700 px-2 py-0.5 text-sm font-semibold text-stone-950">
            YOU'RE UP
          </p>
        )}
        {onDeck && (
          <p className="mt-1 inline-block rounded bg-stone-800 px-2 py-0.5 text-sm text-amber-300">
            on deck
          </p>
        )}
      </header>

      <div className="flex min-w-0 flex-1 flex-col gap-4 [@media(max-height:560px)]:flex-row [@media(max-height:560px)]:items-center [@media(max-height:560px)]:overflow-x-auto">
        <FieldSection fields={character.data.fields} onChange={(fields) => patch({ fields })} />

        <div className="[@media(max-height:560px)]:min-w-72 [@media(max-height:560px)]:flex-1">
          <CounterSection
            big
            counters={character.data.counters}
            onChange={(counters) => patch({ counters })}
          />
        </div>

        <TagSection
          tags={character.data.tags}
          label={campaign?.data.vocabulary.conditions ?? 'Conditions'}
          lookup={lookup}
          onChange={(tags) => patch({ tags })}
        />

        <section className="space-y-2 [@media(max-height:560px)]:hidden">
          <span className={sectionLabel}>Notes</span>
          <textarea
            className={`${input} min-h-16 w-full resize-y`}
            defaultValue={character.data.notes}
            onBlur={(e) =>
              e.target.value !== character.data.notes && patch({ notes: e.target.value })
            }
            aria-label="notes"
          />
        </section>
      </div>

      {initiative.length > 0 && (
        <footer
          className={`${card} shrink-0 [@media(max-height:560px)]:flex [@media(max-height:560px)]:w-48 [@media(max-height:560px)]:flex-col [@media(max-height:560px)]:justify-center`}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className={sectionLabel}>Initiative</span>
            {turn !== null && (
              <span className="font-mono text-xs text-stone-500">
                rd {session?.round}
              </span>
            )}
          </div>
          <ol className="flex flex-wrap gap-1.5 [@media(max-height:560px)]:flex-col [@media(max-height:560px)]:gap-1 [@media(max-height:560px)]:overflow-y-auto">
            {initiative.map((entry, index) => (
              <li
                key={entry.id}
                className={`rounded px-2 py-0.5 text-sm ${
                  index === turn
                    ? 'bg-amber-700 font-medium text-stone-950'
                    : entry.characterId === character.id
                      ? 'bg-stone-800 text-amber-200'
                      : 'bg-stone-900 text-stone-400'
                }`}
              >
                {entry.label}
              </li>
            ))}
          </ol>
        </footer>
      )}
    </main>
  );
}

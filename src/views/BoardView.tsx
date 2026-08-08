import { useCallback, useEffect, useRef, useState } from 'react';
import type { Campaign, Character, Counter } from '../../worker/types';
import { api, getDmKey, setDmKey } from '../lib/api';
import { useSession } from '../lib/use-session';
import { btnPrimary, input, sectionLabel } from '../lib/ui';

// The Warden's status board: a large, passive, no-touch display that
// sits behind the DM screen. DM-privileged — it shows EVERYTHING,
// including NPC health. Never point this one at the players.

function CounterReadout({ counter }: { counter: Counter }) {
  const pct =
    counter.max !== null && counter.max > 0
      ? Math.max(0, Math.min(1, counter.current / counter.max))
      : null;
  const low = pct !== null && pct <= 0.25;

  return (
    <div className="min-w-24">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-stone-400">{counter.name}</span>
        <span
          className={`font-mono text-2xl tabular-nums ${
            low ? 'text-red-400' : 'text-stone-100'
          }`}
        >
          {counter.current}
          {counter.max !== null && (
            <span className="text-base text-stone-500">/{counter.max}</span>
          )}
        </span>
      </div>
      {pct !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-800">
          <div
            className={`h-full rounded-full transition-all ${
              low ? 'bg-red-500' : 'bg-amber-600'
            }`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function BoardView({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState('');
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    api
      .getCampaign(campaignId)
      .then(({ campaign, characters }) => {
        setCampaign(campaign);
        setCharacters(characters);
        setError('');
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [campaignId]);

  useEffect(refetch, [refetch]);

  const session = useSession(campaignId, () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, 300);
  });

  if (error && !campaign) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
        <h1 className="font-serif text-3xl">teller · board</h1>
        <p className="text-red-400">{error}</p>
        <input
          className={input}
          type="password"
          placeholder="DM key"
          defaultValue={getDmKey()}
          onBlur={(e) => setDmKey(e.target.value)}
        />
        <button className={btnPrimary} onClick={refetch}>
          unlock
        </button>
      </main>
    );
  }

  if (!campaign) {
    return <main className="p-8 text-stone-500">opening the books…</main>;
  }

  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const currentId = turn !== null ? initiative[turn]?.characterId : null;
  const byInitiative = [...characters].sort((a, b) => {
    const ia = initiative.findIndex((e) => e.characterId === a.id);
    const ib = initiative.findIndex((e) => e.characterId === b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return (
    <main className="min-h-screen space-y-6 p-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="font-serif text-3xl text-stone-300">{campaign.name}</h1>
        {turn !== null && (
          <span className="rounded bg-amber-950 px-3 py-1 font-mono text-lg text-amber-300">
            round {session?.round}
          </span>
        )}
        {initiative.length > 0 && (
          <ol className="flex flex-wrap items-center gap-2">
            {initiative.map((entry, index) => (
              <li
                key={entry.id}
                className={`rounded-lg px-3 py-1 text-lg ${
                  index === turn
                    ? 'bg-amber-700 font-medium text-stone-950'
                    : 'bg-stone-900 text-stone-400'
                }`}
              >
                {entry.label}
              </li>
            ))}
          </ol>
        )}
        {campaign.data.counters.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-6">
            {campaign.data.counters.map((counter) => (
              <CounterReadout key={counter.id} counter={counter} />
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {byInitiative.map((character) => (
          <article
            key={character.id}
            className={`space-y-3 rounded-xl border p-4 ${
              character.id === currentId
                ? 'border-amber-700 bg-amber-950/20 ring-1 ring-amber-700'
                : 'border-stone-800 bg-stone-900/60'
            }`}
          >
            <header className="flex items-baseline gap-2">
              <h2 className="font-serif text-2xl text-stone-100">
                {character.name}
              </h2>
              {character.kind === 'npc' && (
                <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-500">
                  npc
                </span>
              )}
              {character.id === currentId && (
                <span className="ml-auto rounded bg-amber-700 px-2 py-0.5 text-xs font-semibold text-stone-950">
                  UP
                </span>
              )}
            </header>

            {character.data.fields.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {character.data.fields.map((field) => (
                  <span key={field.key} className="text-sm text-stone-400">
                    <span className="text-stone-600">{field.label} </span>
                    <span className="font-mono text-stone-200">
                      {field.value || '—'}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {character.data.counters.map((counter) => (
                <CounterReadout key={counter.id} counter={counter} />
              ))}
            </div>

            {character.data.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {character.data.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-amber-950/60 px-2.5 py-0.5 text-xs text-amber-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {character.data.notes && (
              <p className="line-clamp-2 text-sm text-stone-500">
                {character.data.notes}
              </p>
            )}
          </article>
        ))}
      </div>

      {characters.length === 0 && (
        <p className={sectionLabel}>no characters yet — add them from the console</p>
      )}
    </main>
  );
}

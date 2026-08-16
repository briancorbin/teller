import { useCallback, useEffect, useRef, useState } from 'react';
import type { Campaign, Counter, PublicCharacter } from '../../worker/types';
import { formatTag } from '../../worker/tags';
import { api } from '../lib/api';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { sectionLabel } from '../lib/ui';
import { ClockFace } from '../components/ClockFace';
import { ConnectionHint } from '../components/ConnectionHint';

// The board: a vertical, player-facing display standing in FRONT of
// the DM — the digital front of the DM screen, companion to the table
// TV. Passive, no touch, no auth, and NO SECRETS: it renders only the
// public campaign snapshot (NPC numbers never appear here).

function CounterReadout({ counter }: { counter: Counter }) {
  const pct =
    counter.max !== null && counter.max > 0
      ? Math.max(0, Math.min(1, counter.current / counter.max))
      : null;
  const low = pct !== null && pct <= 0.25;

  if (counter.display === 'clock' && counter.max !== null && counter.max > 0) {
    return (
      <div className="flex flex-col items-center gap-2">
        <ClockFace
          current={counter.current}
          max={counter.max}
          size={104}
          label={`${counter.name}: ${counter.current} of ${counter.max}`}
        />
        <span className="text-center font-serif text-xl text-stone-300">
          {counter.name}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-28">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg text-stone-400">{counter.name}</span>
        <span
          className={`font-mono text-3xl tabular-nums ${
            low ? 'text-red-400' : 'text-stone-100'
          }`}
        >
          {counter.current}
          {counter.max !== null && (
            <span className="text-xl text-stone-500">/{counter.max}</span>
          )}
        </span>
      </div>
      {pct !== null && (
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-800">
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
  const [characters, setCharacters] = useState<PublicCharacter[]>([]);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    api.publicCampaign(campaignId).then(({ campaign, characters }) => {
      setCampaign(campaign);
      setCharacters(characters);
    });
  }, [campaignId]);

  useEffect(refetch, [refetch]);

  useWakeLock();
  const { session, connected } = useSession(campaignId, () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, 300);
  });

  if (!campaign) {
    return <main className="p-8 text-stone-500">opening the books…</main>;
  }

  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const pcs = characters.filter((c) => c.kind === 'pc');
  const npcTags = characters.filter((c) => c.kind === 'npc' && c.data.tags.length > 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <ConnectionHint connected={connected} />
      <header className="text-center">
        <h1 className="font-serif text-4xl text-stone-300">{campaign.name}</h1>
      </header>

      {session?.notice && (
        <div className="animate-pulse rounded-2xl bg-amber-700 p-6 text-center font-serif text-5xl text-stone-950 shadow-lg shadow-amber-900/50">
          {session.notice}
        </div>
      )}

      {campaign.data.handout && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-stone-950/95 p-8 backdrop-blur-sm">
          {session?.notice && (
            <p className="animate-pulse rounded-2xl bg-amber-700 px-8 py-3 text-center font-serif text-4xl text-stone-950">
              {session.notice}
            </p>
          )}
          <img
            src={`/api/maps/${campaign.data.handout.key}`}
            alt={campaign.data.handout.name}
            className="max-h-[75vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
          <p className="font-serif text-3xl text-stone-200">
            {campaign.data.handout.name}
          </p>
        </div>
      )}

      {initiative.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Initiative</span>
            {turn !== null && (
              <span className="font-mono text-xl text-amber-300">
                round {session?.round}
              </span>
            )}
          </div>
          <ol className="space-y-2">
            {initiative.map((entry, index) => (
              <li
                key={entry.id}
                className={`rounded-xl px-5 py-3 font-serif transition-all ${
                  index === turn
                    ? 'scale-[1.02] bg-amber-700 text-4xl text-stone-950 shadow-lg shadow-amber-900/50'
                    : 'bg-stone-900 text-2xl text-stone-400'
                }`}
              >
                <span className="mr-3 font-mono text-base opacity-60">
                  {index + 1}
                </span>
                {entry.label}
              </li>
            ))}
          </ol>
        </section>
      )}

      {pcs.length > 0 && (
        <section className="space-y-3">
          <span className={sectionLabel}>The party</span>
          <div className="grid gap-3 sm:grid-cols-2">
            {pcs.map((character) => (
              <article
                key={character.id}
                className="space-y-3 rounded-xl border border-stone-800 bg-stone-900/60 p-4"
              >
                <h2 className="font-serif text-2xl text-stone-100">
                  {character.name}
                </h2>
                <div className="space-y-2">
                  {character.data.counters.map((counter) => (
                    <CounterReadout key={counter.id} counter={counter} />
                  ))}
                </div>
                {character.data.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {character.data.tags.map((tag) => (
                      <span
                        key={tag.name}
                        className="rounded-full bg-amber-950/60 px-3 py-1 text-sm text-amber-200"
                      >
                        {formatTag(tag)}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {npcTags.length > 0 && (
        <section className="space-y-2">
          <span className={sectionLabel}>Foes</span>
          <div className="flex flex-wrap gap-2">
            {npcTags.map((npc) => (
              <span
                key={npc.id}
                className="rounded-lg bg-stone-900 px-3 py-1.5 text-lg text-stone-300"
              >
                {npc.name}
                {npc.data.tags.map((tag) => (
                  <span key={tag.name} className="ml-2 text-sm text-red-300">
                    {formatTag(tag)}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </section>
      )}

      {campaign.data.counters.length > 0 && (
        <section className="mt-auto space-y-2">
          <span className={sectionLabel}>Party resources</span>
          <div className="flex flex-wrap gap-8">
            {campaign.data.counters.map((counter) => (
              <CounterReadout key={counter.id} counter={counter} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

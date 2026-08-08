import { useCallback, useEffect, useState } from 'react';
import type { Counter, PublicCharacter } from '../../worker/types';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { ClockFace } from '../components/ClockFace';
import { ConnectionHint } from '../components/ConnectionHint';

// The player badge: an outward-facing, non-touch display — the back of
// a rail panel, facing the table. Shows one character's PUBLIC state
// big enough to read across the table: name, vitals bars, conditions,
// and a flare when it's their turn. No auth: public snapshot only.

type BadgeCampaign = {
  id: string;
  name: string;
  vocabulary: Record<string, string>;
} | null;

function Bar({ counter }: { counter: Counter }) {
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
          size={120}
          label={`${counter.name}: ${counter.current} of ${counter.max}`}
        />
        <span className="text-xl text-stone-400">{counter.name}</span>
      </div>
    );
  }

  return (
    <div className="min-w-40">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xl text-stone-400">{counter.name}</span>
        <span
          className={`font-mono text-4xl tabular-nums ${
            low ? 'text-red-400' : 'text-stone-100'
          }`}
        >
          {counter.current}
          {counter.max !== null && (
            <span className="text-2xl text-stone-500">/{counter.max}</span>
          )}
        </span>
      </div>
      {pct !== null && (
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-stone-800">
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

export function BadgeView({ characterId }: { characterId: string }) {
  const [character, setCharacter] = useState<PublicCharacter | null>(null);
  const [campaign, setCampaign] = useState<BadgeCampaign>(null);

  const refetch = useCallback(() => {
    fetch(`/api/characters/${characterId}/public`)
      .then(
        (r) =>
          r.json() as Promise<{ character: PublicCharacter; campaign: BadgeCampaign }>,
      )
      .then((d) => {
        setCharacter(d.character);
        setCampaign(d.campaign);
      })
      .catch(() => {});
  }, [characterId]);

  useEffect(refetch, [refetch]);

  useWakeLock();
  const { session, connected } = useSession(character?.campaignId ?? null, (id) => {
    if (id === characterId || id === 'campaign') refetch();
  });

  if (!character) {
    return <main className="p-8 text-stone-600">…</main>;
  }

  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const current = turn !== null ? initiative[turn] : null;
  const next =
    turn !== null && initiative.length > 0
      ? initiative[(turn + 1) % initiative.length]
      : null;
  const up = current?.characterId === character.id;
  const onDeck = !up && next?.characterId === character.id;

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-center gap-6 p-8 transition-all ${
        up ? 'bg-amber-950/40 ring-8 ring-inset ring-amber-600' : ''
      }`}
    >
      <ConnectionHint connected={connected} />
      <header className="text-center">
        <h1 className="font-serif text-6xl text-stone-100">{character.name}</h1>
        {up && (
          <p className="mt-3 animate-pulse rounded-xl bg-amber-600 px-6 py-2 font-serif text-4xl text-stone-950">
            TAKING THEIR TURN
          </p>
        )}
        {onDeck && (
          <p className="mt-3 rounded-xl bg-stone-800 px-6 py-2 text-2xl text-amber-300">
            on deck
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
        {character.data.counters.map((counter) => (
          <Bar key={counter.id} counter={counter} />
        ))}
      </div>

      {character.data.tags.length > 0 && (
        <div className="flex flex-wrap justify-center gap-3">
          {character.data.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-amber-950/80 px-5 py-2 text-2xl text-amber-200"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {campaign && (
        <footer className="text-lg text-stone-600">{campaign.name}</footer>
      )}
    </main>
  );
}

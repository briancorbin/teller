import { useCallback, useEffect, useState } from 'react';
import type { Campaign, PublicCharacter } from '../../worker/types';
import { api } from '../lib/api';
import { useSession } from '../lib/use-session';

// The table TV — the screen IN the table, under the minis. With a map
// uploaded it renders full-bleed with the initiative rail overlaid;
// otherwise it's a big glanceable initiative board. Notices take over
// everything. (Fog, calibrated grid, and tokens are the next phase.)

export function TableView({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  const refetch = useCallback(() => {
    api
      .publicCampaign(campaignId)
      .then(({ campaign }: { campaign: Campaign; characters: PublicCharacter[] }) =>
        setCampaign(campaign),
      )
      .catch(() => {});
  }, [campaignId]);

  useEffect(refetch, [refetch]);

  const session = useSession(campaignId, (id) => {
    if (id === 'campaign') refetch();
  });
  const initiative = session?.initiative ?? [];
  const turn = session?.turn ?? null;
  const mapUrl = campaign?.data.map ? `/api/maps/${campaign.data.map.key}` : null;

  if (session?.notice) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="animate-pulse text-center font-serif text-7xl text-amber-300">
          {session.notice}
        </p>
      </main>
    );
  }

  if (mapUrl) {
    return (
      <main className="relative h-screen overflow-hidden bg-black">
        <img
          src={mapUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
        />
        {initiative.length > 0 && (
          <ol className="absolute inset-x-0 bottom-4 flex flex-wrap items-center justify-center gap-2 px-8">
            {initiative.map((entry, index) => (
              <li
                key={entry.id}
                className={`rounded-xl px-4 py-1.5 font-serif backdrop-blur ${
                  index === turn
                    ? 'bg-amber-600/90 text-2xl text-stone-950 shadow-lg'
                    : 'bg-stone-950/70 text-lg text-stone-300'
                }`}
              >
                {entry.label}
              </li>
            ))}
            {turn !== null && (
              <li className="rounded-xl bg-stone-950/70 px-3 py-1.5 font-mono text-sm text-amber-300 backdrop-blur">
                rd {session?.round}
              </li>
            )}
          </ol>
        )}
      </main>
    );
  }

  if (initiative.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2">
        <h1 className="font-serif text-6xl text-stone-700">teller</h1>
        <p className="text-stone-600">waiting for the books to open…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      {turn !== null && (
        <p className="font-mono text-lg uppercase tracking-[0.3em] text-stone-500">
          round {session?.round}
        </p>
      )}
      <ol className="flex flex-col items-center gap-3">
        {initiative.map((entry, index) => (
          <li
            key={entry.id}
            className={`rounded-xl px-8 py-3 font-serif transition-all ${
              index === turn
                ? 'scale-110 bg-amber-700 text-4xl text-stone-950 shadow-lg shadow-amber-900/50'
                : 'bg-stone-900 text-2xl text-stone-400'
            }`}
          >
            {entry.label}
          </li>
        ))}
      </ol>
    </main>
  );
}

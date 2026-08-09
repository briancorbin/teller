import { useCallback, useEffect, useState } from 'react';
import type { Campaign, PublicCharacter } from '../../worker/types';
import { api } from '../lib/api';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { ConnectionHint } from '../components/ConnectionHint';

// The art surface: a fullscreen frame any panel can point at — DM
// screen wings, a spare tablet on the shelf, a station someday. Shows
// the campaign's active handout (scene art, a letter, a WANTED
// poster); rests as a quiet mark when nothing's pushed. Public
// snapshot only — the handout library never reaches this surface.

export function ArtView({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useWakeLock();

  const refetch = useCallback(() => {
    api
      .publicCampaign(campaignId)
      .then(({ campaign }: { campaign: Campaign; characters: PublicCharacter[] }) =>
        setCampaign(campaign),
      )
      .catch(() => {});
  }, [campaignId]);

  useEffect(refetch, [refetch]);

  const { connected } = useSession(campaignId, (id) => {
    if (id === 'campaign') refetch();
  });

  const handout = campaign?.data.handout ?? null;

  if (handout) {
    return (
      <main className="relative h-screen overflow-hidden bg-black">
        <ConnectionHint connected={connected} />
        <img
          src={`/api/maps/${handout.key}`}
          alt={handout.name}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <ConnectionHint connected={connected} />
      <h1 className="font-serif text-5xl text-stone-800">teller</h1>
    </main>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { Campaign, PublicCharacter } from '../../worker/types';
import { api } from '../lib/api';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { ConnectionHint } from '../components/ConnectionHint';
import { GridOverlay } from '../components/GridOverlay';

// The table TV — the screen IN the table, under the minis. It is the
// GROUND, nothing else: the battle map full-bleed when one's up, idle
// branding otherwise. All bookkeeping (initiative, notices, counters)
// belongs to the board standing in front of the DM. Fog, calibrated
// grid, and tokens land here in the next phase.

export function TableView({ campaignId }: { campaignId: string }) {
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

  const mapUrl = campaign?.data.map ? `/api/maps/${campaign.data.map.key}` : null;

  if (mapUrl) {
    return (
      <main className="relative h-screen overflow-hidden bg-black">
        <ConnectionHint connected={connected} />
        <img
          src={mapUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-contain"
        />
        <GridOverlay />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <ConnectionHint connected={connected} />
      <h1 className="font-serif text-6xl text-stone-700">teller</h1>
      <p className="text-stone-600">the table awaits a map…</p>
    </main>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { Campaign, PublicCharacter } from '../../worker/types';
import { api } from '../lib/api';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { ConnectionHint } from '../components/ConnectionHint';
import { GridOverlay } from '../components/GridOverlay';

// The table TV — the screen IN the table, under the minis. It is the
// GROUND, nothing else: the active scene (framed per its view + true
// scale when calibrated), the grid overlay, idle branding otherwise.
// All control lives on the console; state arrives over SSE.
// Coordinate rules: docs/BATTLEMAP.md.

export function TableView({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);

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

  // Tell the console what this display is (CSS px) so it can offer
  // auto grid calibration from the TV's diagonal. Telemetry only.
  useEffect(() => {
    fetch(`/api/campaigns/${campaignId}/display`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ w: window.innerWidth, h: window.innerHeight }),
    }).catch(() => {});
  }, [campaignId]);

  const { connected } = useSession(campaignId, (id) => {
    if (id === 'campaign') refetch();
  });

  const scene = campaign?.data.scene ?? null;
  const mapKey = scene?.key ?? campaign?.data.map?.key ?? null;
  const mapUrl = mapKey ? `/api/maps/${mapKey}` : null;

  // Natural dimensions belong to the current image only.
  useEffect(() => setNat(null), [mapKey]);

  // True scale needs all three facts: the display's calibrated ppi,
  // the scene's declared physical width, and the image's pixel width.
  const ppi = campaign?.data.grid?.ppi;
  const view = scene?.view;
  const trueScale =
    view?.mode === 'true' && scene?.widthInches && ppi && nat
      ? ((ppi * scene.widthInches) / nat.w) * (view.zoom || 1)
      : null;

  // Measure via ref AND onLoad: a cached image can complete before
  // React attaches the load listener, so onLoad alone silently misses.
  const measure = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth) {
      setNat((prev) =>
        prev?.w === el.naturalWidth && prev?.h === el.naturalHeight
          ? prev
          : { w: el.naturalWidth, h: el.naturalHeight },
      );
    }
  };

  if (mapUrl) {
    const framed = trueScale !== null && nat !== null && view !== undefined;
    return (
      <main className="relative h-screen overflow-hidden bg-black">
        <ConnectionHint connected={connected} />
        <img
          key={mapKey}
          src={mapUrl}
          alt=""
          ref={measure}
          onLoad={(e) => measure(e.currentTarget)}
          className={
            framed
              ? 'absolute max-w-none'
              : 'absolute inset-0 h-full w-full object-contain'
          }
          style={
            framed
              ? {
                  width: nat.w * trueScale,
                  height: nat.h * trueScale,
                  left: `calc(50vw - ${view.cu * nat.w * trueScale}px)`,
                  top: `calc(50vh - ${view.cv * nat.h * trueScale}px)`,
                }
              : undefined
          }
        />
        <GridOverlay grid={campaign?.data.grid} />
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

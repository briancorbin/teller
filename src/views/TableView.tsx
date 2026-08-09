import { useCallback, useEffect, useRef, useState } from 'react';
import type { Calibration, Campaign, PublicCharacter } from '../../worker/types';
import { api } from '../lib/api';
import { useSession } from '../lib/use-session';
import { useWakeLock } from '../lib/use-wake-lock';
import { ConnectionHint } from '../components/ConnectionHint';
import { GridOverlay } from '../components/GridOverlay';
import { tokenShapeStyle, zoneStyle } from '../components/token-visuals';
import { TileZones } from '../components/TileZones';
import { FogLayer } from '../components/FogLayer';
import { CalibrationOverlay } from '../components/CalibrationOverlay';

// The table TV — the screen IN the table, under the minis. It is the
// GROUND, nothing else: the active scene (framed per its view + true
// scale when calibrated), token ground-markers with reactive effects,
// the grid overlay, idle branding otherwise. All control lives on the
// console; state arrives over SSE. Coordinate rules: docs/BATTLEMAP.md.

export function TableView({
  campaignId,
  ppi,
  ppiY,
}: {
  campaignId: string;
  /** This screen's own calibration — px per true inch, per axis. */
  ppi?: number | null;
  ppiY?: number | null;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [characters, setCharacters] = useState<PublicCharacter[]>([]);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  // Console-driven, transient, never stored — see Calibration in the contract.
  const [calibration, setCalibration] = useState<Calibration | null>(null);

  useWakeLock();

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const refetch = useCallback(() => {
    api
      .publicCampaign(campaignId)
      .then(({ campaign, characters }) => {
        setCampaign(campaign);
        setCharacters(characters);
      })
      .catch(() => {});
  }, [campaignId]);

  useEffect(refetch, [refetch]);

  // Tell the books how big this screen is, so the workshop can draw an
  // honest frame preview. Telemetry only — it writes to this display's
  // own row and nothing else.
  useEffect(() => {
    api.reportViewport(window.innerWidth, window.innerHeight).catch(() => {});
  }, [vp.w, vp.h]);

  // Any poke (scene switch, counter tick → vitality change) refreshes;
  // debounced so a burst of console taps costs one fetch.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { session, connected } = useSession(
    campaignId,
    () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(refetch, 300);
    },
    { onCalibration: setCalibration },
  );

  const scene = campaign?.data.scene ?? null;
  const mapKey = scene?.key ?? campaign?.data.map?.key ?? null;
  const mapUrl = mapKey ? `/api/maps/${mapKey}` : null;

  // Natural dimensions belong to the current image only.
  useEffect(() => setNat(null), [mapKey]);

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

  // One geometry for both modes: where the map sits on the glass.
  // Two scales, because a true inch across need not be a true inch
  // down: on a stretched or overscanned picture the axes calibrate
  // differently, and a 1" square must still measure 1" both ways with
  // a physical ruler. On a correctly-set-up display sx === sy.
  // Calibration is this screen's own; the campaign-level value is only
  // a fallback for glass that hasn't been calibrated since it moved.
  const px = ppi ?? campaign?.data.grid?.ppi;
  const pxY = ppiY ?? campaign?.data.grid?.ppiY ?? px;
  const view = scene?.view;
  let rect: { left: number; top: number; sx: number; sy: number } | null = null;
  if (nat) {
    if (view?.mode === 'true' && scene?.widthInches && px && pxY) {
      const zoom = view.zoom || 1;
      const sx = ((px * scene.widthInches) / nat.w) * zoom;
      // The map's physical height follows from its aspect, so the
      // vertical scale differs from sx only by the vertical ppi.
      const sy = ((pxY * scene.widthInches) / nat.w) * zoom;
      rect = {
        sx,
        sy,
        left: vp.w / 2 - view.cu * nat.w * sx,
        top: vp.h / 2 - view.cv * nat.h * sy,
      };
    } else {
      const scale = Math.min(vp.w / nat.w, vp.h / nat.h);
      rect = {
        sx: scale,
        sy: scale,
        left: (vp.w - nat.w * scale) / 2,
        top: (vp.h - nat.h * scale) / 2,
      };
    }
  }

  // Tokens size in MAP inches so they stay glued to the ground in
  // either mode (in true scale a 1" token IS 1" of glass).
  const pxPerMapInch =
    rect && nat && scene?.widthInches
      ? (rect.sx * nat.w) / scene.widthInches
      : null;
  const pxPerMapInchY =
    rect && nat && scene?.widthInches
      ? (rect.sy * nat.w) / scene.widthInches
      : null;

  const turnCharacterId =
    session && session.turn !== null
      ? (session.initiative[session.turn]?.characterId ?? null)
      : null;

  // Calibration takes the whole screen: this is about the glass, not
  // the map, and a high-contrast field is what you match a jig against.
  if (calibration) return <CalibrationOverlay calibration={calibration} />;

  if (mapUrl) {
    return (
      <main className="relative h-screen overflow-hidden bg-black">
        <ConnectionHint connected={connected} />
        <img
          key={mapKey}
          src={mapUrl}
          alt=""
          ref={measure}
          onLoad={(e) => measure(e.currentTarget)}
          className="absolute max-w-none"
          style={
            rect && nat
              ? {
                  width: nat.w * rect.sx,
                  height: nat.h * rect.sy,
                  left: rect.left,
                  top: rect.top,
                }
              : { visibility: 'hidden' }
          }
        />
        {/* grid on the map's own inch lines, so it agrees with the
            workshop and with every painted cell */}
        {rect && nat && pxPerMapInch && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: rect.left,
              top: rect.top,
              width: nat.w * rect.sx,
              height: nat.h * rect.sy,
            }}
          >
            <GridOverlay
              cellPx={pxPerMapInch}
              cellPxY={pxPerMapInchY ?? undefined}
              grid={scene?.grid}
            />
          </div>
        )}
        {/* painted tile zones — one gooey layer of ground effects */}
        {rect && nat && pxPerMapInch && (
          <TileZones
            zones={scene?.zones ?? []}
            left={rect.left}
            top={rect.top}
            width={nat.w * rect.sx}
            height={nat.h * rect.sy}
            cellPx={pxPerMapInch}
            cellPxY={pxPerMapInchY ?? undefined}
          />
        )}
        {rect &&
          nat &&
          [...(scene?.tokens ?? [])]
            .sort((a, b) => (a.effect ? 0 : 1) - (b.effect ? 0 : 1))
            .map((token) => {
            const size = pxPerMapInch ? token.sizeInches * pxPerMapInch : 24;
            // A round token is round in INCHES, so on a stretched
            // picture it is an ellipse in pixels.
            const sizeY = pxPerMapInchY ? token.sizeInches * pxPerMapInchY : size;
            if (token.effect) {
              // Environmental zone: ground the minis stand IN. Under
              // everything, no label, no glow — just the fire.
              const zone = zoneStyle(token.effect);
              return (
                <div
                  key={token.id}
                  className={`absolute ${zone.animate ? 'animate-pulse' : ''}`}
                  style={{
                    left: rect.left + token.u * nat.w * rect.sx,
                    top: rect.top + token.v * nat.h * rect.sy,
                    width: size,
                    height: sizeY,
                    background: zone.background,
                    boxShadow: zone.boxShadow,
                    transition: 'left 300ms, top 300ms',
                    ...tokenShapeStyle(token),
                  }}
                />
              );
            }
            const linked = token.characterId
              ? characters.find((c) => c.id === token.characterId)
              : null;
            const vitality = linked?.data.vitality;
            const isTurn =
              token.characterId != null && token.characterId === turnCharacterId;
            const glow = isTurn
              ? `0 0 ${size * 0.6}px ${size * 0.2}px rgba(251,191,36,0.75)`
              : vitality === 'critical'
                ? `0 0 ${size * 0.5}px ${size * 0.15}px rgba(220,38,38,0.8)`
                : vitality === 'bloodied'
                  ? `0 0 ${size * 0.35}px ${size * 0.1}px rgba(220,38,38,0.5)`
                  : undefined;
            return (
              <div
                key={token.id}
                className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 font-mono font-bold text-stone-950 ${
                  isTurn || vitality === 'critical' ? 'animate-pulse' : ''
                } ${vitality === 'bloodied' || vitality === 'critical' ? 'border-red-900' : 'border-stone-950/80'}`}
                style={{
                  left: rect.left + token.u * nat.w * rect.sx,
                  top: rect.top + token.v * nat.h * rect.sy,
                  width: size,
                  height: sizeY,
                  backgroundColor: token.color,
                  boxShadow: glow,
                  fontSize: Math.max(9, size * 0.28),
                  transition: 'left 300ms, top 300ms',
                }}
              >
                {token.label.slice(0, 2)}
              </div>
            );
          })}
        {/* fog sits above tokens and ground: unexplored means unseen */}
        {rect && nat && pxPerMapInch && (
          <FogLayer
            fog={scene?.fog}
            left={rect.left}
            top={rect.top}
            width={nat.w * rect.sx}
            height={nat.h * rect.sy}
            cellPx={pxPerMapInch}
            cellPxY={pxPerMapInchY ?? undefined}
          />
        )}
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

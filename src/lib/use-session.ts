import { useEffect, useRef, useState } from 'react';
import type {
  Calibration,
  CameraOverlay,
  SessionState,
  StreamEvent,
} from '../../worker/types';
import { api } from './api';

// The live session, over SSE.
//
// ONE connection per screen, shared by everyone who asks. That is not a
// tidiness preference — a browser allows six HTTP/1.1 connections per
// origin and an SSE stream never gives one back, so a screen that opened
// two (the wrapper AND its role view) meant three screens exhausted the
// whole pool. Every later request on that origin then queues forever,
// which looks exactly like the whole table falling over.
//
// It never showed on teller.ink because HTTPS gets HTTP/2, where streams
// are multiplexed over one connection and the limit doesn't apply. A
// host on plain HTTP has no such cover. So the sharing below is what
// makes local-first survive contact with more than two screens.

type Handler = (event: StreamEvent) => void;
type Status = (connected: boolean) => void;

type Stream = {
  source: EventSource | null;
  /** The screen's opaque handle, so the DO can aim events at it. */
  handle: string;
  events: Set<Handler>;
  status: Set<Status>;
  retry: ReturnType<typeof setTimeout> | null;
  backoff: number;
  /**
   * A connection is in flight.
   *
   * Checking `source` alone isn't enough: fetching the ticket is async,
   * and every subscriber mounts in the same tick — so during that gap
   * `source` is still null and each one cheerfully opens its own. That
   * race is what made "one stream per screen" quietly still be two.
   */
  opening: boolean;
};

const streams = new Map<string, Stream>();

function open(campaignId: string, stream: Stream): void {
  if (stream.source || stream.opening) return;
  stream.opening = true;
  // Listening needs a ticket: EventSource can't send headers, so the
  // proof rides in the URL. It expires, and the browser's own retry
  // would hammer a 401 forever — so reconnection is ours.
  void api
    .streamTicket(campaignId)
    .then((res) => {
      stream.opening = false;
      if (!streams.has(campaignId)) return; // everyone left while we asked
      const params = new URLSearchParams({ t: res.ticket });
      if (stream.handle) params.set('display', stream.handle);
      // Close whatever was here first. A screen learns its handle while
      // the anonymous connection is still being opened, so two can be in
      // flight at once — and assigning over the top of a live EventSource
      // doesn't disconnect it, it just orphans it. An orphan holds one of
      // the browser's six connections until the tab closes.
      stream.source?.close();
      const source = new EventSource(`/api/campaigns/${campaignId}/stream?${params}`);
      stream.source = source;

      source.onopen = () => {
        stream.backoff = 1000;
        for (const tell of stream.status) tell(true);
      };
      source.onmessage = (message) => {
        for (const tell of stream.status) tell(true);
        const event = JSON.parse(message.data) as StreamEvent;
        for (const handle of stream.events) handle(event);
      };
      source.onerror = () => reopen(campaignId, stream);
    })
    .catch(() => {
      stream.opening = false;
      reopen(campaignId, stream);
    });
}

function reopen(campaignId: string, stream: Stream): void {
  for (const tell of stream.status) tell(false);
  stream.source?.close();
  stream.source = null;
  stream.opening = false;
  if (stream.retry) clearTimeout(stream.retry);
  stream.retry = setTimeout(() => open(campaignId, stream), stream.backoff);
  stream.backoff = Math.min(stream.backoff * 2, 30_000);
}

function join(
  campaignId: string,
  handle: string,
  onEvent: Handler,
  onStatus: Status,
): () => void {
  let stream = streams.get(campaignId);
  if (!stream) {
    stream = {
      source: null,
      handle,
      events: new Set(),
      status: new Set(),
      retry: null,
      backoff: 1000,
      opening: false,
    };
    streams.set(campaignId, stream);
  }
  // A screen learns its handle after the first subscriber has already
  // joined, so adopt it and reopen — a stream that doesn't name the
  // screen can't be told "you're the map now".
  if (handle && stream.handle !== handle) {
    stream.handle = handle;
    if (stream.source) {
      stream.source.close();
      stream.source = null;
    }
    stream.opening = false;
  }
  stream.events.add(onEvent);
  stream.status.add(onStatus);
  open(campaignId, stream);

  return () => {
    stream!.events.delete(onEvent);
    stream!.status.delete(onStatus);
    if (stream!.events.size || stream!.status.size) return;
    // Last one out closes the door.
    if (stream!.retry) clearTimeout(stream!.retry);
    stream!.source?.close();
    streams.delete(campaignId);
  };
}

/**
 * Subscribe to a campaign's live session.
 *
 * `onCharacter` fires when any character (or the campaign itself, id
 * 'campaign') changes — callers refetch what they care about.
 * `connected` is false while the stream is down so surfaces can warn
 * that they may be stale.
 */
export function useSession(
  campaignId: string | null,
  onCharacter?: (characterId: string) => void,
  /**
   * Screen-directed events. `handle` is this display's opaque handle —
   * without it the stream is anonymous and only hears the room.
   */
  screen?: {
    handle?: string;
    onAssign?: () => void;
    onIdentify?: () => void;
    onCalibration?: (calibration: Calibration | null) => void;
    onCamera?: (camera: CameraOverlay | null) => void;
  },
): { session: SessionState | null; connected: boolean } {
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(true);
  const onCharacterRef = useRef(onCharacter);
  onCharacterRef.current = onCharacter;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const handle = screen?.handle ?? '';

  useEffect(() => {
    if (!campaignId) return;
    return join(
      campaignId,
      handle,
      (event) => {
        if (event.type === 'hello' || event.type === 'session') {
          setSession(event.state);
        } else if (event.type === 'character') {
          onCharacterRef.current?.(event.characterId);
        } else if (event.type === 'assign') {
          screenRef.current?.onAssign?.();
        } else if (event.type === 'identify') {
          screenRef.current?.onIdentify?.();
        } else if (event.type === 'calibration') {
          screenRef.current?.onCalibration?.(event.calibration);
        } else if (event.type === 'camera') {
          screenRef.current?.onCamera?.(event.camera);
        }
      },
      setConnected,
    );
  }, [campaignId, handle]);

  return { session, connected };
}

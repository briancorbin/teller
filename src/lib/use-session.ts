import { useEffect, useRef, useState } from 'react';
import type { Calibration, SessionState, StreamEvent } from '../../worker/types';
import { api } from './api';

/**
 * Subscribe to a campaign's live session over SSE.
 * `onCharacter` fires when any character (or the campaign itself, id
 * 'campaign') changes — callers refetch what they care about.
 * `connected` is false while the EventSource is down/retrying so
 * surfaces can warn that they may be stale.
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
  },
): { session: SessionState | null; connected: boolean } {
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(true);
  const onCharacterRef = useRef(onCharacter);
  onCharacterRef.current = onCharacter;
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const handle = screen?.handle;

  useEffect(() => {
    if (!campaignId) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let backoff = 1000;

    // Listening needs a ticket, because EventSource can't send headers.
    // It expires, and the browser's own reconnect would then retry a 401
    // forever — so reconnection is ours: fetch a fresh ticket, open a
    // fresh stream, and back off if the host is simply gone.
    const connect = async () => {
      if (closed) return;
      try {
        const { ticket } = await api.streamTicket(campaignId);
        if (closed) return;
        const params = new URLSearchParams({ t: ticket });
        if (handle) params.set('display', handle);
        source = new EventSource(`/api/campaigns/${campaignId}/stream?${params}`);
        wire(source);
      } catch {
        setConnected(false);
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    };

    const reconnect = () => {
      setConnected(false);
      source?.close();
      source = null;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    };

    const wire = (source: EventSource) => {
    source.onopen = () => {
      setConnected(true);
      backoff = 1000;
    };
    source.onerror = () => reconnect();
    source.onmessage = (message) => {
      setConnected(true);
      const event = JSON.parse(message.data) as StreamEvent;
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
      }
    };
    };

    void connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [campaignId, handle]);

  return { session, connected };
}

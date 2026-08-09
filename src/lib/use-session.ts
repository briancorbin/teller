import { useEffect, useRef, useState } from 'react';
import type { Calibration, SessionState, StreamEvent } from '../../worker/types';

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
    const url = `/api/campaigns/${campaignId}/stream${
      handle ? `?display=${encodeURIComponent(handle)}` : ''
    }`;
    const source = new EventSource(url);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
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
    return () => source.close();
  }, [campaignId, handle]);

  return { session, connected };
}

import { useEffect, useRef, useState } from 'react';
import type { SessionState, StreamEvent } from '../../worker/types';

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
): { session: SessionState | null; connected: boolean } {
  const [session, setSession] = useState<SessionState | null>(null);
  const [connected, setConnected] = useState(true);
  const onCharacterRef = useRef(onCharacter);
  onCharacterRef.current = onCharacter;

  useEffect(() => {
    if (!campaignId) return;
    const source = new EventSource(`/api/campaigns/${campaignId}/stream`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      setConnected(true);
      const event = JSON.parse(message.data) as StreamEvent;
      if (event.type === 'hello' || event.type === 'session') {
        setSession(event.state);
      } else if (event.type === 'character') {
        onCharacterRef.current?.(event.characterId);
      }
    };
    return () => source.close();
  }, [campaignId]);

  return { session, connected };
}

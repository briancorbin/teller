import { useCallback, useEffect, useState } from 'react';
import { api, getDisplayId, setDisplayId } from './api';
import { type Display } from '../../worker/types';

/** Waiting to be adopted, so there's no stream yet — ask now and then. */
const STANDBY_POLL_MS = 3000;
/** Claimed: just enough to stay visibly alive in the console's list. */
const HEARTBEAT_MS = 20_000;

/**
 * This screen, as the server sees it.
 *
 * Every surface starts here: the screen announces itself, keeps the id
 * it's given, and becomes whatever the DM says it is. Pairing happens
 * once ever — the id outlives reloads and reboots, so a panel that has
 * been claimed comes back up already itself.
 */
export function useDisplay(): {
  display: Display | null;
  handle: string;
  ready: boolean;
  refresh: () => Promise<void>;
} {
  const [display, setDisplay] = useState<Display | null>(null);
  const [handle, setHandle] = useState('');
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      // The handle arrives with the display rather than being computed
      // here: `crypto.subtle` doesn't exist on a plain-HTTP origin, which
      // is what a screen on a table's own network is talking to.
      const { display: next, handle: next_handle } = await api.hello(getDisplayId());
      setDisplayId(next.id);
      setDisplay(next);
      setHandle(next_handle);
    } catch {
      // Offline or the worker is down; keep whatever we last knew and
      // let the poll below try again.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Unclaimed: poll hard, because the code is the only thing happening.
  // Claimed: a slow heartbeat, which keeps "live" honest in the console's
  // screen list and catches an assignment if the stream ever misses one.
  const claimed = Boolean(display?.campaignId);
  useEffect(() => {
    const every = claimed ? HEARTBEAT_MS : STANDBY_POLL_MS;
    const timer = setInterval(() => void refresh(), every);
    return () => clearInterval(timer);
  }, [claimed, refresh]);

  return { display, handle, ready, refresh };
}

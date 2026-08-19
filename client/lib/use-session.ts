// The live wire. ONE EventSource per tab with a subscriber set —
// component count never sets socket count (rule 6: HTTP/1.1 gives six
// connections per origin and a stream never releases one). The old
// app's per-BROWSER leader election is a known further step; per-tab
// is the floor the rule demands and what the vanilla client shipped.

import { useEffect, useRef, useState } from 'react';
import { getSlips } from './api.ts';

type Listener = (what: string) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let backoff: ReturnType<typeof setTimeout> | null = null;

const identifyListeners = new Set<() => void>();

function ensureStream(): void {
  if (source || backoff) return;
  getSlips()
    .then((slips) => {
      if (source) return;
      const es = new EventSource(
        `/api/stream?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.ticket)}`,
      );
      source = es;
      es.onmessage = (ev) => {
        const what = String(ev.data ?? '');
        if (what === 'identify') {
          for (const fn of identifyListeners) fn();
          return;
        }
        for (const fn of listeners) fn(what);
      };
      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        if (listeners.size + identifyListeners.size > 0) {
          backoff = setTimeout(() => {
            backoff = null;
            ensureStream();
          }, 3000);
        }
      };
    })
    .catch(() => {
      backoff = setTimeout(() => {
        backoff = null;
        ensureStream();
      }, 3000);
    });
}

function drop(fn: Listener): void {
  listeners.delete(fn);
  maybeClose();
}

function maybeClose(): void {
  if (listeners.size + identifyListeners.size > 0) return;
  source?.close();
  source = null;
  if (backoff) {
    clearTimeout(backoff);
    backoff = null;
  }
}

/**
 * Tear the stream down and come back with fresh slips. The moment that
 * needs this is ADOPTION on a key-holding machine: before adoption the
 * slips bind the stream to the DM handle, and an identify aimed at the
 * screen's own handle would land nowhere until a reload.
 */
export function resetStream(): void {
  source?.close();
  source = null;
  if (backoff) {
    clearTimeout(backoff);
    backoff = null;
  }
  if (listeners.size + identifyListeners.size > 0) ensureStream();
}

/** Subscribe to nudges. Returns an unsubscribe. */
export function onNudge(fn: Listener): () => void {
  listeners.add(fn);
  ensureStream();
  return () => drop(fn);
}

/** Subscribe to the identify flash. */
export function onIdentify(fn: () => void): () => void {
  identifyListeners.add(fn);
  ensureStream();
  return () => {
    identifyListeners.delete(fn);
    maybeClose();
  };
}

/**
 * Fetch + refetch on any nudge. The server tells us WHAT changed as a
 * string; v1 refetches on everything (the vanilla client's behavior),
 * except while the user is mid-keystroke in a field.
 */
export function useLive<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
): { data: T | undefined; error: Error | undefined; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = () => {
    fetchRef
      .current()
      .then((d) => {
        setData(d);
        setError(undefined);
      })
      .catch((e: Error) => setError(e));
  };

  useEffect(() => {
    load();
    const off = onNudge(() => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      )
        return;
      load();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, reload: load };
}

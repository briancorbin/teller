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
// ONE connection per screen, shared by everyone who asks — and since
// 2026-08-15, one connection per BROWSER, shared by every tab. Neither
// is a tidiness preference: a browser allows six HTTP/1.1 connections
// per origin and an SSE stream never gives one back. One stream per
// screen fixed three screens exhausting the pool from inside one tab;
// then a DM previewing six screens as six tabs exhausted it from the
// outside, and the seventh tab loaded a black page forever.
//
// It never showed on teller.ink because HTTPS gets HTTP/2, where streams
// are multiplexed over one connection and the limit doesn't apply. A
// host on plain HTTP has no such cover (no certificate for a LAN IP —
// TEL-84 is the long way out), so the pooling below is what makes
// local-first survive contact with more than a few tabs.
//
// HOW THE POOLING WORKS — leader election, not a SharedWorker:
//
// One tab per campaign is elected LEADER and holds the one EventSource,
// opened as `display=*` — a shared socket that hears the whole room's
// mail, with targeted events tagged `to` (campaign-do.ts). The leader
// relays everything over a BroadcastChannel; every tab — leader
// included — keeps only the mail that names its own handle. Filtering
// is tab-side because only the tab knows which screen it is; the tag
// identifies, it never grants (rule 7), and everything on the socket
// was already gated by the campaign ticket.
//
// Election is a localStorage heartbeat, deliberately boring: the leader
// stamps a key, every tab checks it, a stale stamp gets taken over
// (write, wait a beat, read back — last writer wins). Chosen over the
// obvious alternatives for reasons worth keeping:
//   - A SharedWorker owning the socket is the textbook answer and it
//     DOES NOT WORK here: this family of browsers kills EventSource
//     inside shared workers at the network layer (readyState 0, error
//     before any bytes move) while the same URL streams fine from a
//     tab or dedicated worker. Found empirically; do not re-walk in.
//   - Web Locks would make election trivial and is [SecureContext] —
//     gone on a LAN origin, which is the one place any of this matters.
//   - localStorage + BroadcastChannel work everywhere teller runs,
//     including Android Chrome, which never had SharedWorker at all.
//
// A leader that dies abdicates by silence: its heartbeat goes stale and
// another tab takes over inside a few seconds (or instantly, when
// pagehide gets the chance to say goodbye). A leader in a HIDDEN tab
// heartbeats off the server's 25s pings — network delivery isn't
// throttled the way hidden-tab timers are — so a visible tab will
// usually steal leadership from a hidden one, which is the migration
// you'd want anyway. The worst transient is two sockets for a moment,
// against a budget of six.

type Handler = (event: StreamEvent) => void;
type Status = (connected: boolean) => void;

type Role = 'leader' | 'follower' | 'direct';

type Stream = {
  source: EventSource | null;
  /** The screen's opaque handle — the filter for `to`-tagged mail. */
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
  /** This tab's part in the pooling; `direct` = no pooling available. */
  role: Role;
  channel: BroadcastChannel | null;
  /** The election clock — checks the heartbeat, stamps it when leading. */
  watch: ReturnType<typeof setInterval> | null;
  /**
   * The last hello/session the leader saw, replayed to any tab that
   * asks — a late-joining tab deserves the same instant state the
   * first one got, and the socket's own hello is long consumed.
   */
  lastHello: StreamEvent | null;
};

const streams = new Map<string, Stream>();

/** This tab, for the duration of its life. Never rendered, never stored. */
const TAB = crypto.getRandomValues(new Uint32Array(2)).join('-');

const CHECK_MS = 2_500;
/** Longer than the server's 25s ping, so a hidden leader isn't deposed
 *  while its socket is demonstrably alive — see the header. */
const STALE_MS = 35_000;

const leaderKey = (campaignId: string) => `teller.stream.leader.${campaignId}`;

type Relay =
  | { kind: 'event'; event: StreamEvent }
  | { kind: 'status'; connected: boolean }
  | { kind: 'need-state' };

/** Can this browser pool at all? Old engines fall back to a socket per tab. */
function canPool(): boolean {
  try {
    return typeof BroadcastChannel !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function stampHeartbeat(campaignId: string): void {
  try {
    localStorage.setItem(leaderKey(campaignId), JSON.stringify({ id: TAB, at: Date.now() }));
  } catch {
    // Quota or privacy mode: the election degrades to everyone leading,
    // which is just the old one-socket-per-tab arithmetic.
  }
}

function readLeader(campaignId: string): { id: string; at: number } | null {
  try {
    const raw = localStorage.getItem(leaderKey(campaignId));
    return raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
  } catch {
    return null;
  }
}

/** Deliver one event to this tab's subscribers, keeping only its own mail. */
function dispatch(stream: Stream, event: StreamEvent): void {
  if (event.to && event.to !== stream.handle) return;
  for (const tell of stream.status) tell(true);
  for (const handle of stream.events) handle(event);
}

function tellStatus(stream: Stream, connected: boolean): void {
  for (const tell of stream.status) tell(connected);
}

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
      // Still the CURRENT stream, still the role that opens sockets?
      // An election can depose this tab while the ticket is in flight,
      // and a socket opened after losing would be an orphan holding one
      // of the browser's six until the tab closes — the exact failure
      // this file exists to prevent.
      if (streams.get(campaignId) !== stream) return;
      if (stream.role === 'follower') return;
      const params = new URLSearchParams({ t: res.ticket });
      // The leader listens for the whole browser, so it takes the whole
      // room's mail; a direct (unpooled) stream names only its screen.
      if (stream.role === 'leader') params.set('display', '*');
      else if (stream.handle) params.set('display', stream.handle);
      // Close whatever was here first — an orphaned EventSource can
      // never be closed again and holds a connection until the tab dies.
      stream.source?.close();
      const source = new EventSource(`/api/campaigns/${campaignId}/stream?${params}`);
      stream.source = source;

      source.onopen = () => {
        stream.backoff = 1000;
        tellStatus(stream, true);
        if (stream.role === 'leader') {
          stream.channel?.postMessage({ kind: 'status', connected: true } satisfies Relay);
        }
      };
      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as StreamEvent;
        if (stream.role === 'leader') {
          if (event.type === 'hello' || event.type === 'session') stream.lastHello = event;
          // Every message proves the socket lives — worth a heartbeat,
          // because a hidden tab's TIMERS are throttled but its network
          // isn't, and a working leader shouldn't be deposed for napping.
          stampHeartbeat(campaignId);
          stream.channel?.postMessage({ kind: 'event', event } satisfies Relay);
        }
        dispatch(stream, event);
      };
      source.onerror = () => {
        tellStatus(stream, false);
        if (stream.role === 'leader') {
          stream.channel?.postMessage({ kind: 'status', connected: false } satisfies Relay);
        }
        stream.source?.close();
        stream.source = null;
        stream.opening = false;
        if (stream.retry) clearTimeout(stream.retry);
        stream.retry = setTimeout(() => open(campaignId, stream), stream.backoff);
        stream.backoff = Math.min(stream.backoff * 2, 30_000);
      };
    })
    .catch(() => {
      stream.opening = false;
      if (streams.get(campaignId) !== stream || stream.role === 'follower') return;
      tellStatus(stream, false);
      if (stream.retry) clearTimeout(stream.retry);
      stream.retry = setTimeout(() => open(campaignId, stream), stream.backoff);
      stream.backoff = Math.min(stream.backoff * 2, 30_000);
    });
}

function lead(campaignId: string, stream: Stream): void {
  const was = stream.role;
  stream.role = 'leader';
  stampHeartbeat(campaignId);
  if (was !== 'leader') open(campaignId, stream);
}

function follow(stream: Stream): void {
  const was = stream.role;
  stream.role = 'follower';
  // A deposed leader hands back its socket — one per browser is the deal.
  if (stream.retry) clearTimeout(stream.retry);
  stream.retry = null;
  stream.source?.close();
  stream.source = null;
  stream.opening = false;
  if (was !== 'follower') {
    stream.channel?.postMessage({ kind: 'need-state' } satisfies Relay);
  }
}

/**
 * One election round: stamp if leading, steal if the throne is stale.
 * Takeover is write → wait a beat → read back, so when several tabs
 * notice a dead leader at once, last-writer-wins settles it without
 * anyone coordinating.
 */
function elect(campaignId: string, stream: Stream): void {
  const current = readLeader(campaignId);
  if (current && current.id === TAB) {
    lead(campaignId, stream);
    return;
  }
  if (current && Date.now() - current.at < STALE_MS) {
    follow(stream);
    return;
  }
  stampHeartbeat(campaignId);
  setTimeout(
    () => {
      if (streams.get(campaignId) !== stream) return;
      const winner = readLeader(campaignId);
      if (winner?.id === TAB) lead(campaignId, stream);
      else follow(stream);
    },
    100 + Math.random() * 200,
  );
}

function joinPooled(campaignId: string, stream: Stream): void {
  const channel = new BroadcastChannel(`teller.stream.${campaignId}`);
  stream.channel = channel;
  channel.onmessage = (message: MessageEvent<Relay>) => {
    const relay = message.data;
    if (relay.kind === 'need-state') {
      // Only the leader answers, with the socket's accumulated truth.
      if (stream.role === 'leader' && stream.lastHello) {
        channel.postMessage({ kind: 'event', event: stream.lastHello } satisfies Relay);
      }
    } else if (stream.role === 'follower') {
      if (relay.kind === 'event') dispatch(stream, relay.event);
      else tellStatus(stream, relay.connected);
    }
  };
  stream.watch = setInterval(() => elect(campaignId, stream), CHECK_MS);
  elect(campaignId, stream);
}

// A closing tab abdicates on the way out, so succession takes one
// election beat instead of waiting out the stale timer.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const [campaignId, stream] of streams) {
      if (stream.role !== 'leader') continue;
      try {
        localStorage.removeItem(leaderKey(campaignId));
      } catch {
        // Best effort; the stale timer is the backstop.
      }
    }
  });
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
      role: 'direct',
      channel: null,
      watch: null,
      lastHello: null,
    };
    streams.set(campaignId, stream);
    if (canPool()) joinPooled(campaignId, stream);
    else open(campaignId, stream);
  }
  // A screen learns its handle after the first subscriber has already
  // joined. Pooled, that's free — the `to` filter simply starts
  // matching different mail. A direct stream named the screen in its
  // URL, so it has to reopen to be told "you're the map now".
  if (handle && stream.handle !== handle) {
    stream.handle = handle;
    if (stream.role === 'direct') {
      if (stream.source) {
        stream.source.close();
        stream.source = null;
      }
      stream.opening = false;
      open(campaignId, stream);
    }
  }
  stream.events.add(onEvent);
  stream.status.add(onStatus);

  return () => {
    stream!.events.delete(onEvent);
    stream!.status.delete(onStatus);
    if (stream!.events.size || stream!.status.size) return;
    // Last one out closes the door — and abdicates, so the next tab's
    // election finds an empty throne instead of a stale one.
    if (stream!.retry) clearTimeout(stream!.retry);
    if (stream!.watch) clearInterval(stream!.watch);
    if (stream!.role === 'leader') {
      try {
        localStorage.removeItem(leaderKey(campaignId));
      } catch {
        // Best effort; the stale timer is the backstop.
      }
    }
    stream!.channel?.close();
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
    onDisplay?: (displayId: string) => void;
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
        } else if (event.type === 'display') {
          screenRef.current?.onDisplay?.(event.displayId);
        }
      },
      setConnected,
    );
  }, [campaignId, handle]);

  return { session, connected };
}

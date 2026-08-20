// The client's one door to the server. Adds the auth headers (rule 7:
// the key or the display id — never both required), memoizes the
// permission slips, and keeps localStorage keys identical to the
// vanilla client's so already-paired screens survive the swap.

const KEY = 'teller.key';
const DISPLAY = 'teller.display';

/**
 * The hash can NAME a screen — `#warden_left` — so one browser hosts
 * several independent screens, each with its own identity, pairing
 * code and assignment (the old app's `displaySlot`, ported; same
 * grammar, `console` reserved). Captured once at load: identity,
 * slips and the stream are all slot-scoped, so landing on a
 * DIFFERENT slot reloads rather than half-switching.
 */
function slotOf(hash: string): string {
  const s = hash.replace(/^#/, '').trim();
  return /^[A-Za-z0-9_-]{1,16}$/.test(s) && s !== 'console' ? s : '';
}

const SLOT = slotOf(window.location.hash);

export function displaySlot(): string {
  return SLOT;
}

window.addEventListener('hashchange', () => {
  if (slotOf(window.location.hash) !== SLOT) window.location.reload();
});

const displayKey = () => (SLOT ? `${DISPLAY}.${SLOT}` : DISPLAY);

export const stored = {
  get key(): string | null {
    return localStorage.getItem(KEY);
  },
  set key(v: string | null) {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  },
  get display(): string | null {
    return localStorage.getItem(displayKey());
  },
  set display(v: string | null) {
    if (v) localStorage.setItem(displayKey(), v);
    else localStorage.removeItem(displayKey());
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {};
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  return body as T;
}

// ---- displays / pairing ------------------------------------------------

export type DisplayInfo = {
  id: string;
  code?: string | null;
  role?: string | null;
  name?: string;
  color?: string;
  params?: Record<string, unknown>;
  /** This screen's own calibration — px per true inch, per axis. */
  ppi?: number;
  ppiY?: number;
};

export async function hello(): Promise<{ display: DisplayInfo; handle: string }> {
  const out = await api<{ display: DisplayInfo; handle: string }>(
    '/api/displays/hello',
    { body: stored.display ? { id: stored.display } : {} },
  );
  stored.display = out.display.id;
  return out;
}

// ---- permission slips (tickets) ---------------------------------------

export type Slips = { handle: string; ticket: string; files: string };

let slipsPromise: Promise<Slips> | null = null;

/** Memoized: one ticket fetch per session; forget on auth change. */
export function getSlips(): Promise<Slips> {
  slipsPromise ??= api<Slips>('/api/ticket').catch((err) => {
    slipsPromise = null;
    throw err;
  });
  return slipsPromise;
}

export function forgetSlips(): void {
  slipsPromise = null;
}

/**
 * Fetch a file route and hand the browser the download.
 *
 * A plain `<a download>` would be simpler and can't work: the auth
 * headers are rule 7's whole mechanism and a link sends none, so the
 * bytes are fetched like everything else here and handed on as a blob.
 * The NAME comes off the server's `Content-Disposition` when it sent
 * one — the folder on the shelf is the file's real name and only the
 * host knows it — with the caller's guess as the fallback.
 */
export async function download(path: string, fallback: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (stored.key) headers['x-teller-key'] = stored.key;
  if (stored.display) headers['x-teller-display'] = stored.display;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : res.statusText,
    );
  }
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = named?.[1] ?? fallback;
  link.click();
  URL.revokeObjectURL(url);
}

/** A ticketed URL for bytes in the data dir (pack art, board images). */
export async function fileUrl(path: string): Promise<string> {
  const slips = await getSlips();
  return `/files/${path}?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.files)}`;
}

// ---- the player-safe snapshot -----------------------------------------
//
// One payload, and the ONLY thing a passive surface is allowed to read
// (rule 6). The redaction law lives on the server (`server/public.ts`);
// these are the shapes it hands back, mirrored here rather than
// imported — same reasoning as `screens.tsx`'s local `DisplayRole` and
// `runner.tsx`'s local `TurnState`: the server module is not part of
// the client's graph.
//
// What the views may therefore assume, and must never work around: a
// foe carries no numbers at all, only tag-like lists and a qualitative
// `vitality`. If a passive view ever wants a number the snapshot didn't
// bring, the answer is that the number is not for that screen.

export type PublicEntry = { name: string; value?: number | string; max?: number };

export type Vitality = 'healthy' | 'bloodied' | 'critical' | 'down';

export type PublicEntity = {
  id: string;
  name: string;
  type?: string;
  side: 'foe' | 'party';
  lists: Record<string, PublicEntry[]>;
  vitality?: Vitality;
};

export type PublicTurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

export type PublicTurn = {
  order: PublicTurnEntry[];
  turn: number | null;
  round: number;
  rolling?: boolean;
};

// ---- the turn order ----------------------------------------------------
//
// The live order, not the public snapshot's copy of it — a seat holds an
// assignment and may read the real thing. Mirrored from `server/turn.ts`
// rather than imported, for the same reason everything else here is: the
// server module is not part of the client's graph.

export type TurnEntry = {
  id: string;
  entityId?: string;
  label?: string;
  score?: number | null;
};

export type TurnState = {
  order: TurnEntry[];
  turn: number | null;
  round: number;
  rolling?: boolean;
};

export function turnState(): Promise<TurnState> {
  return api<TurnState>('/api/turn');
}

/** The one op a seat's own assignment allows (rule 5): a score for its
 *  own row. The server checks that the row is really this screen's —
 *  asking for anything else here just gets refused. */
export function scoreEntry(entryId: string, score: number | null): Promise<TurnState> {
  return api<TurnState>('/api/turn', { body: { op: 'score', entryId, score } });
}

/** The board asset, plus its live state minus everything hidden. */
export type PublicBoard = {
  board: {
    id: string;
    key: string;
    name: string;
    widthInches?: number;
    grid?: { on?: boolean; color?: string; opacity?: number };
  };
  state: {
    placements?: PublicPlacement[];
    /** Already flattened to plain revealed cells — no region shapes. */
    fog?: { on?: boolean; revealed?: [number, number][] };
    view?: { mode?: 'fit' | 'true'; zoom?: number; cu?: number; cv?: number };
  } | null;
};

/** Where a thing stands and what it looks like; how it's DOING comes
 *  through `entityId` at render, never from here (§5). */
export type PublicPlacement = {
  entityId?: string;
  label?: string;
  color?: string;
  /** Normalized image coordinates, 0..1 (docs/BATTLEMAP.md). */
  u: number;
  v: number;
  sizeInches?: number;
};

export type PublicSnapshot = {
  campaign: { slug: string; name: string };
  roster: PublicEntity[];
  turn: PublicTurn;
  board: PublicBoard | null;
};

export function publicSnapshot(): Promise<PublicSnapshot> {
  return api<PublicSnapshot>('/api/public');
}

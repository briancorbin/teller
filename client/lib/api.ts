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

/** A ticketed URL for bytes in the data dir (pack art, board images). */
export async function fileUrl(path: string): Promise<string> {
  const slips = await getSlips();
  return `/files/${path}?handle=${encodeURIComponent(slips.handle)}&ticket=${encodeURIComponent(slips.files)}`;
}

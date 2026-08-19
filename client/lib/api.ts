// The client's one door to the server. Adds the auth headers (rule 7:
// the key or the display id — never both required), memoizes the
// permission slips, and keeps localStorage keys identical to the
// vanilla client's so already-paired screens survive the swap.

const KEY = 'teller.key';
const DISPLAY = 'teller.display';

export const stored = {
  get key(): string | null {
    return localStorage.getItem(KEY);
  },
  set key(v: string | null) {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  },
  get display(): string | null {
    return localStorage.getItem(DISPLAY);
  },
  set display(v: string | null) {
    if (v) localStorage.setItem(DISPLAY, v);
    else localStorage.removeItem(DISPLAY);
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

import type {
  Book,
  BookHit,
  Calibration,
  Campaign,
  CampaignData,
  Character,
  CharacterData,
  Display,
  DisplayParams,
  DisplayRole,
  Handout,
  PackRecord,
  Scene,
  PublicCharacter,
  RulesPack,
  SessionOp,
  SessionState,
  SystemTemplate,
} from '../../worker/types';
import type { BundleSummary } from '../../worker/import';
import type { SourcedNpc } from '../../worker/bestiary';

const DM_KEY_STORAGE = 'teller.dmKey';
const DISPLAY_ID_STORAGE = 'teller.displayId';

export function getDmKey(): string {
  return localStorage.getItem(DM_KEY_STORAGE) ?? '';
}

export function setDmKey(key: string): void {
  localStorage.setItem(DM_KEY_STORAGE, key);
}

export function clearDmKey(): void {
  localStorage.removeItem(DM_KEY_STORAGE);
}

/**
 * One browser profile is one screen. That's correct at the table —
 * every panel is its own box — but on a laptop it means every tab is
 * the same screen and shows the same code.
 *
 * A fragment gives this machine another slot: `teller.ink/#tv`,
 * `/#board`, `/#ragnar`. It says only WHICH screen on this device, and
 * a slotted tab acts as a screen even when the DM key is stored here,
 * so one machine can watch the whole table. It never says what a screen
 * IS — roles only ever come from assignment.
 */
export function displaySlot(): string {
  const slot = window.location.hash.replace(/^#/, '').trim();
  return /^[A-Za-z0-9_-]{1,16}$/.test(slot) ? slot : '';
}

const displayKey = () => {
  const slot = displaySlot();
  return slot ? `${DISPLAY_ID_STORAGE}.${slot}` : DISPLAY_ID_STORAGE;
};

/**
 * This screen's identity. It's what the server checks to decide what
 * this screen may do, so it lives here and is never rendered — unlike
 * the pairing code, which exists to be read aloud.
 */
export function getDisplayId(): string {
  return localStorage.getItem(displayKey()) ?? '';
}

export function setDisplayId(id: string): void {
  localStorage.setItem(displayKey(), id);
}

/**
 * Both credentials ride on every request; the worker takes whichever
 * grants. A screen the DM promoted to the console has no key and needs
 * none — its assignment is the authority.
 */
function authHeaders(headers: Headers): Headers {
  const key = getDmKey();
  if (key) headers.set('x-teller-key', key);
  const id = getDisplayId();
  if (id) headers.set('x-teller-display', id);
  return headers;
}

/**
 * A failed request, carrying its status.
 *
 * The status is the difference between "this is gone" and "I couldn't
 * reach the host just now", and callers have to be able to tell: one
 * means give up on the thing, the other means try again in a moment.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(new Headers(init.headers));
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  templates: () => req<SystemTemplate[]>('/api/templates'),

  listCampaigns: () => req<Campaign[]>('/api/campaigns'),

  createCampaign: (name: string, system: string) =>
    req<Campaign>(
      '/api/campaigns',
      { method: 'POST', body: JSON.stringify({ name, system }) },
    ),

  publicCampaign: (id: string) =>
    req<{ campaign: Campaign; characters: PublicCharacter[] }>(
      `/api/campaigns/${id}/public`,
    ),

  getCampaign: (id: string) =>
    req<{ campaign: Campaign; characters: Character[]; bestiary: SourcedNpc[] }>(
      `/api/campaigns/${id}`,
    ),

  patchCampaign: (id: string, patch: { name?: string; data?: Partial<CampaignData> }) =>
    req<Campaign>(
      `/api/campaigns/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),

  createCharacter: (campaignId: string, name: string, kind: 'pc' | 'npc') =>
    req<Character>(
      `/api/campaigns/${campaignId}/characters`,
      { method: 'POST', body: JSON.stringify({ name, kind }) },
    ),

  patchCharacter: (id: string, patch: { name?: string; data?: Partial<CharacterData> }) =>
    req<Character>(`/api/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteCampaign: (id: string) =>
    req<{ ok: true }>(`/api/campaigns/${id}`, { method: 'DELETE' }),

  undo: (campaignId: string) =>
    req<{ undid: string; entityId: string | null }>(
      `/api/campaigns/${campaignId}/undo`,
      { method: 'POST' },
    ),

  uploadMap: async (campaignId: string, file: File) => {
    const res = await fetch(`/api/campaigns/${campaignId}/map`, {
      method: 'PUT',
      headers: authHeaders(new Headers({ 'content-type': file.type })),
      body: file,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ map: { key: string } }>;
  },

  removeMap: (campaignId: string) =>
    req<{ ok: true }>(`/api/campaigns/${campaignId}/map`, { method: 'DELETE' }),

  uploadScene: async (campaignId: string, file: File) => {
    const name = file.name.replace(/\.[^.]+$/, '');
    const res = await fetch(
      `/api/campaigns/${campaignId}/maps?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: authHeaders(new Headers({ 'content-type': file.type })),
        body: file,
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ scene: Scene }>;
  },

  deleteScene: (campaignId: string, sceneId: string) =>
    req<{ ok: true }>(
      `/api/campaigns/${campaignId}/maps/${sceneId}`,
      { method: 'DELETE' },
    ),

  uploadHandout: async (campaignId: string, file: File) => {
    const name = file.name.replace(/\.[^.]+$/, '');
    const res = await fetch(
      `/api/campaigns/${campaignId}/handouts?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: authHeaders(new Headers({ 'content-type': file.type })),
        body: file,
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ handout: Handout }>;
  },

  deleteHandout: (campaignId: string, handoutId: string) =>
    req<{ ok: true }>(
      `/api/campaigns/${campaignId}/handouts/${handoutId}`,
      { method: 'DELETE' },
    ),

  deleteCharacter: (id: string) =>
    req<{ ok: true }>(`/api/characters/${id}`, { method: 'DELETE' }),

  /** Stamp a bestiary entry out into real characters. */
  spawn: (campaignId: string, npcId: string, count: number) =>
    req<{ characters: Character[] }>(`/api/campaigns/${campaignId}/spawn`, {
      method: 'POST',
      body: JSON.stringify({ npcId, count }),
    }),

  /** Put a prepared fight on the table. Re-deploying resets it. */
  deployEncounter: (campaignId: string, encounterId: string) =>
    req<{
      characters: Character[];
      missing: string[];
      /** What each foe rolled for turn order, by character id. */
      rolls: Record<string, { total: number; faces: string[] }>;
    }>(
      `/api/campaigns/${campaignId}/encounters/${encounterId}/deploy`,
      { method: 'POST' },
    ),

  /** Sweep every NPC off the table, whatever put it there. */
  clearTable: (campaignId: string) =>
    req<{ cleared: number }>(`/api/campaigns/${campaignId}/table/clear`, {
      method: 'POST',
    }),


  duplicateCharacter: (id: string) =>
    req<Character>(`/api/characters/${id}/duplicate`, { method: 'POST' }),

  seat: (characterId: string) =>
    req<{ character: Character; campaign: Campaign | null; packs: PackRecord[] }>(
      `/api/seat/${characterId}`,
    ),

  // --- Screens ---------------------------------------------------------
  // A screen announcing itself. No auth: this is how a screen comes to
  // exist, and a brand new one is blank and belongs to nobody.
  hello: (id: string) =>
    req<{ display: Display; handle: string }>('/api/displays/hello', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  displays: (campaignId: string) =>
    req<Display[]>(`/api/campaigns/${campaignId}/displays`),

  /** Move a screen to this campaign — it was always on this host. */
  bringDisplay: (campaignId: string, displayId: string) =>
    req<{ display: Display }>(
      `/api/campaigns/${campaignId}/displays/${displayId}/bring`,
      { method: 'POST' },
    ),

  claimDisplay: (campaignId: string, code: string, name?: string) =>
    req<{ display: Display }>(`/api/campaigns/${campaignId}/displays/claim`, {
      method: 'POST',
      body: JSON.stringify({ code, name }),
    }),

  /** This screen telling the books how big it is. Telemetry, not control. */
  reportViewport: (w: number, h: number) =>
    req<{ ok: true }>('/api/displays/viewport', {
      method: 'POST',
      body: JSON.stringify({ w, h }),
    }),

  patchDisplay: (
    id: string,
    patch: {
      name?: string;
      color?: string;
      role?: DisplayRole;
      params?: DisplayParams;
      ppi?: number | null;
      ppiY?: number | null;
    },
  ) =>
    req<{ display: Display }>(`/api/displays/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  forgetDisplay: (id: string) =>
    req<{ ok: true }>(`/api/displays/${id}`, { method: 'DELETE' }),

  /** Put a calibration pattern on the table, or null to take it away. */
  setCalibration: (campaignId: string, calibration: Calibration | null) =>
    req<{ ok: true }>(`/api/campaigns/${campaignId}/calibration`, {
      method: 'POST',
      body: JSON.stringify({ calibration }),
    }),

  identifyDisplay: (id: string) =>
    req<{ ok: true }>(`/api/displays/${id}/identify`, { method: 'POST' }),

  // --- Rulebooks -------------------------------------------------------
  // A book lives on the host. Upload it once; every screen reads it.
  books: () => req<Book[]>('/api/books'),

  /**
   * Add a book by handing the host the file.
   *
   * The host names it — the id is the sha-256 of the bytes, so the same
   * rulebook is the same book on anyone's host, which is what lets a
   * `.tell` file refer to it. The browser couldn't compute that anyway:
   * crypto.subtle doesn't exist on the plain-HTTP origin a table's host
   * serves from.
   */
  addBook: (file: File) => {
    const params = new URLSearchParams({
      name: file.name.replace(/\.pdf$/i, ''),
    });
    return req<{ book: Book; duplicate: boolean }>(`/api/books?${params}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': 'application/pdf' },
    });
  },

  /**
   * Permission to read one book, as a URL.
   *
   * The viewer is an iframe and an iframe sends no headers, so the key
   * can't ride along — and fetching the file into a blob first would
   * throw away the range streaming that makes opening page 184 of a
   * 200MB rulebook instant.
   */
  bookTicket: (bookId: string) =>
    req<{ url: string }>(`/api/books/${bookId}/ticket`, { method: 'POST' }),

  searchBooks: (q: string) =>
    req<{ hits: BookHit[]; total: number }>(
      `/api/books/search?q=${encodeURIComponent(q)}`,
    ),

  deleteBook: (id: string) => req<{ ok: true }>(`/api/books/${id}`, { method: 'DELETE' }),

  packs: (system: string) =>
    req<PackRecord[]>(`/api/packs?system=${encodeURIComponent(system)}`),

  putPack: (pack: RulesPack) =>
    req<PackRecord>('/api/packs', { method: 'PUT', body: JSON.stringify(pack) }),

  deletePack: (id: string) =>
    req<{ ok: true }>(`/api/packs/${id}`, { method: 'DELETE' }),

  // --- .tell bundles -----------------------------------------------------
  // A whole game in one file: import merges what's present and skips what
  // isn't, export is also the backup.
  inspectBundle: (file: File) =>
    req<BundleSummary>('/api/bundles/inspect', { method: 'POST', body: file }),

  importBundle: (
    file: File,
    opts: { campaignId?: string; sections?: string[]; name?: string } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.campaignId) params.set('campaign', opts.campaignId);
    if (opts.sections) params.set('sections', opts.sections.join(','));
    if (opts.name) params.set('name', opts.name);
    const query = params.toString();
    return req<{ campaignId: string; applied: string[]; skipped: string[] }>(
      `/api/bundles/import${query ? `?${query}` : ''}`,
      { method: 'POST', body: file },
    );
  },

  /**
   * Download a campaign as a .tell file.
   *
   * Fetched rather than linked: export needs the key, and a plain
   * `<a download>` sends no headers — it would just 401. The key could
   * ride in the query string instead, but secrets don't belong in URLs
   * where history and logs can keep them.
   *
   * The cost is that the bundle is assembled in memory before it's
   * saved. Same known limit as import, and the same follow-up.
   */
  downloadBundle: async (campaignId: string, name: string) => {
    const res = await fetch(`/api/campaigns/${campaignId}/export`, {
      headers: authHeaders(new Headers()),
    });
    if (!res.ok) throw new Error(`export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign'}.tell`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * Permission to listen to a campaign's live session.
   *
   * EventSource can't send headers, so the proof rides in the URL. Any
   * screen the DM adopted into this campaign may have one — a table TV
   * needs turn order as much as the console does.
   */
  streamTicket: (campaignId: string) =>
    req<{ ticket: string }>(`/api/campaigns/${campaignId}/stream-ticket`, {
      method: 'POST',
    }),

  /** Roll turn order for every NPC in the list; players report their own. */
  rollNpcInitiative: (campaignId: string) =>
    req<{ session: SessionState; rolled: number }>(
      `/api/campaigns/${campaignId}/initiative/roll`,
      { method: 'POST' },
    ),

  sessionOp: (campaignId: string, op: SessionOp) =>
    req<SessionState>(
      `/api/campaigns/${campaignId}/session`,
      { method: 'POST', body: JSON.stringify(op) },
    ),
};

export function newLocalId(prefix: string): string {
  // getRandomValues, not randomUUID: a screen on a table's own network is
  // served over plain HTTP, and randomUUID is secure-context-only. This
  // one isn't, and four bytes is plenty for an id that's unique within a
  // single character sheet.
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

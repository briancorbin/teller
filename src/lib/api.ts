import type {
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
 * This screen's identity. It's what the server checks to decide what
 * this screen may do, so it lives here and is never rendered — unlike
 * the pairing code, which exists to be read aloud.
 */
export function getDisplayId(): string {
  return localStorage.getItem(DISPLAY_ID_STORAGE) ?? '';
}

export function setDisplayId(id: string): void {
  localStorage.setItem(DISPLAY_ID_STORAGE, id);
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

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(new Headers(init.headers));
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
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
    req<{ campaign: Campaign; characters: Character[] }>(
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
    req<{ display: Display }>('/api/displays/hello', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  displays: (campaignId: string) =>
    req<Display[]>(`/api/campaigns/${campaignId}/displays`),

  claimDisplay: (campaignId: string, code: string, name?: string) =>
    req<{ display: Display }>(`/api/campaigns/${campaignId}/displays/claim`, {
      method: 'POST',
      body: JSON.stringify({ code, name }),
    }),

  patchDisplay: (
    id: string,
    patch: { name?: string; color?: string; role?: DisplayRole; params?: DisplayParams },
  ) =>
    req<{ display: Display }>(`/api/displays/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  forgetDisplay: (id: string) =>
    req<{ ok: true }>(`/api/displays/${id}`, { method: 'DELETE' }),

  identifyDisplay: (id: string) =>
    req<{ ok: true }>(`/api/displays/${id}/identify`, { method: 'POST' }),

  packs: (system: string) =>
    req<PackRecord[]>(`/api/packs?system=${encodeURIComponent(system)}`),

  putPack: (pack: RulesPack) =>
    req<PackRecord>('/api/packs', { method: 'PUT', body: JSON.stringify(pack) }),

  deletePack: (id: string) =>
    req<{ ok: true }>(`/api/packs/${id}`, { method: 'DELETE' }),

  sessionOp: (campaignId: string, op: SessionOp) =>
    req<SessionState>(
      `/api/campaigns/${campaignId}/session`,
      { method: 'POST', body: JSON.stringify(op) },
    ),
};

export function newLocalId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

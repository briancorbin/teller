import type {
  Campaign,
  CampaignData,
  Character,
  CharacterData,
  PackRecord,
  PublicCharacter,
  RulesPack,
  SessionOp,
  SessionState,
  SystemTemplate,
} from '../../worker/types';

const DM_KEY_STORAGE = 'teller.dmKey';

export function getDmKey(): string {
  return localStorage.getItem(DM_KEY_STORAGE) ?? '';
}

export function setDmKey(key: string): void {
  localStorage.setItem(DM_KEY_STORAGE, key);
}

async function req<T>(
  path: string,
  init: RequestInit = {},
  dm = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (dm) headers.set('x-teller-key', getDmKey());
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  templates: () => req<SystemTemplate[]>('/api/templates'),

  listCampaigns: () => req<Campaign[]>('/api/campaigns', {}, true),

  createCampaign: (name: string, system: string) =>
    req<Campaign>(
      '/api/campaigns',
      { method: 'POST', body: JSON.stringify({ name, system }) },
      true,
    ),

  publicCampaign: (id: string) =>
    req<{ campaign: Campaign; characters: PublicCharacter[] }>(
      `/api/campaigns/${id}/public`,
    ),

  getCampaign: (id: string) =>
    req<{ campaign: Campaign; characters: Character[] }>(
      `/api/campaigns/${id}`,
      {},
      true,
    ),

  patchCampaign: (id: string, patch: { name?: string; data?: Partial<CampaignData> }) =>
    req<Campaign>(
      `/api/campaigns/${id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      true,
    ),

  createCharacter: (campaignId: string, name: string, kind: 'pc' | 'npc') =>
    req<Character>(
      `/api/campaigns/${campaignId}/characters`,
      { method: 'POST', body: JSON.stringify({ name, kind }) },
      true,
    ),

  patchCharacter: (
    id: string,
    patch: { name?: string; data?: Partial<CharacterData> },
    seatToken?: string,
  ) =>
    req<Character>(
      `/api/characters/${id}${seatToken ? `?token=${encodeURIComponent(seatToken)}` : ''}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
      !seatToken,
    ),

  deleteCampaign: (id: string) =>
    req<{ ok: true }>(`/api/campaigns/${id}`, { method: 'DELETE' }, true),

  undo: (campaignId: string) =>
    req<{ undid: string; entityId: string | null }>(
      `/api/campaigns/${campaignId}/undo`,
      { method: 'POST' },
      true,
    ),

  uploadMap: async (campaignId: string, file: File) => {
    const res = await fetch(`/api/campaigns/${campaignId}/map`, {
      method: 'PUT',
      headers: { 'x-teller-key': getDmKey(), 'content-type': file.type },
      body: file,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ map: { key: string } }>;
  },

  removeMap: (campaignId: string) =>
    req<{ ok: true }>(`/api/campaigns/${campaignId}/map`, { method: 'DELETE' }, true),

  deleteCharacter: (id: string) =>
    req<{ ok: true }>(`/api/characters/${id}`, { method: 'DELETE' }, true),

  seat: (characterId: string, token: string) =>
    req<{ character: Character; campaign: Campaign | null; packs: PackRecord[] }>(
      `/api/seat/${characterId}?token=${encodeURIComponent(token)}`,
    ),

  packs: (system: string) =>
    req<PackRecord[]>(`/api/packs?system=${encodeURIComponent(system)}`, {}, true),

  putPack: (pack: RulesPack) =>
    req<PackRecord>('/api/packs', { method: 'PUT', body: JSON.stringify(pack) }, true),

  deletePack: (id: string) =>
    req<{ ok: true }>(`/api/packs/${id}`, { method: 'DELETE' }, true),

  sessionOp: (campaignId: string, op: SessionOp) =>
    req<SessionState>(
      `/api/campaigns/${campaignId}/session`,
      { method: 'POST', body: JSON.stringify(op) },
      true,
    ),
};

export function seatLink(character: Character): string {
  return `${window.location.origin}/seat/${character.id}?token=${character.data.seatToken}`;
}

export function newLocalId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

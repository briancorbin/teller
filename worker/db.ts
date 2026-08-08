import type { Campaign, CampaignData, Character, CharacterData } from './types';

export type Env = {
  DB: D1Database;
  CAMPAIGN: DurableObjectNamespace;
  ASSETS: Fetcher;
  DM_KEY?: string;
};

// Raw D1 rows never leave the worker — per-resource serializers coerce
// and parse (the worker-row-serializer rule, carried over from the shed).

type CampaignRow = {
  id: string;
  name: string;
  system: string;
  data: string;
  created_at: string;
};

type CharacterRow = {
  id: string;
  campaign_id: string;
  name: string;
  kind: string;
  data: string;
  created_at: string;
  updated_at: string;
};

export function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    data: JSON.parse(row.data) as CampaignData,
    createdAt: row.created_at,
  };
}

export function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    kind: row.kind === 'npc' ? 'npc' : 'pc',
    data: JSON.parse(row.data) as CharacterData,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function logEvent(
  env: Env,
  campaignId: string,
  entityId: string | null,
  actor: string,
  kind: string,
  payload: unknown,
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO events (campaign_id, entity_id, actor, kind, payload) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(campaignId, entityId, actor, kind, JSON.stringify(payload ?? {}))
    .run();
}

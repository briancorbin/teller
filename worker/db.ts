import type {
  Campaign,
  CampaignData,
  Character,
  CharacterData,
  Counter,
  Display,
  DisplayParams,
  DisplayRole,
  PackRecord,
  PublicCharacter,
  RulesPack,
  Scene,
} from './types';

/** Ids are opaque and unguessable; the prefix is for humans reading rows. */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export type Env = {
  DB: D1Database;
  CAMPAIGN: DurableObjectNamespace;
  ASSETS: Fetcher;
  MAPS: R2Bucket;
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

type DisplayRow = {
  id: string;
  campaign_id: string | null;
  name: string;
  color: string;
  role: string;
  params: string;
  ppi: number | null;
  ppi_y: number | null;
  vw: number | null;
  vh: number | null;
  code: string | null;
  code_expires_at: string | null;
  last_seen_at: string;
  created_at: string;
};

const ROLES: DisplayRole[] = [
  'blank',
  'table',
  'board',
  'art',
  'badge',
  'seat',
  'console',
];

/**
 * Note what does NOT come out of here: `code_expires_at` is internal,
 * and the row's own id is echoed back only because the caller is the
 * display itself or the DM. Never hand a display list to a passive
 * surface — the ids in it are capabilities.
 */
export function toDisplay(row: DisplayRow): Display {
  const role = ROLES.includes(row.role as DisplayRole)
    ? (row.role as DisplayRole)
    : 'blank';
  let params: DisplayParams = {};
  try {
    params = JSON.parse(row.params) as DisplayParams;
  } catch {
    params = {};
  }
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    color: row.color,
    role,
    params,
    ppi: row.ppi,
    // Calibrated before the vertical axis existed = square pixels.
    ppiY: row.ppi_y ?? row.ppi,
    viewport: row.vw && row.vh ? { w: row.vw, h: row.vh } : null,
    code: row.code,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export function toCampaign(row: CampaignRow): Campaign {
  const data = JSON.parse(row.data) as CampaignData;
  // Rows calibrated before the vertical axis existed carry one number;
  // square pixels are the sane reading of it.
  if (data.grid?.ppi && !data.grid.ppiY) data.grid.ppiY = data.grid.ppi;
  return {
    id: row.id,
    name: row.name,
    system: row.system,
    data,
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

type PackRow = {
  id: string;
  system: string;
  name: string;
  data: string;
  updated_at: string;
};

export function toPackRecord(row: PackRow): PackRecord {
  return {
    id: row.id,
    system: row.system,
    name: row.name,
    pack: JSON.parse(row.data) as RulesPack,
    updatedAt: row.updated_at,
  };
}

/** Counters as the player-facing surfaces may see them. */
export function publicCounters(counters: Counter[]): Counter[] {
  return counters.filter((c) => !c.hidden);
}

/**
 * The active scene as the table may see it: hidden tokens and hidden
 * painted zones are removed from the payload entirely — an ambush the
 * players can't inspect in devtools.
 */
export function publicScene(data: CampaignData): Scene | null {
  const scene = (data.maps ?? []).find((s) => s.id === data.activeMapId);
  if (!scene) return null;
  return {
    ...scene,
    tokens: (scene.tokens ?? []).filter((t) => !t.hidden),
    zones: (scene.zones ?? []).filter((z) => !z.hidden),
    // Fog is flattened to plain revealed cells: the table has no need
    // for the shape or name of a room nobody has walked into yet.
    fog: scene.fog
      ? {
          on: scene.fog.on,
          revealed: [
            ...(scene.fog.revealed ?? []),
            ...(scene.fog.regions ?? [])
              .filter((r) => r.revealed)
              .flatMap((r) => r.cells),
          ],
        }
      : undefined,
  };
}

/**
 * Qualitative wound state from the first max-bearing counter (the
 * vitality-by-convention slot). A STATE, not a number — safe to show
 * the table even for NPCs.
 *
 * `down` means the counter is at zero, and it is deliberately not
 * called `dead`. At Brian's table zero kills by default — if you want
 * a prisoner you keep them above it — but an important NPC may bleed
 * out instead, which is an ordinary counter the Warden adds (rule 2).
 * So teller reports where the number is and the table rules on what
 * that means; nothing in code may branch on what `down` implies.
 */
function vitalityOf(
  counters: Counter[],
): 'healthy' | 'bloodied' | 'critical' | 'down' | undefined {
  const vital = counters.find((c) => c.max !== null && c.max > 0);
  if (!vital) return undefined;
  if (vital.current <= 0) return 'down';
  const ratio = vital.current / vital.max!;
  return ratio <= 0.25 ? 'critical' : ratio <= 0.5 ? 'bloodied' : 'healthy';
}

export function toPublicCharacter(row: CharacterRow): PublicCharacter {
  const character = toCharacter(row);
  const npc = character.kind === 'npc';
  return {
    id: character.id,
    campaignId: character.campaignId,
    name: character.name,
    kind: character.kind,
    data: {
      // NPCs keep only tags — the table may know a wolf is Bloodied,
      // never its numbers. Seat tokens and notes never leave for anyone,
      // and hidden counters stay behind the screen until revealed.
      //
      // `items` is absent DELIBERATELY, not forgotten: what a character
      // carries is their own business, and the table-facing surfaces
      // (board, badge, art) have no use for a weapon list. This is an
      // allowlist for exactly that reason — anything new is private
      // until someone decides otherwise, which is the right default for
      // a snapshot that leaves the player's own screen.
      fields: npc ? [] : character.data.fields,
      counters: npc ? [] : publicCounters(character.data.counters),
      tags: character.data.tags,
      vitality: vitalityOf(character.data.counters),
    },
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

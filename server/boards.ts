// BOARDS — the battlemap as an ASSET (§4), and the door its picture
// comes in through.
//
// A board is `{ id, key, name, widthInches, grid }` on the SHELF, the
// same category as a book or a pack's art: reusable across campaigns,
// referenced by id, and nothing about a fight is in it. What's on it
// right now — placements, fog, zones, the view — is `board_state`, per
// campaign, and never travels in a `.story`.
//
// This file is the handout door's twin (`server/handouts.ts`) and
// deliberately so: bytes in, content-hash out, same-picture-twice costs
// one copy. Three things differ, each for a reason:
//
//   * The bytes land under `map/`, not `art/`. Both are roots `/files/`
//     will serve, and the old world's board images already live there —
//     a DM copying `~/.teller/map/` across keeps every key working.
//   * A board is allowed to be BIG. A handout is a photo of a napkin;
//     a battlemap is print-destined artwork (Boylei's are 10800px at
//     300dpi), so the cap is 64 MB rather than 16.
//   * The ROW is a shelf row, not a campaign template, because a board
//     outlives the campaign that showed it.
//
// `widthInches` and `grid` are calibration between pixels and the room
// (§4) — teller-the-program, not campaign content — which is why they
// sit on the asset and not in the state.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How big a picture the door will take. A battlemap is print artwork. */
export const MAX_BYTES = 64 * 1024 * 1024;

/** What an image arrives as, and what it lands on disk as. Nothing else is accepted. */
const EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Is this a picture, and what does it land as? Undefined means "not one". */
export function extFor(contentType: string): string | undefined {
  return EXTS[contentType.split(';')[0].trim().toLowerCase()];
}

/**
 * Put the bytes on the shelf and answer the key.
 *
 * Content-hashed, so the same map dropped twice is one file — and so a
 * board's picture has a name nobody had to choose. The ROW's identity is
 * still its minted `brd_` id (rule 4a): renaming a board, or two boards
 * over one picture (a lit version and a dark one), is ordinary.
 */
export function saveBoardBytes(dataDir: string, bytes: Buffer, ext: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const key = `map/${hash}.${ext}`;
  const path = join(dataDir, key);
  mkdirSync(join(dataDir, 'map'), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, bytes);
  return key;
}

/** The grid style a board draws with — read defensively, since it's blob. */
export type BoardGrid = { on?: boolean; color?: string; opacity?: number };

/**
 * What an author may say about a board's grid, and nothing else.
 *
 * Narrow rather than pass-through: the grid rides to every passive
 * surface inside the snapshot, and a blob that accepted anything would
 * be a channel from the console to the table that nobody was watching.
 * An empty result reads as "no opinion" — the table's own defaults.
 */
export function toGrid(raw: unknown): BoardGrid | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as { on?: unknown; color?: unknown; opacity?: unknown };
  const out: BoardGrid = {};
  if (typeof o.on === 'boolean') out.on = o.on;
  if (typeof o.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.color)) out.color = o.color;
  if (typeof o.opacity === 'number' && o.opacity >= 0 && o.opacity <= 1) out.opacity = o.opacity;
  return Object.keys(out).length ? out : undefined;
}

/**
 * A map's intended physical width, in true inches — the one fact that
 * makes a drawn square a real inch (docs/BATTLEMAP.md). Absent is
 * legitimate and means fit-to-screen with no cells, so this answers
 * `null` for "the author said no width" and `undefined` for "the author
 * didn't mention it".
 */
export function toWidthInches(raw: unknown): number | null | undefined {
  if (raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

import { useMemo, useState } from 'react';
import type { SourcedNpc } from '../../worker/bestiary';
import { btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { CreatureSheet } from './CreatureSheet';

// The bestiary: everything you could put in front of the party.
//
// A wall of buttons stopped working the moment a pack brought sixty
// foes with it, so this is a list you search rather than a row you
// scan. Open one to see what it actually is before you commit to
// dropping three of them on the table.
//
// It shows what packs bring AND what this campaign wrote itself, which
// is the merge the server already did — `from` says which, so a foe
// you've retuned is distinguishable from the one the book describes.

/** Match against the name first, then anything written on the sheet. */
function matches(npc: SourcedNpc, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  if (npc.name.toLowerCase().includes(q)) return true;
  return npc.fields.some((f) => String(f.value).toLowerCase().includes(q));
}

/** The campaign's own, as opposed to any pack's. */
const OWN = 'yours';

/**
 * Which shelf a foe sits on — and it can be more than one.
 *
 * A foe printed in both a core bestiary and the adventure that reprints
 * it belongs to BOTH packs, so filtering to the adventure has to show it
 * even when this table currently takes the core printing. Matching on
 * `from` alone would hide it, because `from` names only the winner.
 *
 * A foe the campaign retuned keeps its pack sources (see `bestiaryFor`),
 * so it answers to its pack AND to `yours`. That's not a bug to
 * normalise away: it is exactly both of those things.
 */
function shelved(npc: SourcedNpc, source: string): boolean {
  if (source === OWN) return !npc.from;
  return npc.sources?.some((s) => s.pack === source) ?? false;
}

export function BestiaryPanel({
  npcs,
  onSpawn,
  picks,
  onPick,
}: {
  npcs: SourcedNpc[];
  onSpawn: (npcId: string, count: number) => void;
  /** npc id → pack id this table uses, when a foe is printed twice. */
  picks?: Record<string, string>;
  /** Absent on a surface that may look but not decide. */
  onPick?: (npcId: string, packId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [source, setSource] = useState<string | null>(null);

  // Every shelf represented here, biggest first. Derived from the foes
  // themselves rather than from the packs list, so a pack that brought
  // rules but no bestiary never becomes a chip that filters to nothing.
  const shelves = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const npc of npcs) {
      if (!npc.from) bump(OWN);
      for (const s of npc.sources ?? []) bump(s.pack);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [npcs]);

  const found = useMemo(
    () =>
      npcs.filter(
        (n) => matches(n, query.trim()) && (!source || shelved(n, source)),
      ),
    [npcs, query, source],
  );

  const shown = open ? npcs.find((n) => n.id === open) : undefined;

  return (
    <section className={`${card} @container space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Bestiary</span>
        <span className="font-mono text-[11px] text-stone-600">
          {query || source ? `${found.length} of ${npcs.length}` : `${npcs.length} foes`}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="wolf, bear, 2G…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* How many land when you pick one — set it once, then browse. */}
        <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.max(1, n - 1))}
            aria-label="fewer"
          >
            −
          </button>
          <span className="w-7 text-center font-mono text-sm text-stone-300">×{count}</span>
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.min(20, n + 1))}
            aria-label="more"
          >
            +
          </button>
        </span>
      </div>

      {/* One shelf needs no chooser — the label would only ever say
          "everything". It appears when a second pack does. */}
      {shelves.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            className={`${btnGhost} font-mono text-[11px] ${
              source ? 'text-stone-600' : 'text-amber-400'
            }`}
            onClick={() => setSource(null)}
            aria-pressed={!source}
          >
            all
          </button>
          {shelves.map(([name, n]) => (
            <button
              key={name}
              className={`${btnGhost} font-mono text-[11px] ${
                source === name ? 'text-amber-400' : 'text-stone-600'
              }`}
              onClick={() => setSource(source === name ? null : name)}
              aria-pressed={source === name}
              title={
                name === OWN
                  ? 'foes this campaign wrote or retuned'
                  : `foes printed in ${name}`
              }
            >
              {name} <span className="text-stone-700">{n}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1">
        {found.map((npc) => {
          const health = npc.counters.find((c) => /health|hp/i.test(c.name));
          return (
            <li key={npc.id} className="rounded-md bg-stone-900">
              <button
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left"
                onClick={() => setOpen(npc.id)}
                title="see the whole printing"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
                  {npc.name}
                </span>
                {health && (
                  <span className="font-mono text-[11px] text-stone-500">
                    {health.max ?? health.current} hp
                  </span>
                )}
                <span className="font-mono text-[11px] text-stone-600">
                  {npc.from ?? 'yours'}
                </span>
              </button>
            </li>
          );
        })}
        {found.length === 0 && (
          <li className="text-sm text-stone-600">
            {!npcs.length
              ? 'no foes yet — a pack brings them'
              : query
                ? `nothing by that name${source ? ` in ${source}` : ''}`
                : `nothing in ${source}`}
          </li>
        )}
      </ul>

      {/*
        A printing you looked up is a DETOUR, and a detour should
        announce itself and end (Brian, 2026-08-15: "can it be a popup
        modal like the encounter … instead of it opening up on the
        page"). Expanding in place pushed sixty rows down the screen and
        left you scrolling to find where you were.

        The sheet takes a character, and a blueprint is not one — no
        campaign, no tags, nothing anybody is spending down. So it wears
        a character's shape for the length of one read-only view, and
        the sheet renders its counters as what the BOOK prints rather
        than as bars with steppers.
      */}
      {shown && (
        <CreatureSheet
          character={{
            id: shown.id,
            campaignId: '',
            name: shown.name,
            kind: 'npc',
            data: {
              fields: shown.fields,
              counters: shown.counters,
              tags: [],
              items: [],
              blueprintId: shown.id,
              notes: '',
            },
            createdAt: '',
            updatedAt: '',
          }}
          npcs={[shown]}
          picks={picks}
          onPick={onPick}
          onClose={() => setOpen(null)}
          actions={
            <button
              className={btnPrimary}
              onClick={() => {
                onSpawn(shown.id, count);
                setOpen(null);
              }}
            >
              add {count > 1 ? `${count} ` : ''}to the fight
            </button>
          }
        />
      )}

      {/* The book itself opens from inside the sheet now — the row that
          used to own a reader is just a row again. */}
    </section>
  );
}

/**
 * The compact version, for the encounter pane.
 *
 * Mid-fight you already know what you want, so this is a filter box and
 * the first few matches — not sixty buttons to hunt through. Browsing
 * belongs in the bestiary pane.
 */
export function QuickSpawn({
  npcs,
  onSpawn,
}: {
  npcs: SourcedNpc[];
  onSpawn: (npcId: string, count: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [count, setCount] = useState(1);
  // Nothing until you ask. An always-on list of the first eight foes was
  // just the alphabet — "Alligator Snapping Turtle" is not a suggestion,
  // it's the top of a sorted array, and it filled the panel with noise
  // you had to read past to reach the fight.
  const asked = query.trim();
  const found = asked ? npcs.filter((n) => matches(n, asked)).slice(0, 8) : [];

  if (!npcs.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={sectionLabel}>Bestiary</span>
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder={`search ${npcs.length} foes…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="flex items-center gap-1 rounded-md bg-stone-900 px-1">
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.max(1, n - 1))}
            aria-label="fewer"
          >
            −
          </button>
          <span className="w-7 text-center font-mono text-sm text-stone-300">×{count}</span>
          <button
            className={btnGhost}
            onClick={() => setCount((n) => Math.min(20, n + 1))}
            aria-label="more"
          >
            +
          </button>
        </span>
      </div>
      {/* Results hang under the box like a dropdown, and clear when you
          take one — you came here to add a foe, not to browse. */}
      {asked && (
        <ul className="overflow-hidden rounded-md bg-stone-900">
          {found.map((n) => (
            <li key={n.id}>
              <button
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-stone-800"
                onClick={() => {
                  onSpawn(n.id, count);
                  setQuery('');
                }}
              >
                <span className="text-amber-400">+</span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
                  {n.name}
                </span>
                {count > 1 && (
                  <span className="font-mono text-[11px] text-amber-400/80">
                    ×{count}
                  </span>
                )}
                <span className="font-mono text-[11px] text-stone-600">
                  {n.from ?? 'yours'}
                </span>
              </button>
            </li>
          ))}
          {!found.length && (
            <li className="px-2 py-1.5 text-sm text-stone-600">
              nothing by that name
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

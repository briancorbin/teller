// One carried thing, on its own tile — ported from the old app's
// `src/components/sheet/ItemPanel.tsx`, trimmed to what §K's flat
// children actually carry: no upgrade back-face (an upgrade is now its
// own tile on Inventory, wearing a "fitted to …" chip, rather than a
// flip on the weapon that holds it — see `InventoryTile` below), no
// notch/history face (growth/etching isn't part of this port), no
// Talent tick (marks aren't wired to items yet). What's kept: the
// stats in catalogue order, a resource stepper for whatever the item
// itself counts down (ammo's rounds, an ability's uses), and the
// chamber-select-plus-trigger for anything `use` prices.

import type { Entity, Entry, Ref } from '../../../core/entity.ts';
import { writeChildEntry, writeRef } from '../../lib/refs.ts';
import { SheetPanel } from '../sheet/SheetPanel.tsx';
import { StatRow } from './Track.tsx';
import type { UseRecord } from './types.ts';

function numberOf(entry: Entry | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** The child's own resource entry — ammo's Rounds/Arrows, an ability's
 * Uses, a Medical Kit's Supplies. Never `stats` — a weapon's Grit is a
 * stat (its cost, drawn as a row above), not something this stepper
 * should also offer to decrement.
 *
 * `resources` first because that's where this system files them, and
 * `counters` after because that's the word a catalogue entry authored
 * its own with (`toTemplate` keeps the author's key rather than
 * renaming it, so a box of rounds bought at the counter reads its pool
 * through the template like everything else a thin stamp derives). The
 * ordered-preference shape is `vitalIn`'s, for the same reason. */
const POOL_LISTS = ['resources', 'counters'];

function poolEntryOf(child: Entity): { list: string; entry: Entry } | undefined {
  for (const list of POOL_LISTS) {
    const entry = (child.lists[list] ?? []).find((e) => typeof e.value === 'number');
    if (entry) return { list, entry };
  }
  return undefined;
}

/** A stepper for the item's own countdown — Rounds, Arrows, Uses, Supplies. */
function CounterRow({
  entry,
  onWrite,
}: {
  entry: Entry;
  onWrite: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-stone-800 bg-stone-900/60 px-2 py-1">
      <span className="min-w-0 flex-1 break-words text-[0.65rem] uppercase tracking-widest text-stone-500">
        {entry.name}
      </span>
      <span className="whitespace-nowrap font-mono text-sm tabular-nums text-stone-100">
        {numberOf(entry)}
        {typeof entry.max === 'number' && <span className="text-stone-600">/{entry.max}</span>}
      </span>
      <button
        type="button"
        aria-label={`decrease ${entry.name}`}
        onClick={() => onWrite(Math.max(0, numberOf(entry) - 1))}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stone-800 text-stone-200 hover:bg-stone-700"
      >
        −
      </button>
      <button
        type="button"
        aria-label={`increase ${entry.name}`}
        onClick={() => onWrite(entry.max !== undefined ? Math.min(entry.max, numberOf(entry) + 1) : numberOf(entry) + 1)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stone-800 text-stone-200 hover:bg-stone-700"
      >
        +
      </button>
    </div>
  );
}

export function ItemTile({
  characterId,
  child,
  fill = false,
  use,
  arming = false,
  ammoPool = [],
  costEntry,
  onFireCost,
  extras = [],
  fittedTo,
}: {
  characterId: string;
  child: Entity;
  /** Stretch to the shelf's height (mounted glass); natural height held. */
  fill?: boolean;
  use?: UseRecord;
  /** Offer the chamber select + trigger — declared per SCREEN (`screens[].arms`), not per item. */
  arming?: boolean;
  /** The character's own ammo children — what a chamber select offers. */
  ammoPool?: Entity[];
  /** This item's own priced entry, read off ITS stats (the weapon's own Grit box). */
  costEntry?: Entry;
  /** Spend the character's cost counter + extras + one chambered round — resolved by the SCREEN, which holds the character-level balances this tile doesn't. */
  onFireCost?: (total: number) => void;
  /** The item's additional prices (`use.costs`), already resolved against this item's own stats. */
  extras?: { counter: string; amount: number }[];
  /** "fitted to <weapon name>" — an upgrade wearing where it's bolted on. */
  fittedTo?: string;
}) {
  const chamberedRef = child.refs?.chambered as Ref | undefined;
  const chambered = ammoPool.find((a) => a.id === chamberedRef?.id);
  const pool = poolEntryOf(child);
  const stats = child.lists.stats ?? [];
  const bodyRows = costEntry ? stats.filter((s) => s !== costEntry) : stats;

  const price = numberOf(costEntry);
  const fireable = Boolean(onFireCost) && Boolean(use) && costEntry !== undefined && price > 0;
  const verb = use?.verbs?.[child.type ?? ''] ?? use?.verb ?? 'Use';
  const total = price + extras.reduce((n, e) => n + e.amount, 0);

  return (
    <SheetPanel title={child.name} fill={fill} className="w-full">
      <div className={`flex flex-col gap-1 ${fill ? 'min-h-0 flex-1' : ''}`}>
        {costEntry && <StatRow label={costEntry.name} value={String(costEntry.value ?? '')} />}
        {bodyRows.map((field) => (
          <StatRow key={field.name} label={field.name} value={String(field.value ?? '')} />
        ))}

        {fittedTo && (
          <span
            className="mt-1 w-fit rounded-full border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider"
            style={{ borderColor: 'var(--sheet-accent, #f59e0b)', color: 'var(--sheet-accent, #f59e0b)' }}
          >
            fitted to {fittedTo}
          </span>
        )}

        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          {arming && use?.consumesKind && (
            <select
              className="h-9 min-w-0 rounded-md border border-stone-700 bg-stone-900 px-2 text-[0.75rem] text-stone-200 focus:border-stone-500 focus:outline-none"
              value={chambered?.id ?? ''}
              onChange={(e) => {
                const next = ammoPool.find((a) => a.id === e.target.value);
                writeRef(characterId, child.id, 'chambered', next ? { id: next.id, name: next.name } : null);
              }}
              aria-label={`what ${child.name} is loaded with`}
            >
              <option value="">—</option>
              {ammoPool.map((a) => {
                const roundsHere = poolEntryOf(a);
                return (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {roundsHere ? ` · ${numberOf(roundsHere.entry)}` : ''}
                  </option>
                );
              })}
            </select>
          )}

          {fireable && (
            <button
              type="button"
              className="flex h-9 shrink-0 items-center justify-center rounded-md border-2 px-3 font-mono text-sm font-bold tracking-wider transition-colors active:bg-stone-800"
              style={{ borderColor: 'var(--sheet-accent, #f59e0b)', color: 'var(--sheet-accent, #f59e0b)' }}
              onClick={() => {
                onFireCost?.(total);
                if (chambered) {
                  const roundsHere = poolEntryOf(chambered);
                  if (roundsHere) {
                    writeChildEntry(characterId, chambered.id, roundsHere.list, roundsHere.entry.name, {
                      value: Math.max(0, numberOf(roundsHere.entry) - 1),
                    });
                  }
                }
              }}
              aria-label={`${verb} ${child.name}: spend ${total} ${use?.costCounter}${
                extras.length ? ` and ${extras.map((e) => `${e.amount} ${e.counter}`).join(' and ')}` : ''
              }${chambered ? ` and one ${chambered.name}` : ''}`}
            >
              {verb} −{total} {use?.costCounter}
            </button>
          )}

          {pool && <CounterRow entry={pool.entry} onWrite={(v) => writeChildEntry(characterId, child.id, pool.list, pool.entry.name, { value: v })} />}
        </div>
      </div>
    </SheetPanel>
  );
}

// One declared carried-screen — Weapons, Abilities, Inventory (WiW) —
// ported from the old app's `carriedScreen` (`src/components/counters/Sheet.tsx`).
// The shelf-pan behaviour (rule 6's "deliberate shelf"), the kind
// filter rail and the pocket/tally lead column are all kept; what's
// gone is the per-screen shop/notch machinery, which isn't part of
// this port.

import { useState } from 'react';
import type { Entity, Entry } from '../../../core/entity.ts';
import type { BlockCtx, Glass } from '../../panels/render.tsx';
import { BigGauge } from '../Counters.tsx';
import { ItemTile } from './ItemTile.tsx';
import { Pocket } from './Purse.tsx';
import type { CurrencyRecord, ScreenDecl, UseRecord } from './types.ts';

function numberOf(entry: Entry | undefined): number {
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** A top-level entry, and which list it lives in — the sparse door needs both. */
function findWithList(e: Entity, name: string): { list: string; entry: Entry } | undefined {
  for (const [list, entries] of Object.entries(e.lists)) {
    const entry = entries.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (entry) return { list, entry };
  }
  return undefined;
}

const TILE_WIDTH = { mounted: 'w-[22rem] shrink-0 snap-start self-stretch', held: 'min-w-[15rem] flex-1 self-start' };

function Shelf({ glass, children }: { glass: Glass; children: React.ReactNode }) {
  return (
    <div
      className={`flex min-h-0 gap-2 ${
        glass === 'mounted'
          ? 'flex-1 snap-x snap-mandatory flex-nowrap items-stretch overflow-x-auto overflow-y-hidden'
          : 'flex-wrap content-start'
      }`}
    >
      {children}
    </div>
  );
}

export function CarriedScreen({
  ctx,
  screen,
  claimedKinds,
}: {
  ctx: BlockCtx;
  screen: ScreenDecl;
  /** Every kind ANY declared screen claims by name — what a `rest` screen catches is what's left over. */
  claimedKinds: Set<string>;
}) {
  const entity = ctx.entity as Entity | undefined;
  if (!entity) return <p className="p-4 text-sm text-stone-500">no entity to show</p>;

  const use = ctx.records.use as UseRecord | undefined;
  const currency = ctx.records.currency as CurrencyRecord | undefined;
  const icons = (ctx.records.icons as Record<string, string> | undefined) ?? {};
  const children = entity.children ?? [];
  const wanted = new Set((screen.kinds ?? []).map((k) => k.toLowerCase()));
  const held = children.filter((c) => {
    const kind = (c.type ?? '').toLowerCase();
    return wanted.has(kind) || (screen.rest === true && !claimedKinds.has(kind));
  });
  const ammoPool = use?.consumesKind
    ? children.filter((c) => (c.type ?? '').toLowerCase() === use.consumesKind!.toLowerCase())
    : [];

  // Every weapon's fitted upgrades, so an upgrade tile on Inventory can
  // wear "fitted to <weapon>" — the outside world addresses upgrades
  // (§K), and the world here is this character's own weapon rack.
  const fittedTo = new Map<string, string>();
  for (const c of children) {
    const upgrades = c.refs?.upgrades;
    const refs = Array.isArray(upgrades) ? upgrades : upgrades ? [upgrades] : [];
    for (const r of refs) fittedTo.set(r.id, c.name);
  }

  const itemKinds = [...new Set(held.map((c) => c.type ?? ''))];
  const [kind, setKind] = useState('');
  const shown = itemKinds.length > 1 && kind ? held.filter((c) => (c.type ?? '') === kind) : held;

  const declared = (screen.counters ?? [])
    .map((name) => findWithList(entity, name))
    .filter((x): x is { list: string; entry: Entry } => Boolean(x));
  const denomNames = new Set((currency?.denominations ?? []).map((d) => d.counter));
  const pocketEntries = declared.filter((d) => icons[d.entry.name] || denomNames.has(d.entry.name)).map((d) => d.entry);
  const tallies = declared.filter((d) => !icons[d.entry.name] && !denomNames.has(d.entry.name));

  const arming = screen.arms === true;

  const write = (target: { list: string; entry: Entry }, value: number) =>
    ctx.write?.({ list: target.list, name: target.entry.name, value });

  const fireCost = (item: Entity, total: number) => {
    if (!use?.costCounter) return;
    const cost = findWithList(entity, use.costCounter);
    if (cost) write(cost, Math.max(0, numberOf(cost.entry) - total));
    for (const c of use.costs ?? []) {
      const stat = (item.lists.stats ?? []).find((s) => s.name === c.counter);
      const amount = numberOf(stat);
      if (!amount) continue;
      const bal = findWithList(entity, c.counter);
      if (bal) write(bal, Math.max(0, numberOf(bal.entry) - amount));
    }
  };

  const mounted = ctx.glass === 'mounted';

  return (
    <div className={`flex min-h-0 flex-1 gap-2 ${mounted ? '' : 'flex-col'}`}>
      {(itemKinds.length > 1 || pocketEntries.length > 0) && (
        <div className={`flex shrink-0 gap-2 self-start ${mounted ? 'flex-col' : 'w-full flex-col'}`}>
          {itemKinds.length > 1 && (
            <div className={`flex gap-1 ${mounted ? 'flex-col' : 'flex-wrap'}`}>
              {['', ...itemKinds].map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`max-w-[7rem] break-words rounded-md px-2 py-1.5 text-left text-[0.65rem] uppercase tracking-[0.14em] transition-colors ${
                    kind === k ? 'text-stone-950' : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                  style={kind === k ? { background: 'var(--sheet-accent, #f59e0b)' } : undefined}
                >
                  {k || 'all'}
                </button>
              ))}
            </div>
          )}
          {pocketEntries.length > 0 && (
            <Pocket
              entries={pocketEntries}
              icons={icons}
              currency={currency}
              onWrite={(name, value) => {
                const target = declared.find((d) => d.entry.name === name);
                if (target) write(target, value);
              }}
            />
          )}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <Shelf glass={ctx.glass}>
          {tallies.map(({ entry, list }) => (
            <div key={entry.name} className={`flex flex-col gap-2 ${TILE_WIDTH[ctx.glass]}`}>
              <BigGauge entry={entry} onWrite={(v) => ctx.write?.({ list, name: entry.name, value: v })} />
            </div>
          ))}
          {shown.length === 0 && tallies.length === 0 && (
            <p className="p-4 text-sm text-stone-600 italic">nothing here yet</p>
          )}
          {shown.map((item) => {
            const costEntry = use?.costCounter
              ? (item.lists.stats ?? []).find((s) => s.name.toLowerCase() === use.costCounter!.toLowerCase())
              : undefined;
            const extras = (use?.costs ?? []).flatMap((c) => {
              const stat = (item.lists.stats ?? []).find((s) => s.name === c.counter);
              const amount = numberOf(stat);
              return amount > 0 ? [{ counter: c.counter, amount }] : [];
            });
            return (
              <div key={item.id} className={`flex flex-col gap-2 ${TILE_WIDTH[ctx.glass]}`}>
                <ItemTile
                  characterId={entity.id}
                  child={item}
                  fill={ctx.glass === 'mounted'}
                  use={use}
                  arming={arming}
                  ammoPool={ammoPool}
                  costEntry={costEntry}
                  extras={extras}
                  onFireCost={(total) => fireCost(item, total)}
                  fittedTo={fittedTo.get(item.id)}
                />
              </div>
            );
          })}
        </Shelf>
      </div>
    </div>
  );
}

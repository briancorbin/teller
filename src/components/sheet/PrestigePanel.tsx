import { useState } from 'react';
import type {
  CampaignData,
  Counter,
  Field,
  Item,
  RulesPack,
  SystemTemplate,
} from '../../../worker/types';
import { amendPool, catalogOf } from '../../../worker/items';
import { newLocalId } from '../../lib/api';
import { bumped, Step } from '../counters/shared';
import { SheetPanel } from './SheetPanel';

// The back side's engine: the system's progression purchases
// (`SystemTemplate.spends` — WiW's Prestige menu, p. 32) as PROPOSING
// macros. One tap debits the spend counter and applies the effect as
// ordinary field/counter/tag/item writes in a SINGLE call — one event,
// one /undo — and every result lands somewhere a person can type over
// (rule 1). Nothing here enforces the menu: an unaffordable purchase is
// disabled, never clamped, the steppers stay the override, and a limit
// the book states rides in the reminder text rather than in a check.
//
// Standalone on purpose (blocks first, arrangement second — the
// TalentPanel precedent): it sits on whatever screen the layout gives
// it and moves in one line.

export function PrestigePanel({
  spends,
  counters,
  fields,
  groups,
  tags,
  marks,
  items,
  packs = [],
  ownCatalog,
  dice,
  onChange,
  onSpend,
  note,
  fill = false,
}: {
  spends: NonNullable<SystemTemplate['spends']>;
  counters: Counter[];
  fields: Field[];
  groups?: SystemTemplate['groups'];
  tags: string[];
  marks?: SystemTemplate['marks'];
  items: Item[];
  packs?: RulesPack[];
  ownCatalog?: CampaignData['catalog'];
  dice?: SystemTemplate['dice'];
  /** Steppers on the panel's own counters — the ordinary override path. */
  onChange: (next: Counter) => void;
  /** The one combined write. Absent on a surface that may look but not buy. */
  onSpend?: (next: {
    counters?: Counter[];
    items?: Item[];
    fields?: Field[];
    tags?: string[];
  }) => void;
  note?: string;
  fill?: boolean;
}) {
  /** Which purchase's chooser is open. Purchases needing no choice buy on tap. */
  const [open, setOpen] = useState<string | null>(null);

  const wallet = counters.find((c) => c.name === spends.counter);
  const lifetime = spends.total
    ? counters.find((c) => c.name === spends.total)
    : undefined;
  const available = wallet?.current;

  // Display only, derived and never stored — a stored tier goes stale
  // the moment the counter moves (the `bundleKind` lesson).
  const tier = [...(spends.tiers ?? [])]
    .sort((a, b) => a.at - b.at)
    .filter((t) => (lifetime?.current ?? 0) >= t.at)
    .pop();

  const faces = dice?.faces ?? {};
  const { items: catalog } = catalogOf(packs, ownCatalog);

  /** Debit the spend counter, then apply the purchase's other writes. */
  const buy = (
    spend: NonNullable<SystemTemplate['spends']>['menu'][number],
    extra: { items?: Item[]; fields?: Field[]; tags?: string[] } = {},
    amendCounters?: (debited: Counter[]) => Counter[],
  ) => {
    if (!onSpend) return;
    const debited = counters.map((c) =>
      c.name === spends.counter ? bumped(c, -spend.cost) : c,
    );
    onSpend({
      counters: amendCounters ? amendCounters(debited) : debited,
      ...extra,
    });
    setOpen(null);
  };

  /**
   * The options a purchase offers, by its effect's kind — each option a
   * label and the write it would make. Empty for effects that need no
   * choice (Improve Health buys on tap).
   */
  const optionsFor = (
    spend: NonNullable<SystemTemplate['spends']>['menu'][number],
  ): { key: string; label: string; act: () => void }[] => {
    const effect = spend.effect;
    if (!effect) return [];
    if (effect.kind === 'pool') {
      // Only skills the effect would actually change: converting a Black
      // that isn't there writes nothing, and a purchase that writes
      // nothing shouldn't be offered as if it did.
      return (groups?.[effect.group] ?? [])
        .map((key) => fields.find((f) => f.key === key))
        .filter((f): f is Field => Boolean(f))
        .map((f) => ({ field: f, next: amendPool(f.value, effect, faces) }))
        .filter(({ field, next }) => next !== field.value)
        .map(({ field, next }) => ({
          key: field.key,
          label: `${field.label} ${field.value} → ${next}`,
          act: () =>
            buy(spend, {
              fields: fields.map((f) =>
                f.key === field.key ? { ...f, value: next } : f,
              ),
            }),
        }));
    }
    if (effect.kind === 'mark') {
      const prefix = marks?.prefix ?? '';
      const owned = (category: string) =>
        tags.some(
          (t) =>
            t.trim().toLowerCase() === `${prefix}${category}`.trim().toLowerCase(),
        );
      return (marks?.categories ?? [])
        .filter((c) => !owned(c))
        .map((category) => ({
          key: category,
          label: category,
          act: () => buy(spend, { tags: [...tags, `${prefix}${category}`] }),
        }));
    }
    if (effect.kind === 'item') {
      // The catalogue is the menu, minus what's already carried — the
      // same reference-copy the console's picker makes.
      const carried = new Set(items.map((i) => i.from).filter(Boolean));
      return [...catalog.values()]
        .filter((e) => e.kind === effect.itemKind && !carried.has(e.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          key: entry.id,
          label: entry.name,
          act: () =>
            buy(spend, {
              items: [
                ...items,
                {
                  id: newLocalId('itm'),
                  name: entry.name,
                  from: entry.id,
                  fields: [],
                  counters: (entry.counters ?? []).map((c) => ({
                    ...c,
                    id: newLocalId('ctr'),
                  })),
                  kind: entry.kind,
                },
              ],
            }),
        }));
    }
    return [];
  };

  /** The choiceless purchases, applied straight to the debited counters. */
  const direct = (
    spend: NonNullable<SystemTemplate['spends']>['menu'][number],
  ) => {
    const effect = spend.effect;
    if (effect?.kind === 'max') {
      // A full counter stays full — improving max Health between
      // sessions shouldn't leave a rested character one point down. A
      // spent one keeps its current; healing is a different act.
      buy(spend, {}, (debited) =>
        debited.map((c) =>
          c.name === effect.counter
            ? {
                ...c,
                max: (c.max ?? 0) + effect.amount,
                current:
                  c.current === c.max ? c.current + effect.amount : c.current,
              }
            : c,
        ),
      );
      return;
    }
    // No effect at all: the purchase is a debit and the person applies
    // the improvement by hand — declared minimally, still bookkept.
    buy(spend);
  };

  return (
    <SheetPanel
      title={spends.label ?? spends.counter}
      note={note}
      fill={fill}
    >
      <div className="flex flex-col gap-2">
        {/* The ledger row: tier (derived), lifetime, and the wallet the
            menu spends from — steppers on both, because the counters
            stay authoritative and typed-over-able (rule 1). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {tier && (
            <span
              className="rounded-[3px] px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-stone-950"
              style={{ background: 'var(--sheet-accent, #f59e0b)' }}
              title={`${spends.total}: ${lifetime?.current ?? 0}`}
            >
              {tier.name}
            </span>
          )}
          {[lifetime, wallet]
            .filter((c): c is Counter => Boolean(c))
            .map((counter) => (
              <div key={counter.id} className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-stone-500">
                  {counter.name.replace(/^.*·\s*/, '')}
                </span>
                <span className="font-mono text-base text-stone-100">
                  {counter.current}
                </span>
                <Step
                  sign="−"
                  label={`decrease ${counter.name}`}
                  onClick={() => onChange(bumped(counter, -1))}
                  className="h-6 min-w-6 text-sm"
                />
                <Step
                  sign="+"
                  label={`increase ${counter.name}`}
                  onClick={() => onChange(bumped(counter, 1))}
                  className="h-6 min-w-6 text-sm"
                />
              </div>
            ))}
        </div>

        {onSpend && (
          <div className="flex flex-wrap gap-1.5">
            {spends.menu.map((spend) => {
              const needsChoice =
                spend.effect &&
                (spend.effect.kind === 'pool' ||
                  spend.effect.kind === 'mark' ||
                  spend.effect.kind === 'item');
              const isOpen = open === spend.name;
              const broke =
                available !== undefined && available < spend.cost;
              return (
                <button
                  key={spend.name}
                  type="button"
                  disabled={broke}
                  aria-expanded={needsChoice ? isOpen : undefined}
                  aria-label={`${spend.name}: ${spend.cost} ${spends.counter}. ${spend.text ?? ''}`}
                  title={spend.text}
                  onClick={() =>
                    needsChoice
                      ? setOpen(isOpen ? null : spend.name)
                      : direct(spend)
                  }
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-left text-[0.75rem] leading-tight transition-colors disabled:opacity-40 ${
                    isOpen
                      ? 'border-transparent text-stone-100'
                      : 'border-stone-700 text-stone-300 enabled:hover:bg-stone-800/60'
                  }`}
                  style={
                    isOpen
                      ? { borderColor: 'var(--sheet-accent, #f59e0b)' }
                      : undefined
                  }
                >
                  {spend.name}
                  <span className="rounded-[3px] bg-stone-800 px-1 font-mono text-[0.7rem] text-stone-400">
                    {spend.cost}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* The open purchase's chooser: tap an option and the buy is one
            write. Sits under the whole menu rather than inline so the
            buttons above never reflow when one opens. */}
        {onSpend &&
          open &&
          (() => {
            const spend = spends.menu.find((s) => s.name === open);
            if (!spend) return null;
            const options = optionsFor(spend);
            return (
              <div className="flex flex-wrap items-center gap-1.5 rounded bg-stone-900/80 px-2 py-1.5">
                <span className="text-[0.65rem] uppercase tracking-widest text-stone-500">
                  {spend.name} —
                </span>
                {options.length === 0 && (
                  <span className="text-[0.75rem] text-stone-500">
                    nothing left to pick
                  </span>
                )}
                {options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={option.act}
                    className="rounded border border-stone-700 px-2 py-0.5 font-mono text-[0.75rem] text-stone-200 transition-colors hover:border-stone-500 hover:bg-stone-800/60"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            );
          })()}
      </div>
    </SheetPanel>
  );
}

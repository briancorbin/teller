import { useMemo, useState } from 'react';
import type {
  CatalogItem,
  Item,
  RulesPack,
  SystemTemplate,
} from '../../worker/types';
import {
  describeEffect,
  fittableUpgrades,
  fittedUpgrades,
  itemRanges,
  resolveItem,
  standingOf,
  type OwnCatalog,
  type Standing,
} from '../../worker/items';
import { newLocalId } from '../lib/api';
import { btnGhost, input, sectionLabel } from '../lib/ui';
import { CatalogPicker } from './CatalogPicker';

// The DM's side of a character's gear: what they carry, and what's
// bolted to it.
//
// Until now this was API-only — a catalogue with no door. The seat could
// render a rifle beautifully and there was no way to hand somebody one.
//
// Everything here writes a REFERENCE. Adding a weapon stores its
// catalogue id and nothing else, so the publisher's numbers stay in the
// pack where they belong and a corrected printing reaches every
// character at once (rule 9). The arithmetic is `resolveItem`'s, and it
// PROPOSES: anything typed over it on the sheet still wins (rule 1).

/** What the book says you can't do — shown, and never enforced. */
function Problem({ text }: { text: string }) {
  return (
    <span className="whitespace-nowrap text-[10px] uppercase tracking-wider text-amber-700/80">
      {text}
    </span>
  );
}

/**
 * The rise: the one place a notched thing climbs its ladder.
 *
 * Everything about it is a PROPOSAL until the DM presses the button
 * (rule 1). Crossing a threshold does not promote anything — it makes
 * an offer here, prefilled with the tier the ladder names and the name
 * the thing already has, and both are typed over. The count that
 * earned it is the player's list of deeds and this never edits that:
 * rising is a thing that happens BECAUSE of the history, not to it.
 *
 * What it writes is one ordinary field override plus a name. No new
 * mechanism — a risen weapon is a weapon somebody typed a better tier
 * onto, which is exactly what a DM could always have done by hand and
 * what `resolveItem` has always understood.
 */
function Rise({
  item,
  standing,
  growth,
  label,
  holders,
  onChange,
  onDone,
}: {
  item: Item;
  standing: Standing;
  growth: NonNullable<SystemTemplate['growth']>;
  /** The sheet's own word for the tier field — "Quality". */
  label: string;
  /** Who already holds something at the tier being proposed. */
  holders: { item: string; who: string; id: string }[];
  onChange: (next: Item) => void;
  onDone: () => void;
}) {
  const next = standing.next!;
  const [tier, setTier] = useState(next.to);
  const [name, setName] = useState(item.name);
  // A thing can't be its own precedent — an item already at this tier
  // that is THIS item would otherwise warn about itself the moment the
  // DM reopened the proposal.
  const others = holders.filter((h) => h.id !== item.id);

  const raise = () => {
    const trimmed = tier.trim();
    if (!trimmed) return;
    onChange({
      ...item,
      name: name.trim() || item.name,
      fields: [
        ...item.fields.filter((f) => f.key !== growth.field),
        { key: growth.field, label, value: trimmed },
      ],
    });
    onDone();
  };

  return (
    <div className="mt-2 space-y-1 rounded-md border border-amber-800/60 bg-amber-950/20 p-2">
      <div className="flex items-center gap-2">
        <input
          className={`${input} min-w-0 flex-1 py-1 text-[12px]`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="its name now"
          placeholder="a name of its own"
        />
        <input
          className={`${input} w-28 shrink-0 py-1 text-[12px]`}
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          aria-label={label}
        />
      </div>
      {others.length > 0 && (
        <p className="text-[11px] text-amber-600/90">
          this posse already has {others.length === 1 ? 'a' : `${others.length}`}{' '}
          {tier}: {others.map((h) => `${h.item} (${h.who})`).join(', ')}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button className={btnGhost} onClick={raise}>
          raise it
        </button>
        <button className={btnGhost} onClick={onDone}>
          not yet
        </button>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  packs,
  own,
  dice,
  growth,
  holders,
  onChange,
  onRemove,
}: {
  item: Item;
  packs: RulesPack[];
  own?: OwnCatalog;
  dice?: SystemTemplate['dice'];
  /** The system's ladder, when it declares one. */
  growth?: SystemTemplate['growth'];
  /** Tier → who already holds one, for the rise's one-of notice. */
  holders?: Map<string, { item: string; who: string; id: string }[]>;
  onChange: (next: Item) => void;
  onRemove: () => void;
}) {
  const [fitting, setFitting] = useState(false);
  const [rising, setRising] = useState(false);

  const resolved = resolveItem(item, packs, dice, own);
  const fitted = fittedUpgrades(item, packs, own);
  const ranges = itemRanges(item, packs, dice, own);
  const standing = standingOf(item.history, resolved.fields, growth);
  const offered = useMemo(
    () => fittableUpgrades(item, packs, dice, own),
    [item, packs, dice, own],
  );

  const setFit = (index: number, patch: { range?: string }) =>
    onChange({
      ...item,
      upgrades: (item.upgrades ?? []).map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      ),
    });
  const unfit = (index: number) =>
    onChange({
      ...item,
      upgrades: (item.upgrades ?? []).filter((_, i) => i !== index),
    });

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          // Keyed on the name so a rename from ANYWHERE ELSE lands here.
          // It's uncontrolled (typing shouldn't patch per keystroke), and
          // an uncontrolled input ignores a changed `defaultValue` — so
          // renaming a weapon in the rise proposal left this field
          // showing the old name until something happened to remount the
          // card. The key doesn't churn while you type: `item.name` only
          // moves on blur.
          key={item.name}
          className="min-w-0 flex-1 bg-transparent text-sm text-stone-100 focus:outline-none"
          defaultValue={item.name}
          onBlur={(e) =>
            e.target.value.trim() !== item.name &&
            onChange({ ...item, name: e.target.value.trim() || item.name })
          }
          aria-label="item name"
        />
        {resolved.slots !== undefined && (
          <span className="shrink-0 font-mono text-[11px] text-stone-600">
            {resolved.slotsUsed}/{resolved.slots} slots
          </span>
        )}
        <button
          className={`${btnGhost} hover:text-red-300`}
          onClick={() => onRemove()}
          aria-label={`remove ${item.name}`}
        >
          ✕
        </button>
      </div>

      {/* The derived stats, filing and all — this is the workbench, not
          the seat. A value somebody typed over says so, the same way the
          player's card does. */}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {resolved.fields.map((f) => (
          <span
            key={f.key}
            className={`whitespace-nowrap text-[11px] ${
              f.filing ? 'text-stone-600' : 'text-stone-400'
            }`}
            title={f.overridden ? `the book and its upgrades say ${f.derived}` : undefined}
          >
            <span className="uppercase tracking-wider text-stone-600">{f.label} </span>
            <span className={`font-mono ${f.overridden ? 'text-amber-400' : ''}`}>
              {f.value || '—'}
            </span>
          </span>
        ))}
      </div>

      {fitted.length > 0 && (
        <div className="mt-2 space-y-1">
          {fitted.map(({ upgrade, range }, i) => (
            <div
              key={`${upgrade.id}${i}`}
              className="flex items-center gap-2 border-l-2 border-stone-700 pl-2"
            >
              <span className="min-w-0 flex-1 break-words text-[12px] text-stone-300">
                {upgrade.name}
                {(upgrade.effects ?? []).length > 0 && (
                  <span className="ml-2 font-mono text-[11px] text-stone-500">
                    {(upgrade.effects ?? [])
                      .map((e) =>
                        describeEffect(e, range ?? e.range, (key) =>
                          ranges.find((f) => f.key === key)?.label ?? key,
                        ),
                      )
                      .join(' · ')}
                  </span>
                )}
              </span>
              {/* Where it points is the CHARACTER's choice — "add 1B to
                  Short or Long" is a decision the catalogue can't make,
                  so it's an edit rather than something baked in at the
                  moment of fitting. */}
              {(upgrade.effects ?? []).length > 0 && ranges.length > 1 && (
                <select
                  className={`${input} shrink-0 py-1 text-[11px]`}
                  value={range ?? upgrade.effects?.[0]?.range ?? ''}
                  onChange={(e) => setFit(i, { range: e.target.value })}
                  aria-label={`where ${upgrade.name} points`}
                >
                  {ranges.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                className={`${btnGhost} hover:text-red-300`}
                onClick={() => unfit(i)}
                aria-label={`remove ${upgrade.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* What it's been through, and where that puts it. The deeds
          themselves are the player's — read here, edited on their own
          card — so this is a count and an offer, not a list. */}
      {growth && standing.deeds > 0 && (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[11px] text-stone-500">
            {standing.deeds} {growth.noun ?? 'notch'}
            {standing.deeds === 1 ? '' : 'es'}
            {standing.next && !standing.ready && (
              <span className="text-stone-600">
                {' '}
                · {standing.next.at - standing.deeds} to {standing.next.to}
              </span>
            )}
          </span>
          {standing.ready && !rising && (
            <button
              className={`${btnGhost} text-amber-400 hover:text-amber-300`}
              onClick={() => setRising(true)}
            >
              ready to rise to {standing.next!.to} →
            </button>
          )}
        </div>
      )}

      {rising && growth && standing.next && (
        <Rise
          item={item}
          standing={standing}
          growth={growth}
          label={
            resolved.fields.find((f) => f.key === growth.field)?.label ??
            growth.field
          }
          holders={holders?.get(standing.next.to) ?? []}
          onChange={onChange}
          onDone={() => setRising(false)}
        />
      )}

      {item.from && (
        <button className={`${btnGhost} mt-1`} onClick={() => setFitting(!fitting)}>
          {fitting ? 'done' : '+ fit an upgrade'}
        </button>
      )}

      {fitting && (
        <div className="mt-1 max-h-64 space-y-1 overflow-y-auto rounded-md border border-stone-800 p-1">
          {offered.length === 0 && (
            <p className="p-2 text-[12px] text-stone-600">
              no upgrades in this campaign's packs
            </p>
          )}
          {offered.map((fit) => (
            <button
              key={fit.upgrade.id}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-stone-800 ${
                fit.native ? '' : 'opacity-60'
              }`}
              onClick={() =>
                onChange({
                  ...item,
                  upgrades: [
                    ...(item.upgrades ?? []),
                    { from: fit.upgrade.id, ...(fit.range ? { range: fit.range } : {}) },
                  ],
                })
              }
            >
              <span className="min-w-0 flex-1 break-words text-[12px] text-stone-300">
                {fit.upgrade.name}
                <span className="ml-2 text-[10px] uppercase tracking-wider text-stone-600">
                  {fit.upgrade.type}
                </span>
              </span>
              {fit.problem && <Problem text={fit.problem} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ItemSection({
  items,
  packs,
  own,
  dice,
  growth,
  holders,
  onChange,
  onOwnChange,
  label = 'Gear',
}: {
  items: Item[];
  packs: RulesPack[];
  /** The campaign's own gear, which travels with it. */
  own?: OwnCatalog;
  dice?: SystemTemplate['dice'];
  /** The system's ladder, when it declares one — see `growth`. */
  growth?: SystemTemplate['growth'];
  /** Tier → who already holds one, for the rise's one-of notice. */
  holders?: Map<string, { item: string; who: string; id: string }[]>;
  onChange: (next: Item[]) => void;
  /** Absent on a surface that may look but not write to the campaign. */
  onOwnChange?: (next: NonNullable<OwnCatalog>) => void;
  label?: string;
}) {
  const [picking, setPicking] = useState(false);

  /**
   * A reference, plus the counters the entry brings with it.
   *
   * Fresh ids for the counters, because a counter is a thing this
   * character spends — two people carrying the same rifle each have
   * their own rounds.
   */
  const take = (entry: CatalogItem) =>
    onChange([
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
    ]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>{label}</span>
        <button className={btnGhost} onClick={() => setPicking(!picking)}>
          {picking ? 'done' : '+ add'}
        </button>
      </div>

      {picking && (
        <CatalogPicker
          packs={packs}
          own={own}
          dice={dice}
          onPick={take}
          onOwnChange={onOwnChange}
          onClose={() => setPicking(false)}
        />
      )}

      {items.length === 0 && !picking && (
        <p className="text-[12px] text-stone-600">nothing yet</p>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            packs={packs}
            own={own}
            dice={dice}
            growth={growth}
            holders={holders}
            onChange={(next) =>
              onChange(items.map((i) => (i.id === next.id ? next : i)))
            }
            onRemove={() =>
              window.confirm(`Remove ${item.name}?`) &&
              onChange(items.filter((i) => i.id !== item.id))
            }
          />
        ))}
      </div>
    </section>
  );
}

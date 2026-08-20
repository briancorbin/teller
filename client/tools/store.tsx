// The 'store' tool — the DM's side of the counter, ported from the old
// app's `src/components/StorePanel.tsx`. Two sections, and the split is
// §13's prep/play seam wearing its plainest clothes:
//
//   VENDORS — prep. The shop AS WRITTEN: a name, a line of fiction, and
//   the lines behind the counter, each a catalogue entry with an
//   optional price of its own and an optional count. Absent count means
//   unlimited, which is the ordinary case: counting boxes of matches is
//   bookkeeping nobody asked for.
//
//   THE COUNTER — play. Whoever has put a cart down, what it comes to,
//   and the sell button. Nothing here computes past a human: the total,
//   the coins and the change are all PROPOSALS in fields the Warden
//   types over before confirming (rule 1), and the sale carries what
//   they confirmed rather than what was proposed.
//
// Opening a shop instantiates NOTHING — browsing must never write (§14).
// The vendor becomes an entity at the first sale, which is one event
// the log carries and `/undo` steps back, and the "live" chip beside the
// name is how this screen says so.

import { useState } from 'react';
import { registerTool } from './index.ts';
import type { Template } from '../../core/stamp.ts';
import {
  api,
  deleteVendor,
  openShop,
  saveVendor,
  sell,
  shop as fetchShop,
  vendors as fetchVendors,
  writeCart,
  type ShopQuote,
  type ShopView,
  type Vendor,
  type VendorLine,
} from '../lib/api.ts';
import { formatPrice, makePayment, parsePrice } from '../lib/money.ts';
import { useLive } from '../lib/use-session.ts';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui.ts';

// ---- prep: the shop as written ----------------------------------------

function LineRow({
  line,
  template,
  onChange,
  onRemove,
}: {
  line: VendorLine;
  template: Template | undefined;
  onChange: (patch: Partial<VendorLine>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
        {template?.name ?? line.name ?? line.ref}
        {!template && (
          <span className="ml-2 font-mono text-[11px] text-amber-500/80">not on this host</span>
        )}
      </span>
      <input
        className={`${input} w-24 text-right font-mono text-xs`}
        placeholder="book's"
        defaultValue={line.price ?? ''}
        onBlur={(e) => onChange({ price: e.target.value.trim() || undefined })}
        aria-label={`what ${template?.name ?? line.ref} costs here`}
      />
      <input
        className={`${input} w-20 text-right font-mono text-xs`}
        type="number"
        min={0}
        placeholder="∞"
        defaultValue={line.qty ?? ''}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          onChange({ qty: raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
        }}
        aria-label={`how many ${template?.name ?? line.ref} he has`}
      />
      <button className={`${btnGhost} hover:text-red-300`} onClick={onRemove} aria-label="remove">
        ✕
      </button>
    </li>
  );
}

function VendorCard({
  vendor,
  catalog,
  byId,
  expanded,
  isOpen,
  onToggle,
  onSave,
  onDelete,
  onOpen,
}: {
  vendor: Vendor;
  catalog: Template[];
  byId: Map<string, Template>;
  expanded: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSave: (next: Vendor) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [adding, setAdding] = useState('');
  const lines = vendor.lines ?? [];
  const patch = (next: Partial<Vendor>) => onSave({ ...vendor, ...next });

  return (
    <li className="rounded-md border border-stone-800">
      <div className="flex items-center gap-2 p-2">
        <button className="min-w-0 flex-1 truncate text-left" onClick={onToggle}>
          <span className="text-sm text-stone-100">{vendor.name}</span>
          <span className="ml-2 font-mono text-[11px] text-stone-600">
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </span>
          {!vendor.own && (
            <span className="ml-2 font-mono text-[11px] text-stone-600">from a pack</span>
          )}
        </button>
        <button className={isOpen ? btn : btnPrimary} onClick={onOpen}>
          {isOpen ? 'shut the shop' : 'open'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-stone-800 p-2">
          {!vendor.own && (
            <p className="text-[12px] text-stone-500">
              A pack wrote this one. Restate it as the campaign's own to change it — the campaign
              wins the merge.
            </p>
          )}
          <input
            className={`${input} w-full`}
            defaultValue={vendor.name}
            onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })}
            aria-label="shop name"
            disabled={!vendor.own}
          />
          <input
            className={`${input} w-full text-xs`}
            placeholder="one line of fiction for the masthead"
            defaultValue={vendor.blurb ?? ''}
            onBlur={(e) => patch({ blurb: e.target.value.trim() || undefined })}
            aria-label="blurb"
            disabled={!vendor.own}
          />

          <div className="flex items-baseline gap-2">
            <span className={sectionLabel}>Behind the counter</span>
            <span className="text-[11px] text-stone-600">price · stock (blank = unlimited)</span>
          </div>
          <ul className="space-y-1">
            {lines.map((line, i) => (
              <LineRow
                key={`${line.ref}-${i}`}
                line={line}
                template={byId.get(line.ref)}
                onChange={(p) =>
                  patch({ lines: lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
                }
                onRemove={() => patch({ lines: lines.filter((_, j) => j !== i) })}
              />
            ))}
            {lines.length === 0 && (
              <li className="text-sm text-stone-600">nothing on the shelves yet</li>
            )}
          </ul>

          {vendor.own && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={`${input} min-w-0 flex-1 text-xs`}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
              >
                <option value="">stock the shelf…</option>
                {catalog.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                className={btn}
                disabled={!adding}
                onClick={() => {
                  const t = byId.get(adding);
                  patch({ lines: [...lines, { ref: adding, ...(t ? { name: t.name } : {}) }] });
                  setAdding('');
                }}
              >
                add
              </button>
              <button
                className={`${btnGhost} ml-auto text-[11px] hover:text-red-300`}
                onClick={onDelete}
              >
                delete this shop
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---- play: the counter -------------------------------------------------

/** One cart on the counter, with the ruling the Warden is about to make. */
function CounterRow({
  quote,
  symbol,
  onSold,
  onHandBack,
}: {
  quote: ShopQuote;
  symbol: string;
  onSold: (sale: {
    entityId: string;
    total: number;
    counters: { name: string; value: number }[];
  }) => void;
  onHandBack: () => void;
}) {
  // The book's total is the OPENING figure, never the last word — a
  // haggle is the most ordinary thing that happens at a counter.
  const [asked, setAsked] = useState<string | null>(null);
  const final = asked === null ? quote.total : (parsePrice(asked) ?? 0);

  // Re-proposed as the figure moves. The server proposed the first one;
  // this keeps up with the typing (`client/lib/money.ts` says why the
  // arithmetic exists twice).
  const proposal = quote.purse ? makePayment(quote.purse, final) : undefined;
  const counters =
    proposal
      ? Object.entries(proposal.counts).map(([name, value]) => ({ name, value }))
      : quote.counter
        ? [{ name: quote.counter.name, value: Math.max(0, (quote.held ?? 0) - final) }]
        : [];
  const short = quote.held !== undefined && quote.held < final;

  return (
    <li
      className={`space-y-2 rounded-md border p-2 ${
        quote.offered ? 'border-amber-600/60 bg-amber-950/30' : 'border-stone-800'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-stone-100">{quote.name}</span>
        {quote.offered && (
          <span className="text-[11px] uppercase tracking-widest text-amber-400">on the counter</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-stone-600">
          the book says {formatPrice(quote.total, symbol)}
        </span>
      </div>

      <ul className="space-y-0.5">
        {quote.lines.map((l) => (
          <li key={l.ref} className="flex items-baseline gap-2 text-[12px] text-stone-300">
            <span className="font-mono text-stone-500">{l.qty}×</span>
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="font-mono text-stone-500">{l.price ?? '—'}</span>
          </li>
        ))}
      </ul>
      {quote.missing.length > 0 && (
        <p className="font-mono text-[11px] text-amber-500/80">
          {quote.missing.length} line{quote.missing.length === 1 ? '' : 's'} the catalogue can't
          price
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] uppercase tracking-widest text-stone-500">asking</label>
        <input
          className={`${input} w-24 text-right font-mono text-sm`}
          value={asked ?? formatPrice(quote.total, symbol)}
          onChange={(e) => setAsked(e.target.value)}
          aria-label={`what ${quote.name} is being charged`}
        />
        {quote.held !== undefined && (
          <span className={`text-[11px] ${short ? 'text-red-400' : 'text-stone-500'}`}>
            holds {formatPrice(quote.held, symbol)}
          </span>
        )}
        {proposal && proposal.change > 0 && (
          <span className="text-[11px] text-stone-500">
            pays {formatPrice(proposal.paid, symbol)}, takes {formatPrice(proposal.change, symbol)}{' '}
            back
          </span>
        )}
      </div>

      {counters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {counters.map((c) => (
            <span
              key={c.name}
              className="rounded-md bg-stone-900 px-2 py-1 font-mono text-[11px] text-stone-400"
            >
              {c.name} → {c.value}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button className={btnGhost} onClick={onHandBack}>
          hand it back
        </button>
        <button
          className={`${btnPrimary} ml-auto`}
          onClick={() => onSold({ entityId: quote.entityId, total: final, counters })}
        >
          sold
        </button>
      </div>
    </li>
  );
}

function StoreTool() {
  const { data: vendors, reload: reloadVendors } = useLive(() => fetchVendors(), []);
  const { data: catalog } = useLive(
    () => api<Template[]>('/api/stack/templates/catalog').catch(() => []),
    [],
  );
  const { data: view, reload: reloadShop } = useLive<ShopView | null>(() => fetchShop(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  if (!vendors || !catalog) return null;
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const openId = view?.vendor.id;

  const save = async (next: Vendor) => {
    // Everything the row carried goes back — the server hands the
    // campaign's own rows out raw underneath, so a key this form has
    // never heard of survives being edited here.
    const { own: _own, ...rest } = next;
    await saveVendor({ ...rest, lines: next.lines ?? [] });
    reloadVendors();
    reloadShop();
  };

  const create = async () => {
    const made = await saveVendor({ name: `Shop ${vendors.length + 1}`, lines: [] });
    reloadVendors();
    setOpen(made.id);
  };

  const remove = async (vendor: Vendor) => {
    if (!window.confirm(`Delete "${vendor.name}"?`)) return;
    if (openId === vendor.id) await openShop(null);
    await deleteVendor(vendor.id);
    if (open === vendor.id) setOpen(null);
    reloadVendors();
    reloadShop();
  };

  const toggleOpen = async (vendor: Vendor) => {
    await openShop(openId === vendor.id ? null : vendor.id);
    setStatus('');
    reloadShop();
  };

  const confirm = async (sale: {
    entityId: string;
    total: number;
    counters: { name: string; value: number }[];
  }) => {
    try {
      const receipt = await sell(sale);
      const carried = receipt.carried.length;
      setStatus(
        `${receipt.buyer.name} paid ${formatPrice(receipt.total)}` +
          (carried ? ` and carried off ${carried} thing${carried === 1 ? '' : 's'}` : '') +
          (receipt.refused.length ? ` — ${receipt.refused.join('; ')}` : ''),
      );
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    }
    reloadShop();
  };

  const symbol = view?.carts[0]?.symbol ?? '$';

  return (
    <div className="space-y-4">
      {view && (
        <section className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={sectionLabel}>The counter</span>
            <span className="text-sm text-stone-100">{view.vendor.name}</span>
            {view.vendor.live && (
              <span
                className="rounded-full border px-2 py-0.5 text-[0.6rem] uppercase tracking-wider"
                style={{ borderColor: '#b45309', color: '#f59e0b' }}
                title="this shop has transacted — it exists as an entity, and its stock is tracked"
              >
                live
              </span>
            )}
            <button className={`${btnGhost} ml-auto`} onClick={() => openShop(null).then(reloadShop)}>
              shut the shop
            </button>
          </div>

          {status && <p className="font-mono text-xs text-amber-400">{status}</p>}

          <ul className="space-y-2">
            {view.carts.length === 0 && (
              <li className="text-sm text-stone-600">nobody's gathered anything yet</li>
            )}
            {view.carts.map((quote) => (
              <CounterRow
                key={quote.entityId}
                quote={quote}
                symbol={quote.symbol || symbol}
                onSold={confirm}
                onHandBack={() => writeCart(quote.entityId, []).then(reloadShop)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Shops</span>
          <button className={btnGhost} onClick={create}>
            new shop
          </button>
        </div>

        {vendors.length === 0 && (
          <p className="text-sm text-stone-600">
            nothing to buy anywhere — a shop is a name and a list of what's behind the counter
          </p>
        )}

        <ul className="space-y-2">
          {vendors.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              catalog={catalog}
              byId={byId}
              expanded={open === vendor.id}
              isOpen={openId === vendor.id}
              onToggle={() => setOpen(open === vendor.id ? null : vendor.id)}
              onSave={save}
              onDelete={() => remove(vendor)}
              onOpen={() => toggleOpen(vendor)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

registerTool('store', () => <StoreTool />);

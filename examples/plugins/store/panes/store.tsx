// The store's console pane — the DM's side of the counter, ported from
// teller's own `client/tools/store.tsx` when the store left the repo
// (§15's UI tier). Two sections, and the split is §13's prep/play seam
// wearing its plainest clothes:
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
//
// ONE CONSTRAINT THIS PANE DOESN'T SHARE WITH THE FILE IT CAME FROM.
// Tailwind builds teller's stylesheet by scanning teller's OWN source,
// and a shelf folder isn't in it — so a pane may only wear the
// utilities teller's client already uses somewhere. Arbitrary values
// (`text-[11px]`, `w-[19rem]`) compile to nothing, and this file was
// their only user before it moved: it rendered as unstyled slivers the
// first time it ran outside the repo. So every bracketed utility here
// is an inline `style` instead, pixel for pixel. A pane wanting more
// than that brings its own stylesheet (rung 3).
//
// Every figure it reads comes back through `plugin.call` — the pane's
// only way to reach its own doors, and the reason nothing here spells a
// url or the plugin's id. The one exception is the CATALOGUE, which is
// teller's own public door: the goods are the table's, not the store's,
// and a plugin that owned them would be a plugin nothing else could
// price against.

import { useState } from 'react';
import {
  api,
  btn,
  btnGhost,
  btnPrimary,
  card,
  input,
  sectionLabel,
  useLive,
  type BlockCtx,
} from 'teller';
import { formatPrice, makePayment, parsePrice } from '../store.mjs';

// ---- what the doors answer with ---------------------------------------
//
// Declared here rather than imported: `store.mjs` is arithmetic, not
// types, and these are the shapes of the wire between the two halves of
// this plugin. One spelling of a payload, on both sides.

type Entry = { name: string; value?: unknown };

/** Only what this screen reads off a catalogue row — the goods are teller's. */
type Template = { id: string; name: string; lists?: Record<string, Entry[]> };

/**
 * What the book asks for this thing — the catalogue entry's own price
 * stat, found the way `shelfOf` finds it (the system's word for "what a
 * thing costs", matched case-insensitively: `costField` is 'cost', the
 * entry says 'Cost').
 *
 * Verbatim, not reformatted: this is the string that WILL apply if the
 * line's own price is left unset, so showing a tidied version of it
 * would be showing a number the shelf isn't going to use.
 */
function bookPrice(template: Template | undefined, costField: string): string | undefined {
  if (!template) return undefined;
  const want = costField.toLowerCase();
  for (const entries of Object.values(template.lists ?? {})) {
    const hit = (entries ?? []).find((e) => String(e?.name ?? '').toLowerCase() === want);
    if (hit?.value !== undefined && hit?.value !== null) return String(hit.value);
  }
  return undefined;
}

type VendorLine = { ref: string; name?: string; price?: string; qty?: number | null };

type Vendor = {
  id: string;
  name: string;
  blurb?: string;
  /** Explicit stock. ABSENT — not empty — means the shelf is derived. */
  lines?: VendorLine[];
  /** Derived stock: the catalogue shelves he carries. Absent = all of them. */
  groups?: string[];
  /** Derived stock: a catalogue stat's name → the values he carries. */
  filters?: Record<string, string[]>;
  /** This campaign authored it, so this console may edit it. */
  own?: boolean;
};

type StockLine = {
  ref: string;
  name: string;
  type?: string;
  /** The catalogue's shelf label — what the seat's chip row narrows by. */
  group?: string;
  stats: Entry[];
  price: string | null;
  /** null = unlimited, and that is the ordinary case. */
  qty: number | null;
  missing?: true;
};

type CartLine = { ref: string; qty: number };

type ShopQuote = {
  entityId: string;
  name: string;
  lines: (CartLine & { name: string; price: string | null; each: number | null })[];
  offered: boolean;
  total: number;
  symbol: string;
  missing: string[];
  purse?: { name: string; value: number; held: number }[];
  held?: number;
  payment?: { counters: { name: string; value: number }[]; paid: number; change: number };
  counter?: { name: string; value: number };
};

type ShopView = {
  vendor: { id: string; name: string; blurb?: string; live: boolean };
  shelf: StockLine[];
  carts: ShopQuote[];
};

type Receipt = {
  vendor: { id: string; name: string; entityId: string };
  buyer: { id: string; name: string };
  total: number;
  lines: { ref: string; name: string; qty: number }[];
  carried: { id: string; name: string }[];
  refused: string[];
};

type Sale = { entityId: string; total: number; counters: { name: string; value: number }[] };

/** A pane always has its plugin — that is what makes it a pane (§15). */
type PaneProps = BlockCtx & { plugin: NonNullable<BlockCtx['plugin']> };

// ---- prep: the shop as written ----------------------------------------

function LineRow({
  line,
  template,
  book,
  onChange,
  onRemove,
}: {
  line: VendorLine;
  template: Template | undefined;
  /** What the catalogue asks, when it asks anything — the placeholder. */
  book: string | undefined;
  onChange: (patch: Partial<VendorLine>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-stone-100">
        {template?.name ?? line.name ?? line.ref}
        {!template && (
          <span className="ml-2 font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
            not on this host
          </span>
        )}
      </span>
      {/* UNSET shows the book's own number, greyed — the figure that
          WILL apply, rather than the word "book's", which named the
          fallback without ever saying what it was. It stays a
          placeholder and never a value: typing overrides it, clearing
          lets the book's number show through again (rule 1 — the stored
          value wins, and here there isn't one). */}
      <input
        className={`${input} w-24 text-right font-mono text-xs`}
        placeholder={book ?? "book's"}
        defaultValue={line.price ?? ''}
        onBlur={(e) => onChange({ price: e.target.value.trim() || undefined })}
        aria-label={`what ${template?.name ?? line.ref} costs here${
          book ? ` (the book says ${book})` : ''
        }`}
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
  costField,
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
  /** The system's word for what a thing costs (`records.store.costField`). */
  costField: string;
  expanded: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSave: (next: Vendor) => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const [adding, setAdding] = useState('');
  const lines = vendor.lines ?? [];
  // He wrote no list at all, so his shelf is DERIVED off the catalogue.
  // Not the same as an empty one: "he has nothing" is a statement.
  const derived = vendor.lines === undefined;
  const patch = (next: Partial<Vendor>) => onSave({ ...vendor, ...next });

  return (
    <li className="rounded-md border border-stone-800">
      <div className="flex items-center gap-2 p-2">
        <button className="min-w-0 flex-1 truncate text-left" onClick={onToggle}>
          <span className="text-sm text-stone-100">{vendor.name}</span>
          <span className="ml-2 font-mono text-stone-600" style={{ fontSize: '11px' }}>
            {derived ? 'off the catalogue' : `${lines.length} line${lines.length === 1 ? '' : 's'}`}
          </span>
          {!vendor.own && (
            <span className="ml-2 font-mono text-stone-600" style={{ fontSize: '11px' }}>
              from a pack
            </span>
          )}
        </button>
        <button className={isOpen ? btn : btnPrimary} onClick={onOpen}>
          {isOpen ? 'shut the shop' : 'open'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-stone-800 p-2">
          {!vendor.own && (
            <p className="text-stone-500" style={{ fontSize: '12px' }}>
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
            <span className="text-stone-600" style={{ fontSize: '11px' }}>
              price · stock (blank = unlimited)
            </span>
          </div>
          {derived && (
            <p className="text-stone-500" style={{ fontSize: '12px' }}>
              No list written, so he carries everything the catalogue prices
              {vendor.groups?.length ? ` on ${vendor.groups.join(', ')}` : ''}
              {vendor.filters
                ? `, ${Object.entries(vendor.filters)
                    .map(([name, values]) => `${name} ${values.join(' or ')}`)
                    .join(' · ')}`
                : ''}
              . Write a line below and the shelf becomes that list instead.
            </p>
          )}
          <ul className="space-y-1">
            {lines.map((line, i) => (
              <LineRow
                key={`${line.ref}-${i}`}
                line={line}
                template={byId.get(line.ref)}
                book={bookPrice(byId.get(line.ref), costField)}
                onChange={(p) =>
                  patch({ lines: lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })
                }
                onRemove={() => patch({ lines: lines.filter((_, j) => j !== i) })}
              />
            ))}
            {lines.length === 0 && !derived && (
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
                className={`${btnGhost} ml-auto hover:text-red-300`}
                style={{ fontSize: '11px' }}
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
  onSold: (sale: Sale) => void;
  onHandBack: () => void;
}) {
  // The book's total is the OPENING figure, never the last word — a
  // haggle is the most ordinary thing that happens at a counter.
  const [asked, setAsked] = useState<string | null>(null);
  const final = asked === null ? quote.total : (parsePrice(asked) ?? 0);

  // Re-proposed as the figure moves. The door proposed the first one;
  // this keeps up with the typing, out of the plugin's OWN arithmetic —
  // `store.mjs` is bundled into this pane, so there is one spelling of
  // a payment rather than a mirrored copy, and no round trip per
  // keystroke to re-propose change for a haggled price.
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
          <span
            className="uppercase tracking-widest text-amber-400"
            style={{ fontSize: '11px' }}
          >
            on the counter
          </span>
        )}
        <span className="ml-auto font-mono text-stone-600" style={{ fontSize: '11px' }}>
          the book says {formatPrice(quote.total, symbol)}
        </span>
      </div>

      <ul className="space-y-0.5">
        {quote.lines.map((l) => (
          <li
            key={l.ref}
            className="flex items-baseline gap-2 text-stone-300"
            style={{ fontSize: '12px' }}
          >
            <span className="font-mono text-stone-500">{l.qty}×</span>
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <span className="font-mono text-stone-500">{l.price ?? '—'}</span>
          </li>
        ))}
      </ul>
      {quote.missing.length > 0 && (
        <p className="font-mono text-amber-500/80" style={{ fontSize: '11px' }}>
          {quote.missing.length} line{quote.missing.length === 1 ? '' : 's'} the catalogue can't
          price
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="uppercase tracking-widest text-stone-500" style={{ fontSize: '11px' }}>
          asking
        </label>
        <input
          className={`${input} w-24 text-right font-mono text-sm`}
          value={asked ?? formatPrice(quote.total, symbol)}
          onChange={(e) => setAsked(e.target.value)}
          aria-label={`what ${quote.name} is being charged`}
        />
        {quote.held !== undefined && (
          <span
            className={short ? 'text-red-400' : 'text-stone-500'}
            style={{ fontSize: '11px' }}
          >
            holds {formatPrice(quote.held, symbol)}
          </span>
        )}
        {proposal && proposal.change > 0 && (
          <span className="text-stone-500" style={{ fontSize: '11px' }}>
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
              className="rounded-md bg-stone-900 px-2 py-1 font-mono text-stone-400"
              style={{ fontSize: '11px' }}
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

export default function StorePane({ plugin, records }: PaneProps) {
  // The system's word for what a thing costs — the same declaration the
  // shelf reads, so an unset line's placeholder is exactly the number
  // the shelf will use. A system that declares nothing falls to 'cost',
  // which is what `store.mjs` does too.
  const costField = String(
    (records.store as { costField?: unknown } | undefined)?.costField ?? 'cost',
  );
  // Each on its own word: a vendor and the open shop are the store's
  // own ('shop'), the catalogue is the content stack's ('templates').
  const { data: vendors, reload: reloadVendors } = useLive(
    () => plugin.call<Vendor[]>('vendors'),
    [],
    { on: ['shop', 'templates'] },
  );
  const { data: catalog } = useLive(
    () => api<Template[]>('/api/stack/templates/catalog').catch(() => []),
    [],
    { on: ['templates'] },
  );
  const { data: view, reload: reloadShop } = useLive<ShopView | null>(
    () => plugin.call<ShopView | null>('shop'),
    [],
    { on: ['shop', 'entities'] },
  );
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  // The four doors, spelled once. Nothing below knows a url or an id —
  // `plugin.call` is the whole of a pane's reach (§15), and a door moved
  // between plugins needs no edit here.
  const saveVendor = (vendor: Omit<Vendor, 'own' | 'id'> & { id?: string }) =>
    plugin.call<{ id: string }>('vendors', { method: 'POST', body: { template: vendor } });
  const deleteVendor = (id: string) =>
    plugin.call<{ ok: true }>('vendors', { method: 'DELETE', path: [id] });
  const openShop = (vendorId: string | null) =>
    plugin.call<ShopView | null>('shop', { method: 'POST', body: { vendorId } });
  const writeCart = (entityId: string, lines: CartLine[], offered?: boolean) =>
    plugin.call<ShopView | null>('cart', {
      method: 'PUT',
      path: [entityId],
      body: { lines, ...(offered === undefined ? {} : { offered }) },
    });
  const sell = (sale: Sale) => plugin.call<Receipt>('sell', { method: 'POST', body: { sale } });

  if (!vendors || !catalog) return null;
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const openId = view?.vendor.id;

  const save = async (next: Vendor) => {
    // Everything the row carried goes back — the door hands the
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

  const confirm = async (sale: Sale) => {
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
                className="rounded-full border px-2 py-0.5 uppercase tracking-wider"
                style={{ borderColor: '#b45309', color: '#f59e0b', fontSize: '0.6rem' }}
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
              costField={costField}
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

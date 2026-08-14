import { useMemo, useState } from 'react';
import type {
  Campaign,
  Character,
  CharacterData,
  RulesPack,
  SessionOp,
  SessionState,
  SystemTemplate,
  Vendor,
} from '../../worker/types';
import {
  cartTotal,
  catalogOf,
  formatPrice,
  makePayment,
  parsePrice,
  purseTotal,
  vendorStock,
} from '../../worker/items';
import { instanced } from '../lib/creation';
import { newLocalId } from '../lib/api';
import { btn, btnGhost, btnPrimary, card, input, sectionLabel } from '../lib/ui';
import { CatalogPicker } from './CatalogPicker';

// The world's shops, and the counter when one is open.
//
// Two halves, mirroring the two moments of the thing. VENDORS is prep:
// name a shop, decide what it carries — a curated list line by line, or
// the whole catalogue narrowed by shelf and tier ("Basic weapons are
// most commonly found", p. 65). THE COUNTER is play: a seat puts its
// cart up, the haggle happens OUT LOUD (p. 63: "prices are often
// negotiable"), and the figure the table lands on is typed here over
// the book's total. Confirming is one ordinary character PATCH —
// event-logged, undoable, every number overridable (rule 1). teller
// presents and books; it never argues.

export function StorePanel({
  campaign,
  characters,
  packs,
  template,
  session,
  gm,
  onVendors,
  onOp,
  onPatchCharacter,
}: {
  campaign: Campaign;
  characters: Character[];
  packs: RulesPack[];
  template: SystemTemplate | null;
  session: SessionState | null;
  gm: string;
  onVendors: (next: Vendor[]) => void;
  onOp: (op: SessionOp) => void;
  onPatchCharacter: (
    id: string,
    patch: { data?: Partial<CharacterData> },
  ) => void;
}) {
  const store = template?.store;
  const vendors = campaign.data.vendors ?? [];
  const open = session?.store ?? null;
  const openVendor = open
    ? vendors.find((v) => v.id === open.vendorId)
    : undefined;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [stocking, setStocking] = useState(false);
  /** Final figures being typed at the counter, by character id. */
  const [finals, setFinals] = useState<Record<string, string>>({});

  const { items: catalog } = useMemo(
    () => catalogOf(packs, campaign.data.catalog),
    [packs, campaign.data.catalog],
  );

  /** Every shelf (group) the catalogue has, for the derived-stock chips. */
  const allGroups = useMemo(
    () =>
      [
        ...new Set(
          [...catalog.values()].map((e) => e.group ?? '').filter(Boolean),
        ),
      ].sort(),
    [catalog],
  );

  /**
   * Filing dimensions worth filtering on: filing-field key → its values,
   * offered only where the value set is small enough to be a dial
   * (quality tiers, not a hundred distinct prices). Derived from the
   * catalogue, so no key here is a word this code knows (rule 2).
   */
  const filingDials = useMemo(() => {
    const dims = new Map<string, Set<string>>();
    for (const entry of catalog.values()) {
      for (const f of entry.fields) {
        if (!f.filing || !f.value) continue;
        if (!dims.has(f.key)) dims.set(f.key, new Set());
        dims.get(f.key)!.add(f.value);
      }
    }
    return [...dims.entries()]
      .filter(([, values]) => values.size >= 2 && values.size <= 8)
      .map(([key, values]) => ({ key, values: [...values].sort() }));
  }, [catalog]);

  if (!store) {
    return (
      <section className={card}>
        <span className={sectionLabel}>Store</span>
        <p className="mt-2 text-[12px] text-stone-600">
          this system doesn't declare a store — nothing to sell with
        </p>
      </section>
    );
  }

  const shelfOf = (vendor: Vendor) =>
    vendorStock(vendor, packs, campaign.data.catalog, store, template?.growth);

  const saveVendor = (next: Vendor) =>
    onVendors(vendors.map((v) => (v.id === next.id ? next : v)));

  const addVendor = () => {
    const vendor: Vendor = { id: newLocalId('vnd'), name: 'General Store' };
    onVendors([...vendors, vendor]);
    setEditingId(vendor.id);
  };

  /**
   * The purchase: the DM's ruling made real. One PATCH carries the
   * debit and the goods together — one event, one /undo — and explicit
   * stock counts down. Services (declared kinds) are consumed at the
   * counter: wallet only, nothing lands in inventory.
   */
  const confirm = (characterId: string) => {
    if (!open || !openVendor) return;
    const character = characters.find((c) => c.id === characterId);
    const cart = open.carts[characterId] ?? [];
    if (!character || !cart.length) return;
    const shelf = shelfOf(openVendor);
    const book = cartTotal(cart, shelf);
    const final = parsePrice(finals[characterId]) ?? book.cents;

    // The debit. Coins and paper when the system declares them — the
    // payment is a shopkeeper's move, exact coins else smallest
    // overpay with change back — and a single wallet counter
    // otherwise. Can't cover it? Everything they have: the DM typed
    // the figure knowing the purse, and a wallet stops at empty.
    let counters = character.data.counters;
    const currency = template?.currency;
    if (currency) {
      const payment = makePayment(counters, currency, final);
      const counts =
        payment?.counts ??
        Object.fromEntries(
          currency.denominations.map((d) => [d.counter, 0]),
        );
      counters = counters.map((c) =>
        c.name in counts ? { ...c, current: counts[c.name] } : c,
      );
    } else if (store.counter) {
      const wallet = counters.find((c) => c.name === store.counter);
      if (wallet) {
        counters = counters.map((c) => {
          if (c.id !== wallet.id) return c;
          // Minor units when the counter says so; whole units rounded
          // otherwise — the DM's typed figure still rules.
          const debit =
            c.display === 'money' ? final : Math.round(final / 100);
          return { ...c, current: Math.max(0, c.current - debit) };
        });
      }
    }

    const consumed = new Set(store.consumes ?? []);
    const additions = cart.flatMap((line) => {
      const entry = shelf.find((s) => s.ref === line.ref)?.entry;
      if (!entry || consumed.has(entry.kind ?? '')) return [];
      // A countable entry stacks into one item; anything else arrives
      // as so many separate things — the creation flow's own rule.
      return entry.counters?.length
        ? [instanced(entry, line.qty)]
        : Array.from({ length: line.qty }, () => instanced(entry));
    });

    onPatchCharacter(characterId, {
      data: {
        counters,
        items: [...(character.data.items ?? []), ...additions],
      },
    });

    if (openVendor.stock?.some((l) => l.qty != null)) {
      saveVendor({
        ...openVendor,
        stock: openVendor.stock.map((l) => {
          const bought = cart.find((c) => c.ref === l.ref);
          return bought && l.qty != null
            ? { ...l, qty: Math.max(0, l.qty - bought.qty) }
            : l;
        }),
      });
    }

    setFinals(({ [characterId]: _, ...rest }) => rest);
    onOp({ op: 'cart', characterId, lines: [] });
  };

  /** One cart at the counter — the DM's side of a seat's offer. */
  const counterRow = (character: Character) => {
    if (!open || !openVendor) return null;
    const cart = open.carts[character.id] ?? [];
    if (!cart.length) return null;
    const offered = open.offered[character.id] ?? false;
    const shelf = shelfOf(openVendor);
    const book = cartTotal(cart, shelf);
    const currency = template?.currency;
    const wallet = store.counter
      ? character.data.counters.find((c) => c.name === store.counter)
      : undefined;
    const holds = currency
      ? purseTotal(character.data.counters, currency)
      : wallet && wallet.display === 'money'
        ? wallet.current
        : wallet
          ? wallet.current * 100
          : null;
    const final = parsePrice(finals[character.id]) ?? book.cents;
    // The cash handling, narrated before it happens — "pays $13, takes
    // 65¢ change" — so the ruling is made looking at the exchange.
    const payment = currency
      ? makePayment(character.data.counters, currency, final)
      : null;

    return (
      <div
        key={character.id}
        className={`rounded-lg border px-3 py-2 ${
          offered
            ? 'border-amber-600/60 bg-amber-950/20'
            : 'border-stone-800 bg-stone-900/40'
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm text-stone-100">{character.name}</span>
          <span className="text-[11px] uppercase tracking-widest text-stone-500">
            {offered ? 'on the counter' : 'still gathering'}
          </span>
          {holds !== null && (
            <span className="ml-auto font-mono text-[12px] text-stone-500">
              holds {formatPrice(holds, book.symbol)}
            </span>
          )}
        </div>
        <ul className="mt-1 space-y-0.5">
          {cart.map((line) => {
            const stocked = shelf.find((s) => s.ref === line.ref);
            return (
              <li key={line.ref} className="flex gap-2 text-[12px] text-stone-400">
                <span className="font-mono text-stone-500">×{line.qty}</span>
                <span className="min-w-0 flex-1 break-words">
                  {stocked?.entry?.name ?? `${line.ref} — not in your books`}
                </span>
                <span className="font-mono">
                  {stocked?.price ?? '—'}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-stone-500">
            the book says {formatPrice(book.cents, book.symbol)}
          </span>
          {/* The haggled figure — the table's ruling, typed over the
              book's arithmetic. Defaults to the total so an unhaggled
              sale is one tap. */}
          <input
            className={`${input} w-24 text-right font-mono`}
            value={finals[character.id] ?? formatPrice(book.cents, book.symbol)}
            onChange={(e) =>
              setFinals({ ...finals, [character.id]: e.target.value })
            }
            aria-label={`final price for ${character.name}`}
          />
          {holds !== null && final > holds && (
            <span className="text-[11px] text-red-400">
              short {formatPrice(final - holds, book.symbol)} — the purse stops
              at empty
            </span>
          )}
          {payment && payment.change > 0 && (
            <span className="text-[11px] text-stone-500">
              pays {formatPrice(payment.paid, book.symbol)}, takes{' '}
              {formatPrice(payment.change, book.symbol)} change
            </span>
          )}
          <span className="ml-auto flex gap-2">
            <button
              className={btnGhost}
              onClick={() => onOp({ op: 'cart', characterId: character.id, lines: [] })}
            >
              hand it back
            </button>
            <button className={btnPrimary} onClick={() => confirm(character.id)}>
              sold
            </button>
          </span>
        </div>
      </div>
    );
  };

  const vendorEditor = (vendor: Vendor) => {
    const shelf = shelfOf(vendor);
    const curated = vendor.stock !== undefined;
    return (
      <div className="mt-2 space-y-3 border-t border-stone-800 pt-2">
        <div className="flex flex-wrap gap-2">
          <input
            className={`${input} flex-1`}
            defaultValue={vendor.name}
            onBlur={(e) =>
              e.target.value.trim() &&
              saveVendor({ ...vendor, name: e.target.value.trim() })
            }
            aria-label="vendor name"
          />
          <input
            className={`${input} flex-[2]`}
            placeholder="one line of fiction — 'dust, dynamite and a suspicious parrot'"
            defaultValue={vendor.blurb ?? ''}
            onBlur={(e) =>
              saveVendor({ ...vendor, blurb: e.target.value.trim() || undefined })
            }
            aria-label="vendor blurb"
          />
        </div>

        {/* What it carries: the whole catalogue, narrowed — or a list. */}
        <div className="flex items-center gap-2">
          <span className={sectionLabel}>carries</span>
          <button
            className={`${btnGhost} ${curated ? '' : 'text-amber-400'}`}
            onClick={() =>
              curated &&
              saveVendor({ ...vendor, stock: undefined })
            }
          >
            everything priced
          </button>
          <button
            className={`${btnGhost} ${curated ? 'text-amber-400' : ''}`}
            onClick={() =>
              !curated &&
              saveVendor({ ...vendor, stock: [], groups: undefined, filters: undefined })
            }
          >
            a curated list
          </button>
          <span className="ml-auto text-[11px] text-stone-600">
            {shelf.length} on the shelf
          </span>
        </div>

        {!curated && (
          <>
            <div className="flex flex-wrap gap-1">
              {allGroups.map((g) => {
                const on = !vendor.groups?.length || vendor.groups.includes(g);
                const toggle = () => {
                  const current = vendor.groups?.length
                    ? vendor.groups
                    : allGroups;
                  const next = on
                    ? current.filter((x) => x !== g)
                    : [...current, g];
                  saveVendor({
                    ...vendor,
                    groups: next.length === allGroups.length ? undefined : next,
                  });
                };
                return (
                  <button
                    key={g}
                    className={`rounded-md px-2 py-0.5 text-[0.65rem] uppercase tracking-wider transition-colors ${
                      on
                        ? 'bg-amber-700 text-stone-950'
                        : 'bg-stone-900 text-stone-500 hover:text-stone-200'
                    }`}
                    onClick={toggle}
                    aria-pressed={on}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
            {filingDials.map(({ key, values }) => (
              <div key={key} className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[10px] uppercase tracking-widest text-stone-600">
                  {key}
                </span>
                {values.map((v) => {
                  const chosen = vendor.filters?.[key] ?? [];
                  const on = !chosen.length || chosen.includes(v);
                  const toggle = () => {
                    const current = chosen.length ? chosen : values;
                    const next = on
                      ? current.filter((x) => x !== v)
                      : [...current, v];
                    const filters = { ...(vendor.filters ?? {}) };
                    if (next.length === values.length) delete filters[key];
                    else filters[key] = next;
                    saveVendor({
                      ...vendor,
                      filters: Object.keys(filters).length ? filters : undefined,
                    });
                  };
                  return (
                    <button
                      key={v}
                      className={`rounded-md px-2 py-0.5 text-[0.65rem] tracking-wider transition-colors ${
                        on
                          ? 'bg-stone-700 text-stone-100'
                          : 'bg-stone-900 text-stone-600 hover:text-stone-300'
                      }`}
                      onClick={toggle}
                      aria-pressed={on}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            ))}
          </>
        )}

        {curated && (
          <div className="space-y-1">
            {(vendor.stock ?? []).map((line, i) => {
              const entry = catalog.get(line.ref);
              return (
                <div key={`${line.ref}${i}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-[12px] text-stone-300">
                    {entry?.name ?? (
                      <span className="text-amber-700/80">
                        {line.ref} — not in your books
                      </span>
                    )}
                  </span>
                  <input
                    className={`${input} w-20 text-right font-mono`}
                    placeholder={
                      entry?.fields.find((f) => f.key === store.costField)
                        ?.value ?? 'price'
                    }
                    defaultValue={line.price ?? ''}
                    onBlur={(e) =>
                      saveVendor({
                        ...vendor,
                        stock: vendor.stock!.map((l, j) =>
                          j === i
                            ? { ...l, price: e.target.value.trim() || undefined }
                            : l,
                        ),
                      })
                    }
                    aria-label={`price for ${entry?.name ?? line.ref}`}
                  />
                  <input
                    className={`${input} w-14 text-right font-mono`}
                    placeholder="∞"
                    defaultValue={line.qty ?? ''}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      saveVendor({
                        ...vendor,
                        stock: vendor.stock!.map((l, j) =>
                          j === i
                            ? {
                                ...l,
                                qty:
                                  e.target.value.trim() === '' ||
                                  !Number.isFinite(n)
                                    ? null
                                    : Math.max(0, Math.floor(n)),
                              }
                            : l,
                        ),
                      });
                    }}
                    aria-label={`stock of ${entry?.name ?? line.ref}`}
                  />
                  <button
                    className={`${btnGhost} hover:text-red-300`}
                    onClick={() =>
                      saveVendor({
                        ...vendor,
                        stock: vendor.stock!.filter((_, j) => j !== i),
                      })
                    }
                    aria-label={`remove ${entry?.name ?? line.ref}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button className={btnGhost} onClick={() => setStocking(!stocking)}>
              {stocking ? 'done' : '+ stock the shelf'}
            </button>
            {stocking && (
              <CatalogPicker
                packs={packs}
                own={campaign.data.catalog}
                dice={template?.dice}
                onPick={(entry) =>
                  saveVendor({
                    ...vendor,
                    stock: [...(vendor.stock ?? []), { ref: entry.id }],
                  })
                }
                onClose={() => setStocking(false)}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* THE COUNTER — only while a shop is open. */}
      {open && (
        <section className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={sectionLabel}>
              {openVendor?.name ?? 'a shop'} — open
            </span>
            <button
              className={`${btnGhost} ml-auto`}
              onClick={() => onOp({ op: 'shop', vendorId: null })}
            >
              close the shop
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {characters.filter((c) => c.kind === 'pc').map(counterRow)}
            {!Object.values(open.carts).some((c) => c.length) && (
              <p className="text-[12px] text-stone-600">
                the seats are browsing — carts land here when someone puts one
                on the counter
              </p>
            )}
          </div>
        </section>
      )}

      {/* VENDORS — the world's shops, kept between sessions. */}
      <section className={card}>
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>Vendors</span>
          <button className={btnGhost} onClick={addVendor}>
            + new vendor
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {vendors.length === 0 && (
            <p className="text-[12px] text-stone-600">
              no shops yet — a new vendor carries everything priced until you
              narrow it
            </p>
          )}
          {vendors.map((vendor) => (
            <div
              key={vendor.id}
              className="rounded-lg border border-stone-800 bg-stone-900/40 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-stone-100">{vendor.name}</span>
                {vendor.blurb && (
                  <span className="text-[12px] italic text-stone-500">
                    {vendor.blurb}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {open?.vendorId === vendor.id ? (
                    <span className="text-[11px] uppercase tracking-widest text-amber-400">
                      open
                    </span>
                  ) : (
                    <button
                      className={btn}
                      onClick={() => onOp({ op: 'shop', vendorId: vendor.id })}
                      title={`open ${vendor.name} on every seat`}
                    >
                      open shop
                    </button>
                  )}
                  <button
                    className={btnGhost}
                    onClick={() =>
                      setEditingId(editingId === vendor.id ? null : vendor.id)
                    }
                  >
                    {editingId === vendor.id ? 'done' : 'edit'}
                  </button>
                  <button
                    className={`${btnGhost} hover:text-red-300`}
                    onClick={() =>
                      window.confirm(`Remove ${vendor.name}?`) &&
                      onVendors(vendors.filter((v) => v.id !== vendor.id))
                    }
                    aria-label={`remove ${vendor.name}`}
                  >
                    ✕
                  </button>
                </span>
              </div>
              {editingId === vendor.id && vendorEditor(vendor)}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-stone-600">
          opening a shop puts a Store screen on every seat; carts return here
          for the {gm} to rule on. prices are often negotiable.
        </p>
      </section>
    </div>
  );
}

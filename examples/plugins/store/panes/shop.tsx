// THE SEAT'S SHELF — what a player sees when the Warden opens a shop.
//
// Ported twice now: out of the old app's `src/components/sheet/
// ShopScreen.tsx` into teller's own `client/components/items/Shop.tsx`,
// and out of teller into the store plugin's own pane (§15) when the
// counter left the repo. The grammar is kept whole through both moves,
// because the grammar was the work:
//
//   * a CHIP ROW that narrows the whole store to one shelf, because
//     three hundred goods in one undifferentiated run is a wall, not a
//     shop;
//   * a shelf of tiles, each one −/+ and a price, panning on mounted
//     glass and wrapping on a phone (rule 6's deliberate shelf — the
//     store's own shelf is what won that argument in the first place);
//   * a DETAIL face for one thing up close, filing stats first, because
//     the quality tier and the price are most of the decision;
//   * and a CART FOOTER pinned to the bottom, so what you've gathered
//     and what it comes to is never something you scroll back to find.
//
// Where the numbers live moved with it. The old screen resolved the
// shelf itself out of packs the browser held; the block version was
// handed a resolved `ShopView` by the seat chrome. This one ASKS for
// its own, through the `shop` door and nothing else, and asks again on
// every nudge — so the shelf keeps up when the DM sells something
// without anybody wiring a prop through the chrome. Stock, prices and
// who-sees-whose cart are all the plugin's rulings (`store.mjs`); this
// does no arithmetic beyond adding up the tiles it's showing.
//
// ONE CONSTRAINT THIS PANE DOESN'T SHARE WITH THE FILE IT CAME FROM.
// Tailwind builds teller's stylesheet by scanning teller's OWN source,
// and a shelf folder isn't in it — so a pane may only wear the
// utilities teller's client already uses somewhere. Arbitrary values
// (`w-[19rem]`, `text-[11px]`) compile to nothing, and this file was
// their only user before it moved: the shelf rendered as unstyled
// vertical slivers the first time it ran outside the repo. So every
// bracketed utility here is an inline `style` instead, pixel for pixel.
// A pane wanting more than that brings its own stylesheet (rung 3).
//
// Nothing here BUYS. A cart is a proposal put on a counter; the sale is
// the DM's, at the console. That is the same shape as everything else a
// seat may do — it moves its own numbers and asks for the rest.

import { Fragment, useMemo, useState } from 'react';
import { SheetPanel, StatRow, useLive, type BlockCtx, type Entity, type Glass } from 'teller';
import { formatPrice, parsePrice } from '../store.mjs';

// ---- what the doors answer with ---------------------------------------
// The same shapes the console pane names, and for the same reason: this
// is the wire between the plugin's two halves, and `store.mjs` carries
// arithmetic rather than types.

type Entry = { name: string; value?: unknown };

type StockLine = {
  ref: string;
  name: string;
  type?: string;
  /** The catalogue's shelf label — what the chip row narrows by. */
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
  held?: number;
};

type ShopView = {
  vendor: { id: string; name: string; blurb?: string; live: boolean };
  shelf: StockLine[];
  carts: ShopQuote[];
};

/** A pane always has its plugin — that is what makes it a pane (§15). */
type PaneProps = BlockCtx & { plugin: NonNullable<BlockCtx['plugin']> };

/** The accent, spelled once — every card, price and chip reads it. */
const ACCENT = 'var(--sheet-accent, #f59e0b)';

/**
 * The SHELF GRID, both families (rule 6).
 *
 * Mounted glass PANS: the shelf fills DOWN a column and then marches
 * right, one 6.7rem card per row and 16rem per column, because one
 * full-height card per item would spend the whole rail on four goods.
 * How many fit per column is derived from the card's own height against
 * the glass — `auto-fill` decides it, nothing declares it.
 *
 * Held glass WRAPS: as many columns as fit at a 15rem floor, one column
 * in a hand, every row the same height.
 */
const GRID: Record<Glass, React.CSSProperties> = {
  mounted: {
    gridAutoFlow: 'column',
    gridTemplateRows: 'repeat(auto-fill, 6.7rem)',
    gridAutoColumns: '16rem',
  },
  held: {
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 15rem), 1fr))',
    gridAutoRows: 'minmax(5.5rem, auto)',
  },
};

/** How many of this line are already in the cart. */
function inCart(cart: CartLine[], ref: string): number {
  return cart.find((l) => l.ref === ref)?.qty ?? 0;
}

/** The rule between shelves, when the whole store is on display. */
function GroupRule({ label, glass }: { label: string; glass: Glass }) {
  if (glass === 'mounted') {
    // On the panning bar the rule stands UP, so a shelf change is
    // visible as you sweep past it.
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 self-stretch px-1">
        <div className="w-px flex-1 bg-stone-800" />
        <span
          className="whitespace-nowrap uppercase text-stone-500"
          style={{ writingMode: 'vertical-rl', fontSize: '0.6rem', letterSpacing: '0.2em' }}
        >
          {label}
        </span>
        <div className="w-px flex-1 bg-stone-800" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 pt-1">
      <span
        className="uppercase tracking-widest text-stone-500"
        style={{ fontSize: '0.65rem' }}
      >
        {label}
      </span>
      <div className="h-px flex-1 bg-stone-800" />
    </div>
  );
}

const STEP_BTN =
  'flex shrink-0 select-none items-center justify-center rounded-lg bg-stone-800 text-lg text-stone-200 transition-colors hover:bg-stone-700 active:bg-amber-700 active:text-stone-950 disabled:pointer-events-none disabled:opacity-30';

/**
 * The −/+ pair, identical on the card and in the detail.
 *
 * At zero the minus is INVISIBLE rather than greyed and the count isn't
 * drawn at all — a shelf of thirty goods each announcing a nought is a
 * shelf of noughts. The card keeps the minus's room, so nothing shifts
 * when the first one goes in the cart.
 */
function Stepper({
  line,
  have,
  big = false,
  onSet,
}: {
  line: StockLine;
  have: number;
  big?: boolean;
  onSet: (qty: number) => void;
}) {
  const soldOut = line.qty !== null && line.qty <= 0;
  // Stock caps what you can gather; unlimited caps at something sane so
  // a stuck finger doesn't put ninety-nine rifles on the counter.
  const ceiling = line.qty === null ? 99 : line.qty;
  const size = big
    ? { height: '2.5rem', minWidth: '2.5rem' }
    : { height: '2rem', minWidth: '2rem' };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={`one fewer ${line.name}`}
        className={`${STEP_BTN} ${have === 0 ? 'invisible' : ''}`}
        style={size}
        onClick={() => onSet(have - 1)}
      >
        −
      </button>
      {have > 0 && (
        <span
          className="text-center font-mono tabular-nums"
          style={{
            color: ACCENT,
            minWidth: '1.25rem',
            fontSize: big ? '1rem' : '0.875rem',
          }}
        >
          {have}
        </span>
      )}
      <button
        type="button"
        aria-label={`one more ${line.name}`}
        disabled={soldOut || have >= ceiling || parsePrice(line.price) === null}
        className={STEP_BTN}
        style={size}
        onClick={() => onSet(have + 1)}
      >
        +
      </button>
    </div>
  );
}

/**
 * One thing on the shelf: a name, what it's off, its price, and the
 * count you're taking.
 *
 * **A shelf is a TABLE, so every card is the same card.** `h-full`
 * hands it the grid row's height, so a row of goods lines up whatever
 * the names did; two lines of room for the name means nearly every card
 * is the same height without a single name being cut (nothing
 * truncates, ever). NOT a `SheetPanel` — the sheet's corner ticks and
 * darts are the chrome of a BLOCK, and thirty of them side by side read
 * as a jumble rather than as stock.
 */
function StockTile({
  line,
  have,
  glass,
  onSet,
  onOpen,
}: {
  line: StockLine;
  have: number;
  glass: Glass;
  onSet: (qty: number) => void;
  onOpen: () => void;
}) {
  const soldOut = line.qty !== null && line.qty <= 0;
  return (
    <div
      className={`flex h-full flex-col rounded-lg border bg-stone-900/60 transition-colors ${
        have > 0 ? '' : 'border-stone-800'
      } ${glass === 'mounted' ? 'snap-start' : ''} ${soldOut ? 'opacity-50' : ''}`}
      style={have > 0 ? { borderColor: ACCENT } : undefined}
    >
      {/* The whole upper card opens it. A shelf label is a thing you
          point at, so the target is the card, not a chevron. */}
      <button
        type="button"
        className="flex min-h-0 flex-1 flex-col items-start gap-1 px-3 pt-2 text-left"
        onClick={onOpen}
        aria-label={`${line.name} — look closer`}
        disabled={line.missing}
      >
        <span
          className="break-words font-serif leading-tight text-stone-100"
          style={{ minHeight: '2.4em', fontSize: '0.9rem' }}
        >
          {line.name}
        </span>
        {/* Always a LINE, even with nothing to say — a card with no
            count would otherwise stand a line shorter than the rifle
            beside it, and that, not the names, is what makes a shelf
            ragged. The blank is a real line of this exact type, so it
            can't drift from one. */}
        <span
          className="flex flex-wrap gap-x-2 uppercase tracking-widest text-stone-500"
          style={{ fontSize: '0.6rem' }}
        >
          {/* A stocked ref whose catalogue entry isn't on this host is a
              hole to REPORT, never to hide (rule 9). */}
          {line.missing && (
            <span style={{ color: 'rgb(180 83 9 / 0.8)' }}>not on this host</span>
          )}
          {line.qty !== null && (
            <span style={soldOut ? { color: 'rgb(248 113 113 / 0.8)' } : undefined}>
              {soldOut ? 'sold out' : `${line.qty} left`}
            </span>
          )}
          {!line.missing && line.qty === null && <span>&nbsp;</span>}
        </span>
      </button>
      {/* The price and the count, on the same line at the same height on
          every card — the row of them reads as one price list. */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <span
          className="min-w-0 flex-1 font-mono text-sm tabular-nums"
          style={{ color: ACCENT }}
        >
          {line.price ?? '—'}
        </span>
        <Stepper line={line} have={have} onSet={onSet} />
      </div>
    </div>
  );
}

/** The way back — a round accent-bordered chevron you can hit with a thumb. */
function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="group flex shrink-0 items-center gap-2 self-start"
      aria-label={label}
      onClick={onClick}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors"
        style={{ borderColor: ACCENT, color: ACCENT }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
      </span>
      <span
        aria-hidden
        className="uppercase tracking-widest text-stone-400 transition-colors group-hover:text-stone-100"
        style={{ fontSize: '0.7rem' }}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * One thing up close — its stats in the catalogue's own order.
 *
 * It OWNS the screen: the shelf's chips and cards would only compete
 * with the thing you opened them to read. And it carries its own price
 * and stepper at the foot, because walking back to the shelf to pick up
 * the thing you just decided on is a step nobody wants.
 */
function Detail({
  line,
  have,
  glass,
  onSet,
  onBack,
}: {
  line: StockLine;
  have: number;
  glass: Glass;
  onSet: (qty: number) => void;
  onBack: () => void;
}) {
  const soldOut = line.qty !== null && line.qty <= 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <BackButton label="the shelf" onClick={onBack} />
      <div
        className={`flex min-h-0 flex-1 flex-col gap-2 ${
          glass === 'mounted' ? 'overflow-y-auto' : ''
        }`}
      >
        <SheetPanel title={line.name} className="w-full">
          <div className="flex flex-col gap-2">
            {/* Filing first, because this IS the moment you're choosing
                the thing — what it costs and what shelf it's off are
                most of the decision at the gunsmith's. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-stone-400" style={{ fontSize: '0.7rem' }}>
                <span className="uppercase tracking-widest text-stone-600">here </span>
                <span className="font-mono" style={{ color: ACCENT }}>
                  {line.price ?? '—'}
                </span>
              </span>
              {(line.group ?? line.type) && (
                <span
                  className="uppercase tracking-widest text-stone-600"
                  style={{ fontSize: '0.6rem' }}
                >
                  {line.group ?? line.type}
                </span>
              )}
            </div>

            {line.stats.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-stone-800 pt-2">
                {line.stats.map((stat) => (
                  <StatRow key={stat.name} label={stat.name} value={String(stat.value ?? '')} />
                ))}
              </div>
            )}
          </div>
        </SheetPanel>

        <div className="flex shrink-0 items-center gap-3 rounded-lg border border-stone-800 bg-stone-900/60 px-3 py-2">
          <span className="min-w-0 flex-1 font-mono text-base tabular-nums text-stone-100">
            {line.price ?? '—'}
          </span>
          {line.qty !== null && (
            <span
              className="uppercase tracking-widest text-stone-500"
              style={{ fontSize: '0.65rem' }}
            >
              {soldOut ? 'sold out' : `${line.qty} left`}
            </span>
          )}
          <Stepper line={line} have={have} big onSet={onSet} />
        </div>
      </div>
    </div>
  );
}

/** What you've gathered, and the one verb: put it on the counter. */
function Cart({
  cart,
  total,
  symbol,
  short,
  offered,
  gm,
  onOffer,
}: {
  cart: CartLine[];
  total: number;
  symbol: string;
  short: boolean;
  offered: boolean;
  gm: string;
  onOffer: (on: boolean) => void;
}) {
  if (!cart.length) return null;
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${
        offered ? 'border-amber-600/60 bg-amber-950/95' : 'border-stone-800 bg-stone-950/95'
      }`}
    >
      <span className="uppercase tracking-widest text-stone-500" style={{ fontSize: '11px' }}>
        cart
      </span>
      <span className="font-mono text-sm text-stone-100">{formatPrice(total, symbol)}</span>
      {short && (
        <span className="text-red-400" style={{ fontSize: '11px' }}>
          more than you're carrying
        </span>
      )}
      {offered ? (
        <>
          <span className="text-amber-300" style={{ fontSize: '12px' }}>
            on the counter — waiting on the {gm}
          </span>
          <button
            type="button"
            className="ml-auto rounded-md bg-stone-800 px-3 py-1.5 text-stone-200 hover:bg-stone-700"
            style={{ fontSize: '12px' }}
            onClick={() => onOffer(false)}
          >
            take it back
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ml-auto rounded-md px-3 py-1.5 font-medium text-stone-950"
          style={{ background: 'var(--sheet-accent, #f59e0b)', fontSize: '12px' }}
          onClick={() => onOffer(true)}
        >
          put it on the counter
        </button>
      )}
    </div>
  );
}

function ShopShelf({
  view,
  entity,
  glass,
  gm,
  onWrite,
}: {
  view: ShopView;
  entity: Entity | undefined;
  glass: Glass;
  /** The system's word for the DM — 'Warden' at this table, `vocabulary.gm`. */
  gm: string;
  /** One cart, replaced whole, through the plugin's own `cart` door. */
  onWrite: (entityId: string, lines: CartLine[], offered?: boolean) => void;
}) {
  const [kind, setKind] = useState('');
  const [detail, setDetail] = useState<string | null>(null);

  const mine = view.carts.find((c) => c.entityId === entity?.id);
  const cart = useMemo(
    () => (mine?.lines ?? []).map((l) => ({ ref: l.ref, qty: l.qty })),
    [mine],
  );

  // The store's own shelves — the catalogue entry's `group`, which is
  // the axis a player browses on ("show me the rifles") and is the same
  // word a derived shop names when it says which shelves it keeps. A
  // catalogue that files nothing falls back to KIND, so a shelf without
  // labels still narrows instead of presenting one undifferentiated
  // wall.
  const shelfOf = (l: StockLine) => l.group ?? l.type ?? '';
  const kinds = useMemo(
    () => [...new Set(view.shelf.map(shelfOf).filter(Boolean))],
    [view.shelf],
  );

  /**
   * The shelf, in sections. One chosen shelf is one section with no rule
   * over it (the chip already said which you're on); ALL is every shelf
   * in turn, each under its own rule — three hundred goods in one
   * undifferentiated run is a wall, not a shop.
   */
  const sections = useMemo(() => {
    if (kind) return [{ name: kind, lines: view.shelf.filter((l) => shelfOf(l) === kind) }];
    const out = kinds.map((k) => ({
      name: k,
      lines: view.shelf.filter((l) => shelfOf(l) === k),
    }));
    // Anything the catalogue never filed still gets a home, and says so.
    const loose = view.shelf.filter((l) => !shelfOf(l));
    if (loose.length) out.push({ name: 'unfiled', lines: loose });
    return out.filter((s) => s.lines.length);
  }, [view.shelf, kinds, kind]);

  const total = cart.reduce((sum, l) => {
    const each = parsePrice(view.shelf.find((s) => s.ref === l.ref)?.price);
    return sum + (each ?? 0) * l.qty;
  }, 0);
  const symbol = mine?.symbol ?? '$';
  const short = mine?.held !== undefined && mine.held < total;

  const write = (next: CartLine[], offered?: boolean) => {
    if (!entity) return;
    onWrite(entity.id, next, offered);
  };

  const setQty = (ref: string, qty: number) => {
    const clamped = Math.max(0, qty);
    const next = cart.filter((l) => l.ref !== ref);
    if (clamped > 0) next.push({ ref, qty: clamped });
    // Changing the cart takes it back off the counter — editing means
    // you're still browsing, and the DM shouldn't rule on a moving
    // target.
    write(next, false);
  };

  if (!entity) return <p className="p-4 text-sm text-stone-500">no entity to shop for</p>;

  const detailLine = detail ? view.shelf.find((l) => l.ref === detail) : undefined;
  const mounted = glass === 'mounted';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* The masthead: whose shop this is, and the seat's own means. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-serif text-lg text-stone-100">{view.vendor.name}</span>
        {view.vendor.blurb && (
          <span className="min-w-0 italic text-stone-500" style={{ fontSize: '12px' }}>
            {view.vendor.blurb}
          </span>
        )}
        {mine?.held !== undefined && (
          <span className="ml-auto font-mono text-sm text-stone-300">
            {formatPrice(mine.held, symbol)}
          </span>
        )}
      </div>

      {detailLine ? (
        <Detail
          line={detailLine}
          have={inCart(cart, detailLine.ref)}
          glass={glass}
          onSet={(q) => setQty(detailLine.ref, q)}
          onBack={() => setDetail(null)}
        />
      ) : (
        <>
          {kinds.length > 1 && (
            <div className="flex shrink-0 flex-wrap gap-1">
              {['', ...kinds].map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={`rounded-md px-2 py-1 uppercase transition-colors ${
                    kind === k
                      ? 'text-stone-950'
                      : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100'
                  }`}
                  style={{
                    fontSize: '0.65rem',
                    letterSpacing: '0.14em',
                    ...(kind === k ? { background: ACCENT } : {}),
                  }}
                >
                  {k || 'all'}
                </button>
              ))}
            </div>
          )}

          {/* The shelf. On mounted glass it PANS sideways, the deliberate
              gesture the item shelves already taught; in a hand it
              stacks and the card scrolls, as it always did. */}
          <div
            key={`shop:${kind}`}
            className={`flex min-h-0 min-w-0 flex-1 gap-2 ${
              mounted
                ? 'snap-x snap-mandatory flex-nowrap items-stretch overflow-x-auto overflow-y-hidden'
                : 'flex-col'
            }`}
          >
            {sections.map((section) => (
              <Fragment key={section.name}>
                {/* Only when the whole store is on show. With one shelf
                    chosen, the chip above already named it. */}
                {!kind && <GroupRule label={section.name} glass={glass} />}
                <div
                  className={`grid gap-2 ${mounted ? 'shrink-0' : ''}`}
                  style={GRID[glass]}
                >
                  {section.lines.map((line) => (
                    <StockTile
                      key={line.ref}
                      line={line}
                      have={inCart(cart, line.ref)}
                      glass={glass}
                      onSet={(q) => setQty(line.ref, q)}
                      onOpen={() => setDetail(line.ref)}
                    />
                  ))}
                </div>
              </Fragment>
            ))}
            {sections.length === 0 && (
              <p className="p-4 text-sm italic text-stone-600">the shelves are bare</p>
            )}
          </div>
        </>
      )}

      <Cart
        cart={cart}
        total={total}
        symbol={symbol}
        short={short}
        offered={mine?.offered ?? false}
        gm={gm}
        onOffer={(on) => write(cart, on)}
      />
    </div>
  );
}

export default function ShopPane({ entity, glass, records, plugin }: PaneProps) {
  // Its own fetch, on its own nudges. `useLive` re-runs on every SSE
  // stir, so a sale at the console empties this cart without the seat
  // chrome knowing the store exists.
  const { data: view, reload } = useLive<ShopView | null>(
    () => plugin.call<ShopView | null>('shop'),
    [],
  );

  const write = (entityId: string, lines: CartLine[], offered?: boolean) => {
    plugin
      .call<ShopView | null>('cart', {
        method: 'PUT',
        path: [entityId],
        body: { lines, ...(offered === undefined ? {} : { offered }) },
      })
      .then(reload)
      .catch(() => {});
  };

  // Nothing while the answer's still coming; the shut shop says so. The
  // tab is gated on this same door (`when: 'shop'` in plugin.json), so
  // the second line is the rare race rather than the ordinary state.
  if (view === undefined) return null;
  if (!view) return <p className="p-4 text-sm text-stone-500">the shop is shut</p>;

  return (
    <ShopShelf
      view={view}
      entity={entity as Entity | undefined}
      glass={glass}
      gm={String(records.vocabulary?.gm ?? 'DM')}
      onWrite={write}
    />
  );
}

import { useMemo, useState } from 'react';
import type { Book, PackEntry, PackRecord } from '../../worker/types';
import { api } from '../lib/api';
import { useBooks } from '../lib/use-books';
import { btnGhost, card, input, sectionLabel } from '../lib/ui';
import { BookReader, type BookTarget } from './BookReader';

// The Warden's rulebook shelf: searches across every uploaded pack for
// this system. Content comes from the packs table (uploaded JSON),
// never from the repo. Type "burn" → the Burned card.
//
// A pack also says which BOOK it's about, by content hash. That
// reference does two jobs here: it tells you whether the book it
// describes is actually on this host, and — for entries that recorded a
// page — it turns a digest entry into "open the book at the sidebar".
// Neither is required. A pack with no book attached is a complete,
// working pack; this is the enrichment layer and it says so by staying
// quiet when there's nothing to add.

type Hit = PackEntry & { section: string; pack: PackRecord };

/** Which book an entry points at: its own, else the pack's. */
function bookFor(hit: Hit): string | undefined {
  return hit.book ?? hit.pack.pack.books?.[0];
}

/**
 * What a pack's book references resolve to on THIS host.
 *
 * A hash names exact bytes, so "missing" is a real and common state —
 * you have the pack a friend sent, you don't have their PDF. Saying so
 * beats a page-jump that silently does nothing.
 */
function shelfFor(
  record: PackRecord,
  books: Book[],
): { id: string; book?: Book }[] {
  return (record.pack.books ?? []).map((id) => ({
    id,
    book: books.find((b) => b.id === id),
  }));
}

function PackBooks({
  record,
  books,
  onChanged,
}: {
  record: PackRecord;
  books: Book[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const shelf = shelfFor(record, books);
  const attached = new Set(record.pack.books ?? []);
  const spare = books.filter((b) => !attached.has(b.id));

  // Attaching writes the whole pack back, because a pack is a document
  // and `books` is part of it — the same PUT an upload uses.
  const setBooks = async (ids: string[]) => {
    setBusy(true);
    try {
      await api.putPack({ ...record.pack, books: ids });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const counts = [
    count(record.pack.sections.reduce((n, s) => n + s.entries.length, 0), 'entry', 'entries'),
    record.pack.npcs?.length ? count(record.pack.npcs.length, 'foe', 'foes') : '',
  ].filter(Boolean);

  return (
    <div className="rounded-md bg-stone-900 px-2 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-stone-200">{record.name}</span>
        <span className="font-mono text-[11px] text-stone-600">{counts.join(' · ')}</span>
      </div>

      <ul className="mt-1 space-y-0.5">
        {shelf.map(({ id, book }) => (
          <li key={id} className="flex items-center gap-2">
            <span
              className={`font-mono text-[11px] ${book ? 'text-amber-400' : 'text-stone-500'}`}
            >
              {book ? book.name : `${id} — not on this host`}
            </span>
            <button
              className={`${btnGhost} ml-auto text-[11px] hover:text-red-300`}
              disabled={busy}
              title="stop pointing this pack at that book"
              onClick={() => setBooks((record.pack.books ?? []).filter((b) => b !== id))}
            >
              detach
            </button>
          </li>
        ))}
      </ul>

      {/* Attaching is a thing you do once and then forget. A permanent
          full-width "attach a book…" select can't tell "nothing attached
          yet" from "attached, and this host happens to hold another
          book" — so it sat under a finished pack looking like a chore.
          Collapsed to a quiet link that opens the picker on purpose,
          which is also what the header comment already promised: the
          enrichment layer stays quiet when there's nothing to add. */}
      {spare.length > 0 &&
        (adding ? (
          <div className="mt-1 flex items-center gap-1">
            <select
              className={`${input} min-w-0 flex-1 text-xs`}
              value=""
              disabled={busy}
              autoFocus
              onChange={(e) => {
                if (!e.target.value) return;
                setBooks([...(record.pack.books ?? []), e.target.value]);
                setAdding(false);
              }}
            >
              <option value="">choose a book…</option>
              {spare.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className={`${btnGhost} text-[11px]`} onClick={() => setAdding(false)}>
              cancel
            </button>
          </div>
        ) : (
          <button
            className={`${btnGhost} mt-0.5 text-[11px] text-stone-600 hover:text-stone-300`}
            onClick={() => setAdding(true)}
          >
            + attach {shelf.length ? 'another book' : 'a book'}
          </button>
        ))}
    </div>
  );
}

/**
 * Which packs this table runs on, and in what order.
 *
 * The order is the point, not decoration. When two packs print the same
 * foe and nobody has picked one, the LAST one wins — you name the base,
 * then what goes on top. Before this existed the winner was whichever
 * pack sorted first alphabetically, which decided real collisions by
 * where a name happened to fall.
 *
 * No claim means "everything for this system", and that stays the
 * default forever: a host with one pack should never make anyone tick a
 * box. Touching this materialises the list, and from then on it's yours.
 */
function PackShelf({
  available,
  claim,
  missing,
  onClaim,
}: {
  available: PackRecord[];
  claim?: string[];
  missing: string[];
  onClaim: (ids: string[]) => void;
}) {
  const byId = new Map(available.map((p) => [p.id, p]));
  const explicit = claim?.length ? claim : null;
  const order = explicit ?? available.map((p) => p.id);
  const unclaimed = available.filter((p) => !order.includes(p.id));

  const move = (i: number, by: number) => {
    const next = [...order];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onClaim(next);
  };

  if (!available.length && !missing.length) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-stone-600">
          running on
        </span>
        {!explicit && (
          <span className="text-[11px] text-stone-600">
            every pack for this system
          </span>
        )}
      </div>

      <ol className="space-y-0.5">
        {order.map((id, i) => {
          const record = byId.get(id);
          return (
            <li key={id} className="flex items-center gap-1.5">
              <span className="w-4 text-right font-mono text-[10px] text-stone-700">
                {i + 1}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-xs ${
                  record ? 'text-stone-300' : 'text-red-300'
                }`}
              >
                {record ? record.name : `${id} — not on this host`}
              </span>
              <button
                className={`${btnGhost} text-[11px]`}
                title="earlier — later packs win a collision"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                className={`${btnGhost} text-[11px]`}
                title="later — later packs win a collision"
                disabled={i === order.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                className={`${btnGhost} text-[11px] hover:text-red-300`}
                title="this table stops using this pack"
                onClick={() => onClaim(order.filter((x) => x !== id))}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ol>

      {unclaimed.length > 0 && explicit && (
        <select
          className={`${input} w-full text-xs`}
          value=""
          onChange={(e) => e.target.value && onClaim([...order, e.target.value])}
        >
          <option value="">also use…</option>
          {unclaimed.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function RulesPanel({
  packs,
  claim,
  missing = [],
  onClaim,
  onUploaded,
}: {
  /** Every pack on this host for this system. */
  packs: PackRecord[];
  /** The campaign's ordered claim, if it has made one. */
  claim?: string[];
  /** Claimed pack ids this host doesn't hold. */
  missing?: string[];
  onClaim: (ids: string[]) => void;
  onUploaded: () => void;
}) {
  const { books } = useBooks();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [reading, setReading] = useState<BookTarget | null>(null);

  // What this TABLE runs on, not everything the host happens to hold.
  // Searching the rules should answer from the books you're playing
  // with — a pack you deliberately switched off shouldn't answer back.
  const active = useMemo(() => {
    if (!claim?.length) return packs;
    const byId = new Map(packs.map((p) => [p.id, p]));
    return claim.map((id) => byId.get(id)).filter((p): p is PackRecord => Boolean(p));
  }, [packs, claim]);

  const entries = useMemo<Hit[]>(
    () =>
      active.flatMap((record) =>
        record.pack.sections.flatMap((section) =>
          section.entries.map((entry) => ({
            ...entry,
            section: section.title,
            pack: record,
          })),
        ),
      ),
    [active],
  );

  const q = query.trim().toLowerCase();
  const hits = q
    ? entries
        .filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.section.toLowerCase().includes(q) ||
            (e.meta ?? '').toLowerCase().includes(q) ||
            e.text.toLowerCase().includes(q),
        )
        .slice(0, 12)
    : [];

  const upload = async (file: File) => {
    try {
      const pack = JSON.parse(await file.text());
      await api.putPack(pack);
      setStatus(`uploaded “${pack.name}”`);
      onUploaded();
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Rules</span>
        <label className={`${btnGhost} cursor-pointer`}>
          add a pack
          <input
            type="file"
            accept=".pack,application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>

      {packs.length === 0 && !missing.length ? (
        <p className="text-sm text-stone-600">
          no rules packs for this system yet — drop a .pack into the packs folder,
          or add one here
        </p>
      ) : (
        <>
          <PackShelf
            available={packs}
            claim={claim}
            missing={missing}
            onClaim={onClaim}
          />
          <div className="space-y-1">
            {active.map((record) => (
              <PackBooks
                key={record.id}
                record={record}
                books={books}
                onChanged={onUploaded}
              />
            ))}
          </div>
          <input
            className={`${input} w-full`}
            placeholder={`search ${entries.length} entries — try a status, action, or item`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </>
      )}
      {status && <p className="text-xs text-stone-500">{status}</p>}

      <div className="space-y-1.5">
        {hits.map((hit) => {
          const key = `${hit.pack.id}·${hit.section}·${hit.name}`;
          const expanded = open === key;
          // Offer the page only when the book is genuinely here. A dead
          // button is worse than no button.
          const bookId = bookFor(hit);
          const book = hit.page && bookId ? books.find((b) => b.id === bookId) : undefined;
          return (
            <div
              key={key}
              className="rounded-md bg-stone-900 transition-colors hover:bg-stone-800"
            >
              <button
                className="block w-full px-3 py-2 text-left"
                onClick={() => setOpen(expanded ? null : key)}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-stone-100">{hit.name}</span>
                  {hit.meta && (
                    <span className="font-mono text-xs text-amber-400">{hit.meta}</span>
                  )}
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-stone-600">
                    {hit.section}
                  </span>
                </div>
                <p
                  className={`mt-1 whitespace-pre-line text-xs leading-relaxed text-stone-400 ${
                    expanded ? '' : 'line-clamp-2'
                  }`}
                >
                  {hit.text}
                </p>
              </button>
              {expanded && book && (
                <button
                  className={`${btnGhost} mb-1 ml-1 text-[11px] text-amber-400/90`}
                  onClick={() =>
                    setReading({ bookId: book.id, page: hit.page!, name: book.name })
                  }
                >
                  {book.name} · p.{hit.page} →
                </button>
              )}
            </div>
          );
        })}
        {q && hits.length === 0 && packs.length > 0 && (
          <p className="text-sm text-stone-600">nothing matches “{query}”</p>
        )}
      </div>

      {reading && <BookReader target={reading} onClose={() => setReading(null)} />}
    </section>
  );
}

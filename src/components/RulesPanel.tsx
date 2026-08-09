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

      {spare.length > 0 && (
        <select
          className={`${input} mt-1 w-full text-xs`}
          value=""
          disabled={busy}
          onChange={(e) =>
            e.target.value && setBooks([...(record.pack.books ?? []), e.target.value])
          }
        >
          <option value="">attach a book…</option>
          {spare.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function RulesPanel({
  packs,
  onUploaded,
}: {
  packs: PackRecord[];
  onUploaded: () => void;
}) {
  const { books } = useBooks();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [reading, setReading] = useState<BookTarget | null>(null);

  const entries = useMemo<Hit[]>(
    () =>
      packs.flatMap((record) =>
        record.pack.sections.flatMap((section) =>
          section.entries.map((entry) => ({
            ...entry,
            section: section.title,
            pack: record,
          })),
        ),
      ),
    [packs],
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
          upload pack
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>

      {packs.length === 0 ? (
        <p className="text-sm text-stone-600">
          no rules packs for this system yet — upload a pack .json
        </p>
      ) : (
        <>
          <div className="space-y-1">
            {packs.map((record) => (
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

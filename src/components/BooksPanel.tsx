import { useRef, useState } from 'react';
import type { BookHit } from '../../worker/types';
import { api } from '../lib/api';
import { useBooks } from '../lib/use-books';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui';
import { BookReader, type BookTarget } from './BookReader';

// Rulebooks.
//
// A book lives on the host and nowhere else. Upload it once and every
// screen in the room can read it — the table TV, a rail panel, a
// player's phone. There is no per-device import, no copy stranded in one
// browser, and no "not on this screen".
//
// The library spans every system you own: WiW, D&D, whatever else. You
// own the books; campaigns refer to them by id. Which is why a `.tell`
// file carries a reference and not a rulebook.
//
// The viewer is the browser's own PDF reader over a URL, which is why
// there's no viewer code here — and because the host serves ranges, it
// pulls the page you asked for instead of the whole book.

function Snippet({ text }: { text: string }) {
  // The server fences matched words in \x02…\x03 so the highlight lands
  // on what FTS5 actually matched, stem and all — "grappled" lights up
  // for "grapple", which re-searching the string could never do.
  const runs = text.split(/\x02([^\x03]*)\x03/).filter(Boolean);
  return (
    <>
      {runs.map((run, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-transparent font-semibold text-stone-100">
            {run}
          </mark>
        ) : (
          <span key={i}>{run}</span>
        ),
      )}
    </>
  );
}

export function BooksPanel({
  expects,
  onExpects,
}: {
  /** Book ids this campaign uses — see `CampaignData.books`. */
  expects: string[];
  onExpects: (ids: string[]) => void;
}) {
  // The shelf is shared — a book added here shows up in the rules panel's
  // "you have this book" check without either panel knowing the other.
  const { books, refresh } = useBooks();
  const [showAll, setShowAll] = useState(false);
  const used = new Set(expects.filter((id) => books.some((b) => b.id === id)));
  // Expected but absent: a reference you can't resolve yet is still the
  // truth about what this adventure needs, so it's said out loud rather
  // than quietly dropped.
  const missing = expects.filter((id) => !books.some((b) => b.id === id));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<BookTarget | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const add = async (file: File) => {
    setError('');
    setBusy(`sending ${file.name}…`);
    try {
      const { duplicate, book } = await api.addBook(file);
      setBusy('');
      if (duplicate) setError(`You already have “${book.name}” — same book, same bytes.`);
      refresh();
    } catch (e) {
      setBusy('');
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const search = async () => {
    if (query.trim().length < 2) return setHits(null);
    try {
      const { hits, total } = await api.searchBooks(query.trim());
      setHits(hits);
      setTotal(total);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const openAt = (bookId: string, page: number, name: string) =>
    setOpen({ bookId, page, name });

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Rulebooks</span>
        <span className="font-mono text-[11px] text-stone-600">
          {books.length ? `${books.length} on this host` : 'the whole shelf'}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="search every book…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className={btn} onClick={search}>
          find
        </button>
      </div>

      {hits && (
        <div className="space-y-1">
          {hits.length === 0 && <p className="text-sm text-stone-600">nothing found</p>}
          {total > hits.length && (
            <p className="font-mono text-[11px] text-stone-600">
              best {hits.length} of {total} pages
            </p>
          )}
          {hits.map((hit) => (
            <button
              key={`${hit.bookId}-${hit.page}`}
              className="block w-full rounded-md bg-stone-900 px-2 py-1.5 text-left transition-colors hover:bg-stone-800"
              onClick={() => openAt(hit.bookId, hit.page, hit.bookName)}
            >
              <span className="font-mono text-[11px] text-amber-400">
                {hit.bookName} · p.{hit.page}
              </span>
              <span className="block text-xs leading-snug text-stone-400">
                <Snippet text={hit.snippet} />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* You own the shelf; this table only uses some of it. Ten
          rulebooks in a list, seven of them two-page class sheets, is
          noise when you're asking "what does THIS adventure need". So:
          this campaign's books first, the rest one click away. Nothing
          is hidden — the shelf is still yours. */}
      <ul className="space-y-1">
        {(showAll ? books : books.filter((b) => used.has(b.id))).map((book) => (
          <li key={book.id} className="flex items-center gap-2">
            <button
              className="min-w-0 flex-1 truncate text-left text-sm text-stone-200 hover:text-stone-50"
              onClick={() => openAt(book.id, 1, book.name)}
            >
              {book.name}
            </button>
            <span className="font-mono text-[11px] text-stone-600">
              {book.indexed ? `${book.pages}p` : 'reading…'}
            </span>
            <button
              className={btnGhost}
              title={
                used.has(book.id)
                  ? 'this campaign stops expecting this book'
                  : 'this campaign uses this book'
              }
              onClick={() =>
                onExpects(
                  used.has(book.id)
                    ? expects.filter((id) => id !== book.id)
                    : [...expects, book.id],
                )
              }
            >
              {used.has(book.id) ? '★' : '☆'}
            </button>
            <button
              className={`${btnGhost} hover:text-red-300`}
              title="remove this book from the host"
              onClick={async () => {
                if (!window.confirm(`Remove "${book.name}" from this host?`)) return;
                await api.deleteBook(book.id).catch(() => {});
                onExpects(expects.filter((id) => id !== book.id));
                refresh();
              }}
            >
              ✕
            </button>
          </li>
        ))}
        {books.length === 0 && <li className="text-sm text-stone-600">no books yet</li>}
        {books.length > 0 && !showAll && used.size === 0 && (
          <li className="text-sm text-stone-600">
            this campaign hasn't claimed any of your books yet
          </li>
        )}
      </ul>

      {books.length > used.size && (
        <button className={btnGhost} onClick={() => setShowAll(!showAll)}>
          {showAll
            ? 'just this campaign’s books'
            : `the rest of the shelf (${books.length - used.size})`}
        </button>
      )}

      {missing.length > 0 && (
        <p className="text-sm text-amber-500/80">
          {missing.length} book{missing.length === 1 ? '' : 's'} this campaign expects
          {missing.length === 1 ? " isn't" : " aren't"} on this host yet — add the PDF
          and it links up by itself.
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void add(file);
            e.target.value = '';
          }}
        />
        <button className={btn} disabled={!!busy} onClick={() => fileRef.current?.click()}>
          add a PDF…
        </button>
        {busy && <span className="font-mono text-xs text-amber-400">{busy}</span>}
      </div>

      {error && <p className="text-sm text-amber-500/80">{error}</p>}

      {open && <BookReader target={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

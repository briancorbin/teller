import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookHit } from '../../worker/types';
import { api } from '../lib/api';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui';

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

export function BooksPanel({ system }: { system: string }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<{ url: string; name: string; page: number } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    api.books().then(setBooks).catch(() => setBooks([]));
  }, []);
  useEffect(load, [load]);

  // A book the host is still reading becomes searchable partway through
  // this poll, so keep looking while any of them is unread.
  const reading = books.some((b) => !b.indexed);
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [reading, load]);

  const add = async (file: File) => {
    setError('');
    setBusy(`sending ${file.name}…`);
    try {
      const { duplicate, book } = await api.addBook(file, system);
      setBusy('');
      if (duplicate) setError(`You already have “${book.name}” — same book, same bytes.`);
      load();
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

  const openAt = async (bookId: string, page: number, name: string) => {
    try {
      const { url } = await api.bookTicket(bookId);
      setOpen({ url, name, page });
    } catch {
      setError(`“${name}” isn't on this host.`);
    }
  };

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

      <ul className="space-y-1">
        {books.map((book) => (
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
              className={`${btnGhost} hover:text-red-300`}
              title="remove this book from the host"
              onClick={async () => {
                if (!window.confirm(`Remove "${book.name}" from this host?`)) return;
                await api.deleteBook(book.id).catch(() => {});
                load();
              }}
            >
              ✕
            </button>
          </li>
        ))}
        {books.length === 0 && <li className="text-sm text-stone-600">no books yet</li>}
      </ul>

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

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-stone-950">
          <div className="flex items-center gap-2 border-b border-stone-800 p-2">
            <span className="font-serif text-lg text-stone-200">{open.name}</span>
            <button className={`${btn} ml-auto`} onClick={() => setOpen(null)}>
              close
            </button>
          </div>
          <iframe
            title={open.name}
            className="flex-1"
            src={`${open.url}#page=${open.page}`}
          />
        </div>
      )}
    </section>
  );
}

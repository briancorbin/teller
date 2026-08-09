import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookHit } from '../../worker/types';
import { api } from '../lib/api';
import {
  deleteLocalBook,
  extractPages,
  getLocalBook,
  localBookIds,
  opfsSupported,
  saveLocalBook,
  splitSnippet,
} from '../lib/books';
import {
  libraryBookIndex,
  libraryBookUrl,
  probeLibraries,
  type Library,
} from '../lib/loader';
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui';

// Rulebooks. Import one and it stays on this device; searching finds the
// page and opens the book there.
//
// Rendering is the browser's own PDF viewer over a blob URL, which is
// why there's no viewer code here: #page=N is a thing browsers already
// do well, and it means no second renderer to maintain.
//
// A book can reach this screen two ways. Imported, and it lives in this
// browser's own storage. Or it's in a LIBRARY the loader serves from
// loopback — a folder on this machine, or a card you plugged in — in which
// case the viewer streams it, which is how a hundred-megabyte rulebook
// opens at page 184 without being held in memory whole. Either way the
// file never touches a server.

export function BooksPanel({ system }: { system: string }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [here, setHere] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<{
    url: string;
    name: string;
    page: number;
    blob: boolean;
  } | null>(null);
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    api.books(system).then(setBooks).catch(() => setBooks([]));
    localBookIds().then(setHere);
  }, [system]);
  useEffect(load, [load]);

  // Drives come and go while the console stays open — that's the whole
  // gesture. Polling loopback every few seconds costs nothing, and it
  // means plugging a card in is the only step there is.
  useEffect(() => {
    let live = true;
    const tick = () => void probeLibraries().then((l) => live && setLibraries(l));
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  // Where a given book can be read from right now, if anywhere.
  const served = new Map(
    (libraries ?? []).flatMap((lib) =>
      lib.books.map((book) => [book.id, { lib, book }] as const),
    ),
  );
  const known = new Set(books.map((b) => b.id));

  // Blob URLs are handles to memory; letting them pile up leaks the book.
  useEffect(() => {
    return () => {
      if (open?.blob) URL.revokeObjectURL(open.url);
    };
  }, [open]);

  const importBook = async (file: File) => {
    setError('');
    try {
      const name = file.name.replace(/\.pdf$/i, '');
      setBusy(`storing ${name}…`);
      const { book } = await api.registerBook(system, name);
      await saveLocalBook(book.id, file);

      const { pages, withText } = await extractPages(
        file,
        async (batch, done, total) => {
          setBusy(`reading ${name} — page ${done} of ${total}`);
          await api.indexPages(book.id, batch);
        },
      );
      await api.indexPages(book.id, [], true);

      // A scan has no text layer, and silently indexing nothing would
      // leave you wondering why search never matches.
      if (withText === 0) {
        setError(
          `${name} has no text layer — it's probably a scan, so search won't find anything in it. It's still readable here.`,
        );
      } else if (withText < pages / 2) {
        setError(
          `${name}: only ${withText} of ${pages} pages had text. Partially scanned, so search will be patchy.`,
        );
      }
      setBusy('');
      load();
    } catch (e) {
      setBusy('');
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const search = async () => {
    if (query.trim().length < 2) return setHits(null);
    try {
      const { hits, total } = await api.searchBooks(system, query.trim());
      setHits(hits);
      setTotal(total);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const openAt = async (bookId: string, page: number, name: string) => {
    const close = () => {
      if (open?.blob) URL.revokeObjectURL(open.url);
    };

    // The loader wins when it has the book: it serves ranges, so the viewer
    // pulls the pages it's showing. The imported copy has to become a blob
    // first, and a blob of a 100MB rulebook is 100MB of memory to read one
    // page of it.
    const from = served.get(bookId);
    if (from) {
      close();
      setOpen({ url: libraryBookUrl(from.lib.id, bookId), name, page, blob: false });
      return;
    }

    const file = await getLocalBook(bookId);
    if (!file) {
      setError(
        `"${name}" isn't on this screen — it was imported somewhere else. Import your copy here, or put it in a library the loader can see.`,
      );
      return;
    }
    close();
    setOpen({ url: URL.createObjectURL(file), name, page, blob: true });
  };

  /**
   * Take a book the loader is serving and make it searchable.
   *
   * Only the page text goes up, which is the same bargain every book here
   * makes: the index is teller's, the PDF stays yours. Ids come from the
   * file's own bytes, so doing this twice — or on another panel — lands on
   * the same row instead of a duplicate.
   */
  const adopt = async (lib: Library, book: { id: string; name: string }) => {
    setError('');
    try {
      setBusy(`adding ${book.name}…`);
      const pages = await libraryBookIndex(lib.id, book.id);
      await api.registerBook(system, book.name, book.id);
      for (let i = 0; i < pages.length; i += 25) {
        const batch = pages.slice(i, i + 25);
        setBusy(`adding ${book.name} — page ${i + batch.length} of ${pages.length}`);
        await api.indexPages(book.id, batch);
      }
      await api.indexPages(book.id, [], true);
      setBusy('');
      if (!pages.length) {
        setError(`${book.name} has no text layer — it's a scan, so search can't find anything in it. It's still readable here.`);
      }
      load();
    } catch (e) {
      setBusy('');
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  // No OPFS means this screen can't KEEP a book — it doesn't mean it can't
  // read or search one. A panel on a table's own network is served over
  // plain HTTP, so it has no origin-private storage at all, and yet the
  // host beside it is holding every book there is. Importing is what's
  // unavailable here; everything else works.
  const canKeep = opfsSupported();

  return (
    <section className={`${card} space-y-3`}>
      <div className="flex items-center justify-between">
        <span className={sectionLabel}>Rulebooks</span>
        <span className="font-mono text-[11px] text-stone-600">
          on this device
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
          {hits.length === 0 && (
            <p className="text-sm text-stone-600">nothing found</p>
          )}
          {/* Best-first, so a truncated list is a shortlist, not a cliff —
              but say so, because "too broad" is a real answer. */}
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
                {splitSnippet(hit.snippet).map((run, i) =>
                  run.hit ? (
                    <mark key={i} className="bg-transparent font-semibold text-stone-100">
                      {run.text}
                    </mark>
                  ) : (
                    <span key={i}>{run.text}</span>
                  ),
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-1">
        {books.map((book) => (
          <li key={book.id} className="flex items-center gap-2">
            <button
              className="min-w-0 flex-1 truncate text-left text-sm text-stone-200 hover:text-stone-50 disabled:text-stone-600"
              disabled={!here.has(book.id) && !served.has(book.id)}
              onClick={() => openAt(book.id, 1, book.name)}
            >
              {book.name}
            </button>
            <span className="font-mono text-[11px] text-stone-600">
              {served.has(book.id)
                ? served.get(book.id)!.lib.name
                : here.has(book.id)
                  ? `${book.pages}p`
                  : 'not on this screen'}
            </span>
            <button
              className={`${btnGhost} hover:text-red-300`}
              title="forget this book"
              onClick={async () => {
                if (!window.confirm(`Forget "${book.name}"?`)) return;
                await deleteLocalBook(book.id);
                await api.deleteBook(book.id).catch(() => {});
                load();
              }}
            >
              ✕
            </button>
          </li>
        ))}
        {books.length === 0 && (
          <li className="text-sm text-stone-600">no books yet</li>
        )}
      </ul>

      {/* Books the loader can see that teller hasn't been told about. They
          are already readable — that needs nothing from the server. Adding
          one only puts its page text in search. */}
      {(libraries ?? []).map((lib) => {
        const fresh = lib.books.filter((b) => !known.has(b.id));
        if (!fresh.length) return null;
        return (
          <div key={lib.id} className="space-y-1 border-t border-stone-800 pt-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-amber-400">
                {lib.removable ? '⏏ ' : ''}
                {lib.name}
              </span>
              {fresh.length > 1 && (
                <button
                  className={btnGhost}
                  disabled={!!busy}
                  onClick={async () => {
                    for (const book of fresh) await adopt(lib, book);
                  }}
                >
                  add all {fresh.length}
                </button>
              )}
            </div>
            {fresh.map((book) => (
              <div key={book.id} className="flex items-center gap-2">
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm text-stone-200 hover:text-stone-50"
                  onClick={() => openAt(book.id, 1, book.name)}
                >
                  {book.name}
                </button>
                {book.indexing ? (
                  <span className="font-mono text-[11px] text-stone-600">
                    reading {book.indexing.done}/{book.indexing.total}
                  </span>
                ) : (
                  <button
                    className={btnGhost}
                    disabled={!!busy || !book.indexed}
                    title={book.indexed ? 'make this searchable' : 'still being read'}
                    onClick={() => adopt(lib, book)}
                  >
                    + search
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importBook(file);
            e.target.value = '';
          }}
        />
        {canKeep ? (
          <button className={btn} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            import a PDF…
          </button>
        ) : (
          <span className="text-xs text-stone-600">
            this screen can't keep books of its own — it reads the host's
          </span>
        )}
        {busy && <span className="font-mono text-xs text-amber-400">{busy}</span>}
      </div>

      {error && <p className="text-sm text-amber-500/80">{error}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-stone-950">
          <div className="flex items-center gap-2 border-b border-stone-800 p-2">
            <span className="font-serif text-lg text-stone-200">{open.name}</span>
            <button
              className={`${btn} ml-auto`}
              onClick={() => {
                if (open.blob) URL.revokeObjectURL(open.url);
                setOpen(null);
              }}
            >
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

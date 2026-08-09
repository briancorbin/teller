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
import { btn, btnGhost, card, input, sectionLabel } from '../lib/ui';

// Rulebooks. Import one and it stays on this device; searching finds the
// page and opens the book there.
//
// Rendering is the browser's own PDF viewer over a blob URL, which is
// why there's no viewer code here: #page=N is a thing browsers already
// do well, and it means no second renderer to maintain.

export function BooksPanel({ system }: { system: string }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [here, setHere] = useState<Set<string>>(new Set());
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
    api.books(system).then(setBooks).catch(() => setBooks([]));
    localBookIds().then(setHere);
  }, [system]);
  useEffect(load, [load]);

  // Blob URLs are handles to memory; letting them pile up leaks the book.
  useEffect(() => {
    return () => {
      if (open) URL.revokeObjectURL(open.url);
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
    const file = await getLocalBook(bookId);
    if (!file) {
      setError(
        `"${name}" was imported on a different screen. Import your copy here to read it.`,
      );
      return;
    }
    if (open) URL.revokeObjectURL(open.url);
    setOpen({ url: URL.createObjectURL(file), name, page });
  };

  if (!opfsSupported()) {
    return (
      <section className={`${card} space-y-2`}>
        <span className={sectionLabel}>Rulebooks</span>
        <p className="text-sm text-stone-500">
          This browser can't store books locally. Try Chrome, Edge, Safari 17+
          or Firefox 111+.
        </p>
      </section>
    );
  }

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
              disabled={!here.has(book.id)}
              onClick={() => openAt(book.id, 1, book.name)}
            >
              {book.name}
            </button>
            <span className="font-mono text-[11px] text-stone-600">
              {here.has(book.id) ? `${book.pages}p` : 'not on this screen'}
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
        <button className={btn} disabled={!!busy} onClick={() => fileRef.current?.click()}>
          import a PDF…
        </button>
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
                URL.revokeObjectURL(open.url);
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

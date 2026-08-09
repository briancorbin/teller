import { useEffect, useState } from 'react';
import type { Book } from '../../worker/types';
import { api } from './api';

// What's on the shelf, once per tab.
//
// Three panels care about the book list now — the library lists it, the
// rules panel checks whether a pack's book is actually here, and the
// bestiary offers "open the page". Three independent fetches would each
// hold their own stale copy, so adding a PDF in one panel would leave
// the other two lying about it.
//
// So: one list, one fetch, every subscriber told at once. Same shape as
// the shared session stream — the component count stops mattering.

let books: Book[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(books: Book[]) => void>();

function announce(): void {
  for (const listener of listeners) listener(books);
}

/**
 * Re-read the shelf and tell everyone.
 *
 * Deduplicated while a read is in flight: a panel mounting next to one
 * that's already asking shouldn't cause a second request.
 */
export function refreshBooks(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = api
    .books()
    .then((next) => {
      books = next;
      loaded = true;
      announce();
    })
    .catch(() => {
      // A host that can't answer has no books as far as the UI goes;
      // the panels say "no books yet" rather than showing a stale shelf.
      loaded = true;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The shelf, plus a way to ask again.
 *
 * `reading` is true while the host is still extracting text from
 * something — the caller polls on that, because a book becomes
 * searchable partway through its own upload.
 */
export function useBooks(): { books: Book[]; reading: boolean; refresh: () => void } {
  const [local, setLocal] = useState<Book[]>(books);

  useEffect(() => {
    listeners.add(setLocal);
    if (!loaded) void refreshBooks();
    else setLocal(books);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  const reading = local.some((b) => !b.indexed);
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => void refreshBooks(), 3000);
    return () => clearInterval(timer);
  }, [reading]);

  return { books: local, reading, refresh: () => void refreshBooks() };
}

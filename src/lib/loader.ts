// Talking to the loader.
//
// `loader/teller-loader.mjs` runs on this machine and serves local books on
// 127.0.0.1. A browser can't read a drive, and an HTTPS page can't reach a
// machine across the LAN — but loopback is trusted, because nothing outside
// this computer can answer there. So local files arrive the only way the
// web allows, and that constraint is also the guarantee: these books are
// readable here and by nobody on the network.
//
// A LIBRARY is any directory of books — a folder on the laptop, or a card
// you carried to someone else's table and plugged into their panel. Same
// thing to teller; only the finding differs.
//
// Everything here fails quietly. No loader running is the normal case, not
// an error, and teller works exactly as it did before.

const LOADER = 'http://127.0.0.1:4526';

export type LibraryBook = {
  id: string;
  name: string;
  system: string | null;
  pages: number;
  bytes: number;
  indexed: boolean;
  indexing: { done: number; total: number } | null;
};

export type Library = {
  id: string;
  name: string;
  system: string | null;
  /** Found by being plugged in, rather than by being a path someone named. */
  removable: boolean;
  books: LibraryBook[];
};

/** What the loader is serving, or null if there's no loader at all. */
export async function probeLibraries(): Promise<Library[] | null> {
  try {
    // A refused connection resolves fast; the timeout is for the stranger
    // case where something else is squatting on the port and never answers.
    const res = await fetch(`${LOADER}/manifest`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { loader?: string; libraries?: Library[] };
    if (body.loader !== 'teller') return null;
    return body.libraries ?? [];
  } catch {
    return null;
  }
}

/**
 * The book itself — a URL, not a download.
 *
 * Handed straight to an iframe so the browser's PDF viewer can range-request
 * its way through it. A rulebook is routinely a hundred megabytes, and the
 * OPFS path (whole file into a blob) means holding all of it in memory to
 * read one page mid-session.
 *
 * No #page here: the viewer appends that, the same as it does for a blob
 * URL. Two fragments is one fragment the PDF viewer can't read.
 */
export function libraryBookUrl(libId: string, bookId: string): string {
  return `${LOADER}/books/${libId}/${bookId}.pdf`;
}

/** The page text the loader extracted, ready to hand to search. */
export async function libraryBookIndex(
  libId: string,
  bookId: string,
): Promise<{ page: number; text: string }[]> {
  const res = await fetch(`${LOADER}/books/${libId}/${bookId}/index`);
  if (!res.ok) throw new Error('that book is still being read');
  const body = (await res.json()) as { pages?: { page: number; text: string }[] };
  return body.pages ?? [];
}

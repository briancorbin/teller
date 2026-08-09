import type { Env } from './db';
import type { Book, BookHit } from './types';
import { BOOK_MINUTES, checkTicket, mintTicket } from './tickets';

// Rulebooks. The DM's own PDFs, in the DM's own instance — content, like
// packs, and it never ships (rule 4).
//
// A book lives on the host and nowhere else. Upload it once and every
// screen in the room can read it — no per-device import, no "not on this
// screen", no copy stranded in one browser's storage.
//
// The library is not scoped to a campaign or a system: you own the books,
// campaigns refer to them by id. That's why a `.tell` file carries a
// reference rather than a rulebook.
//
// Reading the text is the HOST's job (see host/library.mjs), not the
// worker's — that keeps pdfjs out of the runtime-agnostic half. Search is
// FTS5 over the result (migration 0006): whole words, stemmed, ranked by
// bm25. Mid-session you get one question and one glance, so the right page
// has to be the first one.

type BookRow = {
  id: string;
  system: string;
  name: string;
  key: string | null;
  pages: number;
  indexed: number;
  created_at: string;
};

export function toBook(row: BookRow): Book {
  return {
    id: row.id,
    system: row.system,
    name: row.name,
    pages: row.pages,
    indexed: Boolean(row.indexed),
    createdAt: row.created_at,
  };
}

/**
 * Turn what someone typed into an FTS5 expression.
 *
 * Raw input can't go near MATCH: `d20 "AC` is a syntax error, and `NOT`
 * is an operator, so a stray word would quietly change the question. So
 * the query is rebuilt from its words — every term quoted as a literal
 * phrase, all of them required. Punctuation is dropped rather than
 * escaped, since none of it means anything to a tokenizer anyway.
 */
function ftsQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
    .slice(0, 12);
  if (!terms.length) return null;
  const quoted = terms.map((t) => `"${t.replace(/"/g, '')}"`);
  const all = quoted.join(' AND ');
  if (quoted.length < 2) return all;

  // Same results, better order. Every page still has to contain every
  // term, but a page where the words sit TOGETHER also matches the phrase
  // branch, and bm25 scores a page once per phrase it matched — so "heavy
  // cover" surfaces the rule that defines it above the wagon that has
  // some. Without this, bm25's length normalisation puts the short stat
  // block first.
  const phrase = `"${terms.map((t) => t.replace(/"/g, '')).join(' ')}"`;
  return `(${phrase}) OR (${all})`;
}

/** How many hits we'll return. Ranked, so this is "the best N", not "the first N". */
const HIT_LIMIT = 40;

// Reading a book uses a ticket (see tickets.ts): an iframe sends no
// headers, and fetching the file into a blob first would throw away the
// ranged reads that make opening page 184 instant.

export async function bookRoutes(
  request: Request,
  env: Env,
  url: URL,
  dm: boolean,
): Promise<Response | null> {
  const { pathname } = url;
  const method = request.method;
  const json = (data: unknown, status = 200) => Response.json(data, { status });
  const err = (message: string, status: number) => json({ error: message }, status);

  // Search first: it's the point of the whole feature, and a bare
  // /api/books/:id match would otherwise swallow it.
  if (pathname === '/api/books/search' && method === 'GET') {
    if (!dm) return err('DM key required', 401);
    const q = (url.searchParams.get('q') ?? '').trim();
    const system = url.searchParams.get('system');
    const match = q.length < 2 ? null : ftsQuery(q);
    if (!match) return json({ hits: [], total: 0 });

    const from = `FROM book_fts
        JOIN book_pages p ON p.rowid = book_fts.rowid
        JOIN books b ON b.id = p.book_id
       WHERE book_fts MATCH ?1 ${system ? 'AND b.system = ?2' : ''}`;
    const binds = system ? [match, system] : [match];

    // char(2)/char(3) fence the matched words inside the snippet so the
    // console can highlight them. Control characters, deliberately: they
    // can't collide with anything a PDF's text layer contains, and if one
    // ever escaped to the DOM it would render as nothing.
    const rows = await env.DB.prepare(
      `SELECT p.book_id, p.page, b.name,
              snippet(book_fts, 0, char(2), char(3), '…', 18) AS snip
         ${from}
       ORDER BY bm25(book_fts)
       LIMIT ${HIT_LIMIT}`,
    )
      .bind(...binds)
      .all();

    // Ranking makes the cap honest, but only if you can see you hit it.
    const counted = await env.DB.prepare(`SELECT COUNT(*) AS n ${from}`)
      .bind(...binds)
      .first<{ n: number }>();

    const hits: BookHit[] = rows.results.map((r) => {
      const row = r as { book_id: string; page: number; name: string; snip: string };
      return {
        bookId: row.book_id,
        bookName: row.name,
        page: row.page,
        snippet: row.snip,
      };
    });
    return json({ hits, total: counted?.n ?? hits.length });
  }

  if (pathname === '/api/books' && method === 'GET') {
    if (!dm) return err('DM key required', 401);
    const system = url.searchParams.get('system');
    const rows = system
      ? await env.DB.prepare(
          'SELECT * FROM books WHERE system = ? ORDER BY created_at DESC',
        )
          .bind(system)
          .all()
      : await env.DB.prepare('SELECT * FROM books ORDER BY created_at DESC').all();
    return json(rows.results.map((r) => toBook(r as never)));
  }

  // Add a book: the file itself, uploaded.
  //
  // The host names it, not the client. A book's id is the sha-256 of its
  // own bytes, so two people who own the same rulebook derive the same
  // id without coordinating — which is what lets a `.tell` file say
  // "this campaign needs bok_a23d…" and have it resolve on any host that
  // has the book. A browser couldn't do this anyway: crypto.subtle
  // doesn't exist on the plain-HTTP origin a table's host serves from.
  if (pathname === '/api/books' && method === 'POST') {
    if (!dm) return err('DM key required', 401);
    const name = (url.searchParams.get('name') ?? '').trim() || 'Untitled';
    const system = (url.searchParams.get('system') ?? '').trim();

    // Buffered to be hashed: there is no streaming digest in WebCrypto.
    // A rulebook is large but finite, and this is the one moment it's
    // held whole rather than streamed.
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return err('no file', 400);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const id = `bok_${[...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12)}`;

    const existing = await env.DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(id)
      .first();
    if (existing) {
      // Same bytes, so the same book. Nothing to store and nothing to
      // argue about — say so rather than making a second row.
      return json({ book: toBook(existing as never), duplicate: true });
    }

    const key = `books/${id}.pdf`;
    await env.MAPS.put(key, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
    await env.DB.prepare(
      'INSERT INTO books (id, system, name, key, pages, indexed) VALUES (?, ?, ?, ?, 0, 0)',
    )
      .bind(id, system, name, key)
      .run();
    const row = await env.DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(id)
      .first();
    // Reading it is the host's job and happens in the background; the
    // book is openable immediately, searchable shortly.
    return json({ book: toBook(row as never), duplicate: false }, 201);
  }

  // Ask for permission to read one book, so the viewer can be a plain
  // iframe with a URL in it.
  let m = pathname.match(/^\/api\/books\/([^/]+)\/ticket$/);
  if (m && method === 'POST') {
    if (!dm) return err('DM key required', 401);
    // No secret means nothing can be signed, and an unsigned ticket would
    // be a URL that lets anyone read the book. Refuse rather than weaken.
    if (!env.DM_KEY) return err('this instance has no key set', 500);
    return json({ url: `/api/books/${m[1]}/file?t=${await mintTicket(env.DM_KEY, m[1], BOOK_MINUTES)}` });
  }

  m = pathname.match(/^\/api\/books\/([^/]+)\/file$/);
  if (m && (method === 'GET' || method === 'HEAD')) {
    const ticketed = await checkTicket(env.DM_KEY, m[1], url.searchParams.get('t'));
    if (!dm && !ticketed) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('book not found', 404);
    const book = row as unknown as BookRow;
    if (!book.key) return err('this host does not have that book', 404);

    // Range support is the difference between opening a book at page 184
    // and downloading a rulebook to read one paragraph. The browser's own
    // PDF viewer asks for exactly the bytes it needs.
    const head = await env.MAPS.get(book.key);
    if (!head) return err('file missing', 404);
    const size = head.size;
    const asked = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');

    if (asked) {
      const start = asked[1] ? Number(asked[1]) : 0;
      const end = asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
      if (start >= size || end < start) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${size}` },
        });
      }
      const part = await env.MAPS.get(book.key, {
        range: { offset: start, length: end - start + 1 },
      });
      return new Response(part?.body ?? null, {
        status: 206,
        headers: {
          'content-type': 'application/pdf',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': String(end - start + 1),
          'cache-control': 'private, max-age=3600',
        },
      });
    }

    return new Response(head.body, {
      headers: {
        'content-type': 'application/pdf',
        'accept-ranges': 'bytes',
        'content-length': String(size),
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  m = pathname.match(/^\/api\/books\/([^/]+)$/);
  if (m && method === 'DELETE') {
    if (!dm) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(m[1])
      .first();
    if (row) {
      const key = (row as unknown as BookRow).key;
      if (key) await env.MAPS.delete(key);
      await env.DB.prepare('DELETE FROM book_pages WHERE book_id = ?')
        .bind(m[1])
        .run();
      await env.DB.prepare('DELETE FROM books WHERE id = ?').bind(m[1]).run();
    }
    return json({ ok: true });
  }

  return null;
}

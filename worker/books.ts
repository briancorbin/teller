import type { Env } from './db';
import type { Book, BookHit } from './types';

// Rulebooks. The DM's own PDFs, in the DM's own instance — content, like
// packs, and it never ships (rule 4).
//
// Extraction happens in the browser at upload time and arrives here as
// plain page text. Search is FTS5 over those pages (migration 0006): whole
// words, stemmed, ranked by bm25. Mid-session you get one question and one
// glance, so the right page has to be the first one.

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

const newId = () =>
  `bok_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

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

  // Register a book. The FILE is not sent — it stays in the DM's browser
  // (OPFS) and only its derived page text is uploaded, below. So this is
  // a row and an id, not an upload.
  if (pathname === '/api/books' && method === 'POST') {
    if (!dm) return err('DM key required', 401);
    const body = await request.json<{ system?: string; name?: string }>();
    const system = (body.system ?? '').trim();
    const name = (body.name ?? '').trim() || 'Untitled';
    if (!system) return err('system required', 400);
    const id = newId();
    await env.DB.prepare(
      'INSERT INTO books (id, system, name) VALUES (?, ?, ?)',
    )
      .bind(id, system, name)
      .run();
    const row = await env.DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(id)
      .first();
    return json({ book: toBook(row as never) }, 201);
  }

  let m = pathname.match(/^\/api\/books\/([^/]+)\/pages$/);
  if (m && method === 'POST') {
    if (!dm) return err('DM key required', 401);
    const bookId = m[1];
    const body = await request.json<{
      pages?: { page: number; text: string }[];
      done?: boolean;
    }>();
    const pages = (body.pages ?? []).filter((p) => p.text.trim());
    if (pages.length) {
      // Batched: a rulebook is hundreds of pages and one statement each
      // would be hundreds of round trips.
      //
      // Upsert rather than INSERT OR REPLACE: REPLACE resolves a conflict
      // by deleting the row without firing the delete trigger, which would
      // strand the old text in the search index. DO UPDATE is a real
      // update, so the index follows.
      await env.DB.batch(
        pages.map((p) =>
          env.DB.prepare(
            `INSERT INTO book_pages (book_id, page, text) VALUES (?, ?, ?)
             ON CONFLICT (book_id, page) DO UPDATE SET text = excluded.text`,
          ).bind(bookId, p.page, p.text),
        ),
      );
    }
    if (body.done) {
      const count = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM book_pages WHERE book_id = ?',
      )
        .bind(bookId)
        .first<{ n: number }>();
      await env.DB.prepare('UPDATE books SET indexed = 1, pages = ? WHERE id = ?')
        .bind(count?.n ?? 0, bookId)
        .run();
    }
    return json({ ok: true });
  }

  // Only reachable for books that were deliberately put in R2. A local
  // book has no file here by design — the reader already has it.
  m = pathname.match(/^\/api\/books\/([^/]+)\/file$/);
  if (m && method === 'GET') {
    if (!dm) return err('DM key required', 401);
    const row = await env.DB.prepare('SELECT * FROM books WHERE id = ?')
      .bind(m[1])
      .first();
    if (!row) return err('book not found', 404);
    const book = row as unknown as BookRow;
    if (!book.key) return err('this book lives on the DM\'s device', 404);
    const object = await env.MAPS.get(book.key);
    if (!object) return err('file missing', 404);
    return new Response(object.body, {
      headers: {
        'content-type': 'application/pdf',
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

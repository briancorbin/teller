import type { Env } from './db';
import type { Book, BookHit } from './types';

// Rulebooks. The DM's own PDFs, in the DM's own instance — content, like
// packs, and it never ships (rule 4).
//
// Extraction happens in the browser at upload time and arrives here as
// plain page text. Search is a LIKE over those pages: unglamorous, but a
// home instance holds a handful of books, and it means no FTS migration
// and no ranking to explain.

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

/** A window of text around the match, so a hit reads like a sentence. */
function snippet(text: string, needle: string, span = 90): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text.slice(0, span * 2).trim();
  const start = Math.max(0, at - span);
  const end = Math.min(text.length, at + needle.length + span);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${
    end < text.length ? '…' : ''
  }`;
}

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
    if (q.length < 2) return json({ hits: [] });
    const rows = await env.DB.prepare(
      `SELECT p.book_id, p.page, p.text, b.name
         FROM book_pages p JOIN books b ON b.id = p.book_id
        WHERE p.text LIKE ? ${system ? 'AND b.system = ?' : ''}
        ORDER BY b.name, p.page
        LIMIT 60`,
    )
      .bind(...[`%${q}%`, ...(system ? [system] : [])])
      .all();
    const hits: BookHit[] = rows.results.map((r) => {
      const row = r as { book_id: string; page: number; text: string; name: string };
      return {
        bookId: row.book_id,
        bookName: row.name,
        page: row.page,
        snippet: snippet(row.text, q),
      };
    });
    return json({ hits });
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
      await env.DB.batch(
        pages.map((p) =>
          env.DB.prepare(
            'INSERT OR REPLACE INTO book_pages (book_id, page, text) VALUES (?, ?, ?)',
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

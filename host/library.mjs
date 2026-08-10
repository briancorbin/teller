// The book library — every rulebook you own, in one folder, forever.
//
//   ~/.teller/books/bok_a23d630c48f7.pdf
//
// It is deliberately NOT scoped to a campaign or a system. You own the
// books; campaigns refer to them. That's why a `.story` file carries a
// reference and not a rulebook: bundles stay small and shareable, the
// same PDF is never stored twice, and nothing teller passes around ever
// contains someone's rules text.
//
// A book is named by the sha-256 of its own bytes. Two people who own
// the same rulebook derive the same id without coordinating, so a
// campaign that says "this needs bok_a23d..." resolves on any host that
// has it — with no registry, no ids handed out by anyone, and no way for
// a reference to mean two different books.
//
// This is also where the loader went. It was a program that read local
// files and served them over loopback, because a page on teller.ink
// couldn't reach a disk. The host reads the disk directly, so the whole
// bridge collapsed into "scan a folder".

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const booksDir = (data) => join(data, 'books');

const log = (msg) => console.log(`  ${msg}`);

/** A book's id is what's inside it. */
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `bok_${hash.digest('hex').slice(0, 12)}`;
}

/**
 * Take a freshly-uploaded file and give it its real name.
 *
 * The upload lands under a temporary name because nobody knows what a
 * book is called until it has been read. If that book is already here,
 * the duplicate is dropped rather than stored twice — the id says they
 * are the same bytes, and there is no argument to have about it.
 */
export async function adopt(data, tempPath, name) {
  const dir = booksDir(data);
  await mkdir(dir, { recursive: true });
  const id = await hashFile(tempPath);
  const final = join(dir, `${id}.pdf`);
  const already = await stat(final).catch(() => null);
  if (already) await unlink(tempPath);
  else await rename(tempPath, final);
  return { id, path: final, name, duplicate: Boolean(already) };
}

/**
 * Read a PDF's text, a page at a time.
 *
 * On the host rather than in a browser, which is the whole point: it
 * happens once for the table instead of once per screen, a phone never
 * parses a 300-page rulebook, and a panel with no storage of its own
 * still gets to search.
 */
async function extract(path, onProgress) {
  // An installed copy has pdfjs vendored beside it (no node_modules, by
  // design); the repo resolves it normally. Try the vendored one first
  // so an install never depends on what happens to be near it.
  const vendored = new URL('../vendor/pdfjs/pdf.mjs', import.meta.url);
  const pdfjs = await import(vendored.href).catch(() =>
    import('pdfjs-dist/legacy/build/pdf.mjs'),
  );
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(path)),
    useSystemFonts: false,
  }).promise;
  const pages = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push({ page, text });
    if (page % 50 === 0) onProgress?.(page, doc.numPages);
  }
  return { pages, total: doc.numPages };
}

/** Write a book's text into the search index, replacing whatever was there. */
function storeIndex(db, id, pages) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM book_pages WHERE book_id = ?').run(id);
    const insert = db.prepare(
      'INSERT INTO book_pages (book_id, page, text) VALUES (?, ?, ?)',
    );
    for (const page of pages) insert.run(id, page.page, page.text);
    db.prepare('UPDATE books SET indexed = 1, pages = ? WHERE id = ?').run(
      pages.length,
      id,
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Reconcile the folder with the database, then read anything unread.
 *
 * Two directions, both wanted. A PDF dropped into the folder by hand
 * becomes a book — that's the loader's trick, kept. And a book whose row
 * exists but whose file has gone shows up as missing rather than as a
 * search result that opens nothing.
 */
export async function sweep(db, data, { quiet = false } = {}) {
  const dir = booksDir(data);
  await mkdir(dir, { recursive: true });
  const say = quiet ? () => {} : log;

  const files = (await readdir(dir).catch(() => [])).filter((f) =>
    f.toLowerCase().endsWith('.pdf'),
  );
  const onDisk = new Map();
  for (const file of files) {
    const id = file.replace(/\.pdf$/i, '');
    // A hand-dropped file isn't named after its hash yet.
    if (/^bok_[a-f0-9]{12}$/.test(id)) {
      onDisk.set(id, join(dir, file));
      continue;
    }
    const path = join(dir, file);
    const real = await hashFile(path);
    const renamed = join(dir, `${real}.pdf`);
    if (await stat(renamed).catch(() => null)) {
      await unlink(path);
      say(`${file} is a copy of one you already had`);
    } else {
      await rename(path, renamed);
      db.prepare(
        `INSERT INTO books (id, name, key, pages, indexed)
         VALUES (?, ?, ?, 0, 0)
         ON CONFLICT (id) DO NOTHING`,
      ).run(real, file.replace(/\.pdf$/i, ''), `books/${real}.pdf`);
      say(`found ${file}`);
    }
    onDisk.set(real, renamed);
  }

  // Rows whose file has gone. Left in place — the campaign still refers
  // to the book, and saying "you don't have this" is more use than
  // silently forgetting it existed.
  const rows = db.prepare('SELECT id, name, indexed FROM books').all();
  const missing = rows.filter((r) => !onDisk.has(r.id));
  if (missing.length && !quiet) {
    say(`${missing.length} book(s) referenced but not here: ${missing.map((m) => m.name).join(', ')}`);
  }

  for (const row of rows) {
    const path = onDisk.get(row.id);
    if (!path || row.indexed) continue;
    say(`reading ${row.name}…`);
    try {
      const { pages, total } = await extract(path);
      storeIndex(db, row.id, pages);
      say(
        pages.length
          ? `read ${row.name}: ${pages.length}/${total} pages with text`
          : `${row.name} has no text layer — a scan, so search can't reach inside it`,
      );
    } catch (e) {
      say(`could not read ${row.name}: ${e.message}`);
    }
  }

  return { onDisk: onDisk.size, missing: missing.length };
}

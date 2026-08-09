#!/usr/bin/env node
//
// teller loader — hands local files to a teller screen.
//
// A browser can't read a memory card, and an HTTPS page can't reach a
// machine across the LAN either: it's only allowed to talk to plain HTTP
// when the other end is loopback, which the browser trusts because nothing
// outside the machine can answer there. So this is the shape the web
// leaves us — a small program on the SAME machine, listening on 127.0.0.1,
// serving whatever books it can find to the teller screen in front of you.
//
// That constraint is also the promise. The loader binds loopback and
// nothing else, so these files are readable by this machine and by no one
// on the network — which is the same promise books already make (rule 4: a
// rulebook is never something teller distributes).
//
// A LIBRARY is any directory of books. That covers the evocative case — a
// card you carry to someone else's table, plug into their panel, and your
// books are there — and the ordinary one, which is a folder on your laptop.
// The loader doesn't care which; removable media just gets found on its own.
//
//   node loader/teller-loader.mjs                 # ~/teller + any card
//   node loader/teller-loader.mjs ~/rpg/books     # or point it anywhere
//
// What travels is IDENTITY and CONTENT — your books, and later your
// character. Never live session state: the session belongs to the campaign,
// is authoritative on the server, and a drive that thought otherwise would
// invent a sync problem to solve.
//
// Zero dependencies beyond the pdfjs already in this repo, and that only
// when a book needs reading. A Pi needs node and this file.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { homedir, platform } from 'node:os';

const PORT = Number(process.env.TELLER_LOADER_PORT ?? 4526);

const MARKER = 'teller'; // what makes a volume a card
const BOOKS = 'books';
const INDEX = '.index';

const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;

const hash = (s) => createHash('sha256').update(s).digest('hex');
const log = (msg) => console.log(`[loader] ${msg}`);

async function isDir(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- discovery

/**
 * Where to look, and how hard.
 *
 * Two different postures, deliberately. A path you TYPED is taken at its
 * word — a folder of PDFs is a library, no setup, no marker. A volume that
 * merely appeared is not: it needs a teller/ directory before we'll read
 * it, because "plugged in a USB stick" must never mean "teller went
 * rummaging through it".
 */
async function sources() {
  const named = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const trusted = named.length ? named.map((p) => resolve(p)) : [join(homedir(), MARKER)];

  const mounts =
    platform() === 'darwin'
      ? ['/Volumes']
      : [join('/media', basename(homedir())), '/media', '/mnt'];

  const found = [];
  for (const path of trusted) if (await isDir(path)) found.push({ path, marked: false });
  for (const mount of mounts) {
    const names = await readdir(mount).catch(() => []);
    for (const name of names) {
      const path = join(mount, name);
      if (await isDir(join(path, MARKER))) found.push({ path, marked: true });
    }
  }
  return found.filter((s, i) => found.findIndex((o) => o.path === s.path) === i);
}

/**
 * Resolve a source directory to the place its books actually are.
 *
 * `teller/books/` if it's laid out that way, `books/` if you skipped the
 * marker, otherwise the directory itself — so "a folder with PDFs in it"
 * is a valid library and nobody has to be taught a layout.
 */
async function bookRoot(path) {
  const marked = (await isDir(join(path, MARKER))) ? join(path, MARKER) : path;
  return (await isDir(join(marked, BOOKS))) ? join(marked, BOOKS) : marked;
}

async function readMeta(path) {
  for (const file of [join(path, MARKER, 'card.json'), join(path, 'card.json')]) {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      // Optional. A folder of PDFs is still a library; it just gets named
      // after itself.
    }
  }
  return {};
}

/**
 * Book ids are the hash of the book's own bytes.
 *
 * So the same drive in a different panel names the same book, and two
 * people who own the same rulebook agree about it without coordinating.
 * An id handed out by a server could do neither.
 */
async function bookId(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return `bok_${h.digest('hex').slice(0, 12)}`;
}

// Hashing is fast but not free and the scan is on a timer; size+mtime is
// enough to notice a file genuinely changed.
const idCache = new Map();

async function scanBooks(lib) {
  const names = await readdir(lib.root).catch(() => []);
  const books = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.pdf')) continue;
    const file = join(lib.root, name);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;

    const stamp = `${file}:${info.size}:${info.mtimeMs}`;
    let id = idCache.get(stamp);
    if (!id) idCache.set(stamp, (id = await bookId(file)));

    const index = await readIndex(lib, id);
    books.push({
      id,
      name: name.replace(/\.pdf$/i, ''),
      system: lib.system,
      bytes: info.size,
      file,
      pages: index?.pages?.length ?? 0,
      indexed: Boolean(index),
    });
  }
  return books;
}

/**
 * Where an index may live, best first.
 *
 * Beside the books, so it travels with them and any panel benefits. But a
 * card can be write-protected, and a book you can't index is a book you
 * can't search — too high a price — so there's a fallback under home.
 */
function indexDirs(lib) {
  return [join(lib.root, INDEX), join(homedir(), '.teller', 'index', lib.id)];
}

async function readIndex(lib, id) {
  for (const dir of indexDirs(lib)) {
    try {
      return JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'));
    } catch {
      // Try the next place it could be.
    }
  }
  return null;
}

async function writeIndex(lib, id, index) {
  for (const dir of indexDirs(lib)) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.json`), JSON.stringify(index));
      return dir;
    } catch {
      // Read-only, most likely. Fall through to home.
    }
  }
  return null;
}

// -------------------------------------------------------------- indexing

/**
 * Pull the text out of a PDF so search has something to search.
 *
 * The console does this too, in the browser, for books it imports. Doing
 * it here as well is deliberate duplication rather than shared code: the
 * point of a library is that you drop a PDF in it and it's ready — no
 * import step, no console involved, and it works on a headless panel.
 */
async function indexBook(lib, book, onProgress) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(book.file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  const pages = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pages.push({ page, text });
    if (page % 25 === 0) onProgress?.(page, doc.numPages);
  }
  const index = { id: book.id, name: book.name, total: doc.numPages, pages };
  const where = await writeIndex(lib, book.id, index);
  return { index, where, total: doc.numPages };
}

// A book is read once, in the background, and says so while it happens —
// 400 pages is half a minute and silence would read as broken.
const indexing = new Map();

function startIndexing(lib, book) {
  if (indexing.has(book.id)) return;
  indexing.set(book.id, { done: 0, total: 0 });
  log(`reading ${book.name}…`);
  indexBook(lib, book, (done, total) => indexing.set(book.id, { done, total }))
    .then(({ index, where, total }) => {
      indexing.delete(book.id);
      log(
        `read ${book.name}: ${index.pages.length}/${total} pages with text` +
          (where ? ` → ${where}` : ' (nowhere to save the index)'),
      );
      if (!index.pages.length) {
        log(`  ${book.name} has no text layer — it's a scan, so search can't help there`);
      }
    })
    .catch((e) => {
      indexing.delete(book.id);
      log(`could not read ${book.name}: ${e.message}`);
    });
}

// ----------------------------------------------------------------- state

let libraries = [];

async function rescan() {
  const next = [];
  for (const src of await sources()) {
    const meta = await readMeta(src.path);
    const lib = {
      id: hash(src.path).slice(0, 12),
      path: src.path,
      root: await bookRoot(src.path),
      name: typeof meta.name === 'string' ? meta.name : basename(src.path),
      system: typeof meta.system === 'string' ? meta.system : null,
      removable: src.marked,
    };
    lib.books = await scanBooks(lib);
    next.push(lib);
    for (const book of lib.books) if (!book.indexed) startIndexing(lib, book);
  }

  const was = libraries.map((l) => `${l.id}:${l.books.length}`).join();
  libraries = next;
  if (was !== next.map((l) => `${l.id}:${l.books.length}`).join()) {
    if (!next.length) log('nothing to serve — no ~/teller, no card, no path given');
    for (const l of next) log(`${l.name}: ${l.books.length} book(s) — ${l.root}`);
  }
}

const find = (libId, bookId) => {
  const lib = libraries.find((l) => l.id === libId);
  const book = lib?.books.find((b) => b.id === bookId);
  return book ? { lib, book } : null;
};

// ---------------------------------------------------------------- server

/**
 * Who may ask.
 *
 * Loopback already means only this machine can reach us, so this isn't the
 * security boundary — it's about not answering pages that have no business
 * knowing what's on your shelf.
 */
function allowOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://teller.ink') return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function serveFile(req, res, file, size, type) {
  // Range support is what lets the browser's own PDF viewer page through a
  // 200MB rulebook instead of swallowing it whole.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes' };
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) {
      return res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': end - start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const origin = allowOrigin(req.headers.origin);
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-headers', 'range');
  res.setHeader('access-control-expose-headers', 'content-range, accept-ranges');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (data, status = 200) =>
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));

  if (url.pathname === '/manifest') {
    return json({
      loader: 'teller',
      version: 1,
      libraries: libraries.map((lib) => ({
        id: lib.id,
        name: lib.name,
        system: lib.system,
        removable: lib.removable,
        books: lib.books.map((b) => ({
          id: b.id,
          name: b.name,
          system: b.system,
          pages: b.pages,
          bytes: b.bytes,
          indexed: b.indexed,
          indexing: indexing.get(b.id) ?? null,
        })),
      })),
    });
  }

  // /books/:libId/:bookId.pdf   — the book itself, ranged
  // /books/:libId/:bookId/index — the page text, for search
  const m = /^\/books\/([^/]+)\/([^/]+?)(\.pdf|\/index)$/.exec(url.pathname);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const [, libId, id, what] = m;
    // Ids are hashes we minted; anything else is someone fishing for
    // ../../etc/passwd and gets nothing.
    if (!ID_OK.test(libId) || !ID_OK.test(id)) return json({ error: 'not found' }, 404);
    const hit = find(libId, id);
    if (!hit) return json({ error: 'not found' }, 404);

    if (what === '/index') {
      const index = await readIndex(hit.lib, id);
      return index
        ? json(index)
        : json({ error: 'still reading that one', indexing: indexing.get(id) ?? null }, 409);
    }
    // Belt and braces: the resolved file must still be inside its library.
    if (!resolve(hit.book.file).startsWith(resolve(hit.lib.root) + sep)) {
      return json({ error: 'not found' }, 404);
    }
    return serveFile(req, res, hit.book.file, hit.book.bytes, 'application/pdf');
  }

  json({ error: 'not found' }, 404);
});

server.on('error', (e) => {
  log(
    e.code === 'EADDRINUSE'
      ? `port ${PORT} is busy — another loader is probably already running`
      : String(e),
  );
  process.exit(1);
});

// 127.0.0.1 explicitly, never 0.0.0.0: these files are for the machine
// they're plugged into. Binding wider would put a rulebook on the network.
server.listen(PORT, '127.0.0.1', async () => {
  log(`listening on http://127.0.0.1:${PORT}`);
  await rescan();
  // Polling rather than watching: mount points appear and vanish in ways
  // fs.watch doesn't report consistently across macOS and Linux, and three
  // seconds to notice a drive is not a wait anyone minds.
  setInterval(() => void rescan().catch((e) => log(String(e))), 3000);
});

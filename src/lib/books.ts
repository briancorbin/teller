// Rulebooks that never leave the machine reading them.
//
// The PDF is copied into this browser's own private storage (OPFS) and
// stays there. What travels to the books table is the derived index —
// page text — so search can say "Grit, page 42" and open the book at
// that page. A server therefore never holds a commercial rulebook, which
// makes the whole hosting question moot rather than argued.
//
// The consequence, deliberately accepted: a book is readable on the
// screen that imported it, not on the table or a player's seat. Looking
// rules up is the DM's job; the table is the ground.

const DIR = 'books';

/**
 * Split a search snippet into plain and matched runs.
 *
 * The server fences matched words in \x02…\x03 (see `BookHit`), so this is
 * a split rather than a re-search: the highlight lands on what FTS5
 * actually matched, stem and all — "grappled" lights up for "grapple",
 * which searching the string for the typed term could never do.
 */
export function splitSnippet(snippet: string): { text: string; hit: boolean }[] {
  return snippet
    .split(/\x02([^\x03]*)\x03/)
    .map((text, i) => ({ text, hit: i % 2 === 1 }))
    .filter((run) => run.text);
}

async function booksDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

export async function saveLocalBook(id: string, file: File): Promise<void> {
  const dir = await booksDir();
  const handle = await dir.getFileHandle(`${id}.pdf`, { create: true });
  const writable = await handle.createWritable();
  await file.stream().pipeTo(writable);
}

export async function getLocalBook(id: string): Promise<File | null> {
  try {
    const dir = await booksDir();
    const handle = await dir.getFileHandle(`${id}.pdf`);
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deleteLocalBook(id: string): Promise<void> {
  try {
    const dir = await booksDir();
    await dir.removeEntry(`${id}.pdf`);
  } catch {
    // Already gone, which is the state we wanted.
  }
}

/** Which books this particular device actually holds. */
export async function localBookIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const dir = await booksDir();
    // Directory async-iteration isn't in lib.dom's typings yet.
    const entries = (dir as unknown as {
      entries: () => AsyncIterable<[string, unknown]>;
    }).entries();
    for await (const [name] of entries) {
      if (typeof name === 'string' && name.endsWith('.pdf')) {
        ids.add(name.replace(/\.pdf$/, ''));
      }
    }
  } catch {
    // No directory yet: this device holds nothing.
  }
  return ids;
}

/**
 * Pull the text out of a PDF, a page at a time.
 *
 * pdf.js is imported lazily so a megabyte of parser never reaches the
 * table or a seat panel — only the console that's actually importing a
 * book pays for it. Pages are handed back in batches so a 400-page
 * rulebook reports progress instead of appearing to hang.
 */
export async function extractPages(
  file: File,
  onBatch: (pages: { page: number; text: string }[], done: number, total: number) => Promise<void>,
  batchSize = 25,
): Promise<{ pages: number; withText: number }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = doc.numPages;
  let batch: { page: number; text: string }[] = [];
  let withText = 0;

  for (let page = 1; page <= total; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) withText++;
    batch.push({ page, text });
    if (batch.length >= batchSize) {
      await onBatch(batch, page, total);
      batch = [];
    }
  }
  if (batch.length) await onBatch(batch, total, total);
  return { pages: total, withText };
}

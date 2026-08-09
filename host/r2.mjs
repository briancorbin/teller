// R2, but it's a folder.
//
// Maps, handouts and scene art. The worker puts and gets by key; here a
// key is a path under one directory, so the whole object store is
// something you can open in Finder, copy to a stick, or back up by
// dragging. That's a feature of running your own host, not a compromise.

import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * A key is untrusted-ish — it reaches us from request paths — so resolve
 * it and refuse anything that climbs out of the store.
 */
function safeJoin(root, key) {
  const path = resolve(root, key);
  if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) {
    throw new Error(`bad object key: ${key}`);
  }
  return path;
}

export class R2 {
  #root;

  constructor(root) {
    this.#root = root;
  }

  async put(key, body, options = {}) {
    const path = safeJoin(this.#root, key);
    await mkdir(dirname(path), { recursive: true });

    // The worker hands us whatever a Request body is — a web stream, a
    // buffer, or bytes. Normalise rather than making callers care.
    if (body && typeof body.getReader === 'function') {
      const chunks = [];
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      await writeFile(path, Buffer.concat(chunks));
    } else if (body instanceof ArrayBuffer) {
      await writeFile(path, Buffer.from(body));
    } else {
      await writeFile(path, Buffer.from(body ?? ''));
    }

    // Content type travels beside the object. R2 keeps it as metadata;
    // a filesystem has nowhere to put it, and guessing from the
    // extension would be wrong for keys that don't carry one.
    const contentType = options?.httpMetadata?.contentType;
    if (contentType) await writeFile(`${path}.type`, contentType, 'utf8');
    return { key };
  }

  /**
   * `options.range` mirrors R2's own `{ offset, length }`.
   *
   * This is what lets a screen open a 200MB rulebook at page 184 without
   * pulling the other 199 megabytes. Cloudflare's R2 does ranged reads
   * natively; here it's an offset on a read stream.
   */
  async get(key, options = {}) {
    const path = safeJoin(this.#root, key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    const contentType = await readFile(`${path}.type`, 'utf8').catch(() => null);

    const range = options.range;
    const start = range ? (range.offset ?? 0) : 0;
    const end = range
      ? Math.min(info.size - 1, start + (range.length ?? info.size - start) - 1)
      : info.size - 1;

    return {
      key,
      size: info.size,
      range: range ? { offset: start, length: end - start + 1 } : undefined,
      httpMetadata: contentType ? { contentType } : {},
      // A web stream, because the worker passes this straight to a
      // Response — so a 100MB map is streamed, not buffered.
      body: Readable.toWeb(createReadStream(path, { start, end })),
      arrayBuffer: async () => (await readFile(path)).buffer,
    };
  }

  async delete(key) {
    const path = safeJoin(this.#root, key);
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
  }

  /** Where a caller can find the file itself — used by export. */
  pathFor(key) {
    return safeJoin(this.#root, key);
  }

  get root() {
    return this.#root;
  }
}

/**
 * Objects live in the data directory itself, not a subfolder of it.
 *
 * So keys become the folders you'd expect — `books/bok_a23d….pdf` is
 * literally `~/.teller/books/bok_a23d….pdf`, and `map/…` sits beside it.
 * That matters because the book library is meant to be a place you can
 * open in Finder and drop a PDF into; burying it under `assets/` would
 * make the folder an implementation detail instead of the feature.
 */
export const objectRoot = (dataDir) => dataDir;

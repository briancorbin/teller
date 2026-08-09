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

  async get(key) {
    const path = safeJoin(this.#root, key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return null;
    const contentType = await readFile(`${path}.type`, 'utf8').catch(() => null);
    return {
      key,
      size: info.size,
      httpMetadata: contentType ? { contentType } : {},
      // A web stream, because the worker passes this straight to a
      // Response — so a 100MB map is streamed, not buffered.
      body: Readable.toWeb(createReadStream(path)),
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

export const objectRoot = (dataDir) => join(dataDir, 'assets');

// The `ASSETS` binding: the built SPA, served off disk.
//
// One line of the worker uses this (`env.ASSETS.fetch`), and it has to
// behave the way Cloudflare's asset handler does — including the part
// that matters most, `not_found_handling: single-page-application`. A
// screen deep-linked to a route must get index.html, not a 404.

import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { extname, join, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
};

export class Assets {
  #root;

  constructor(root) {
    this.#root = root;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const file = await this.#resolve(decodeURIComponent(pathname));
    if (!file) return new Response('not found', { status: 404 });

    const type = TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream';
    // Hashed asset filenames are immutable; index.html must never be,
    // or a panel keeps booting last week's app after an update.
    const immutable = file.path.includes(`${sep}assets${sep}`);
    return new Response(Readable.toWeb(createReadStream(file.path)), {
      headers: {
        'content-type': type,
        'content-length': String(file.size),
        'cache-control': immutable
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      },
    });
  }

  async #resolve(pathname) {
    const direct = resolve(this.#root, `.${pathname}`);
    if (direct === resolve(this.#root) || direct.startsWith(resolve(this.#root) + sep)) {
      const info = await stat(direct).catch(() => null);
      if (info?.isFile()) return { path: direct, size: info.size };
    }
    // Single-page-application fallback: every unknown path is a route.
    const index = join(this.#root, 'index.html');
    const info = await stat(index).catch(() => null);
    return info?.isFile() ? { path: index, size: info.size } : null;
  }

  async indexHtml() {
    return readFile(join(this.#root, 'index.html'), 'utf8').catch(() => null);
  }
}

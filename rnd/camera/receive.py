#!/usr/bin/env python3
"""Catch captures from the Eye app (rnd/eye) — the other half of its
Uploader contract:

    POST /capture   body = JPEG              header X-Ts
    POST /depth     body = float32 metres    headers X-Ts, X-Width, X-Height

Files land in captures/, named by the phone's timestamp so an image and
its depth map pair up. Depth gets a .json sidecar with its dimensions;
read it back with numpy:

    meta = json.load(open('captures/<ts>.depth.json'))
    depth = np.fromfile('captures/<ts>.depth.f32', np.float32).reshape(
        meta['height'], meta['width'])

Run: `./.venv/bin/python receive.py [port]` (default 8124). Stdlib only.
"""

import json
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OUT = Path(__file__).parent / 'captures'
OUT.mkdir(exist_ok=True)


def safe_ts(raw: str | None) -> str:
    ts = raw or datetime.now().isoformat(timespec='seconds')
    return ''.join(c if c.isalnum() or c in '-T' else '-' for c in ts)


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        ts = safe_ts(self.headers.get('X-Ts'))

        if self.path == '/capture':
            path = OUT / f'{ts}.jpg'
            path.write_bytes(body)
            print(f'{path.name}  {len(body) // 1024} KB')
        elif self.path == '/depth':
            w = int(self.headers.get('X-Width', 0))
            h = int(self.headers.get('X-Height', 0))
            (OUT / f'{ts}.depth.f32').write_bytes(body)
            (OUT / f'{ts}.depth.json').write_text(
                json.dumps({'width': w, 'height': h, 'dtype': 'float32', 'unit': 'm'})
            )
            print(f'{ts}.depth.f32  {w}x{h}')
        else:
            self.send_error(404)
            return

        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):  # quiet — the per-file prints are the log
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    print(f'listening on 0.0.0.0:{port} → {OUT}/')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()

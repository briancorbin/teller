#!/usr/bin/env python3
"""The live loop: Eye posts frames, this rectifies + detects + shows.

    ./.venv/bin/python receive.py --screen 1920x1080 [port]

Endpoints (Eye's Uploader contract, plus a face):
    POST /capture    body = JPEG            → solve, rectify, detect
    POST /depth      body = float32 metres  → stored beside its frame
    GET  /           status page, auto-refreshing — open it anywhere
    GET  /latest.png the latest annotated rectified view
    GET  /rebase     current frame becomes the new baseline

The FIRST good frame becomes the baseline ("this is the empty table");
every later frame diffs against it. Move a mini, watch the page. After
you rearrange the world on purpose, hit rebase.

Frames where the markers can't be found (a hand over the table, the
pattern not up yet) are skipped and say so — the last good result
stays on the page. Raw frames still land in captures/ for re-runs.

Prototype posture throughout (rule 1 in miniature): it proposes on a
web page; nothing downstream trusts it yet.
"""

import argparse
import json
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

from calibrate import solve
from subtract import detect

OUT = Path(__file__).parent / 'captures'
OUT.mkdir(exist_ok=True)

SW = SH = 0  # set from --screen in main()

state_lock = threading.Lock()
state = {
    'baseline': None,      # rectified empty-table frame
    'latest_rect': None,   # rectified most-recent frame (for /rebase)
    'latest_png': None,    # annotated view, PNG bytes
    'line': 'waiting for the first frame…',
    'frames': 0,
}

PAGE = """<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>eye — live</title>
<body style="margin:0;background:#111;color:#ccc;font:14px monospace">
<div style="padding:8px 12px">{line}</div>
<img src="/latest.png?{n}" style="width:100%">
<div style="padding:8px 12px"><a href="/rebase" style="color:#7ab">rebase</a>
— current frame becomes the empty table</div>
"""


def safe_ts(raw: str | None) -> str:
    ts = raw or datetime.now().isoformat(timespec='seconds')
    return ''.join(c if c.isalnum() or c in '-T' else '-' for c in ts)


def process(jpeg: bytes, ts: str) -> str:
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return 'undecodable frame'
    try:
        H, err, ids, _ = solve(img, SW, SH)
    except SystemExit as e:  # calibrate's helpers bail via sys.exit
        return f'skipped: {e}'
    rect = cv2.warpPerspective(img, np.linalg.inv(H), (SW, SH))

    with state_lock:
        state['latest_rect'] = rect
        state['frames'] += 1
        if state['baseline'] is None:
            state['baseline'] = rect
            ok, png = cv2.imencode('.png', rect)
            state['latest_png'] = png.tobytes() if ok else None
            state['line'] = (
                f'{ts} · frame 1 · BASELINE SET · {len(ids)} markers · RMS {err:.2f}px'
            )
            return state['line']
        found, annotated, _ = detect(state['baseline'], rect)
        ok, png = cv2.imencode('.png', annotated)
        state['latest_png'] = png.tobytes() if ok else None
        blobs = ' '.join(f'({cx:.0f},{cy:.0f})' for cx, cy, _ in
                         sorted(found)[:8])
        state['line'] = (
            f'{ts} · frame {state["frames"]} · {len(found)} object(s) {blobs}'
            f' · RMS {err:.2f}px'
        )
        return state['line']


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        ts = safe_ts(self.headers.get('X-Ts'))

        if self.path == '/capture':
            (OUT / f'{ts}.jpg').write_bytes(body)
            print(process(body, ts))
        elif self.path == '/depth':
            (OUT / f'{ts}.depth.f32').write_bytes(body)
            (OUT / f'{ts}.depth.json').write_text(json.dumps({
                'width': int(self.headers.get('X-Width', 0)),
                'height': int(self.headers.get('X-Height', 0)),
                'dtype': 'float32', 'unit': 'm',
            }))
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/latest.png'):
            with state_lock:
                png = state['latest_png']
            if not png:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.end_headers()
            self.wfile.write(png)
            return
        if self.path == '/rebase':
            with state_lock:
                if state['latest_rect'] is not None:
                    state['baseline'] = state['latest_rect']
                    state['line'] = 'rebased — current frame is the empty table'
            self.send_response(303)
            self.send_header('Location', '/')
            self.end_headers()
            return
        with state_lock:
            page = PAGE.format(line=state['line'], n=state['frames'])
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(page.encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--screen', required=True, help='pattern viewport, e.g. 1920x1080')
    ap.add_argument('port', nargs='?', type=int, default=8124)
    args = ap.parse_args()
    SW, SH = (int(v) for v in args.screen.lower().split('x'))
    print(f'listening on 0.0.0.0:{args.port} · screen {SW}x{SH} · watch http://localhost:{args.port}/')
    ThreadingHTTPServer(('0.0.0.0', args.port), Handler).serve_forever()

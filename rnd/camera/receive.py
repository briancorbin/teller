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
import base64
import json
import threading
import time
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import cv2
import numpy as np

from calibrate import DICT, layout, solve
from subtract import detect

# Bridge mode (--teller): after each processed frame, POST the overlay
# to teller's /camera endpoint and the REAL table draws the markers and
# rings over the live scene — rnd's own /table page becomes optional.
# The daemon holds the DM key (rule 7: the one secret), read from
# ~/.teller/dm.key by default. Set from main().
TELLER = None       # e.g. 'http://localhost:4525'
TELLER_CAMPAIGN = None
TELLER_KEY = None


def push_to_teller(rings):
    if not TELLER:
        return
    req = urllib.request.Request(
        f'{TELLER}/api/campaigns/{TELLER_CAMPAIGN}/camera',
        data=json.dumps({
            'camera': {'markers': True, 'rings': rings},
        }).encode(),
        headers={
            'Content-Type': 'application/json',
            'x-teller-key': TELLER_KEY or '',
        },
        method='POST',
    )
    try:
        urllib.request.urlopen(req, timeout=2).read()
    except Exception as e:
        print(f'teller push failed: {e}')

OUT = Path(__file__).parent / 'captures'
OUT.mkdir(exist_ok=True)

SW = SH = 0  # set from --screen in main()

# The confirmation rings the /table page draws under believed positions
# (TEL-24's glow, prototyped). The camera sees them, so the detector
# masks the same annuli — with margin, because the camera's view of a
# ring is blurrier than the ink.
RING_R = 34
RING_STROKE = 5
MASK_STROKE = 20

# The bananas fix (TEL-77): a fixed camera re-solved every frame yields
# a homography that jitters sub-pixel, and against dense map art every
# jittered edge diffs — three minis became a screenful of phantoms. So
# the first good solve is PINNED and every frame rectifies through it;
# the per-frame solve only checks the pin still fits the markers. When
# it stops fitting (camera bumped, Eye's crop changed), adopt the fresh
# solve once — a single shift, not a per-frame shimmer.
REPIN_RMS = 3.0


def pin_rms(H: np.ndarray, seen: dict) -> float:
    """How well a (pinned) homography fits THIS frame's markers, in
    screen px — same measure solve() reports for its own fit."""
    expected, _ = layout(SW, SH)
    ids = sorted(set(expected) & set(seen))
    cam = np.vstack([seen[i] for i in ids])
    scr = np.vstack([expected[i] for i in ids])
    back = cv2.perspectiveTransform(
        cam.reshape(-1, 1, 2), np.linalg.inv(H)
    ).reshape(-1, 2)
    return float(np.sqrt(np.mean(np.sum((back - scr) ** 2, axis=1))))


state_lock = threading.Lock()
state = {
    'H': None,             # the pinned screen→camera homography
    'baseline': None,      # rectified empty-table frame
    'latest_rect': None,   # rectified most-recent frame (for /rebase)
    'latest_png': None,    # annotated view, PNG bytes
    'line': 'waiting for the first frame…',
    'frames': 0,
    'rings': [],           # (x, y) the table page is drawing NOW
    'prev_rings': [],      # and the set before it — masked too, so a
                           # ring that just moved doesn't ghost-detect
    # The crop is a PROPOSAL a human confirms, never an auto-apply
    # (rule 1 in miniature): per-frame renegotiation chased its own
    # tail and chopped markers off. 'crop_auto' is what the latest
    # good solve would crop to; 'crop' is what Eye actually gets, and
    # only the status page's lock/clear buttons ever set it.
    'crop': None,          # [fx, fy, fw, fh] of the FULL sensor frame
    'crop_auto': None,     # the solver's current proposal
}

# The phone is a puppet: Eye polls /control and applies whatever this
# says, so the propped rig never needs touching. `rev` bumps on every
# /set so Eye can apply-on-change instead of fighting local toggles;
# `shoot` is a counter — each increment is one requested capture.
control_lock = threading.Lock()
control = {
    'interval': 2.0,
    'auto': False,   # off until the page says go — propping the phone
                     # shouldn't start the shutter on its own
    'lock': None,    # None = leave the camera's lock alone
    'shoot': 0,
    'rev': 0,
}

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>eye — live</title>
<body style="margin:0;background:#111;color:#ccc;font:14px monospace">
<div id="line" style="padding:8px 12px">…</div>
<div style="padding:0 12px 8px">
  eye: <b id="mode">…</b> ·
  auto <a href="#" onclick="return set('auto=on')" style="color:#7ab">on</a>/<a
    href="#" onclick="return set('auto=off')" style="color:#7ab">off</a> ·
  every <a href="#" onclick="return set('interval=0.5')" style="color:#7ab">0.5s</a>
  <a href="#" onclick="return set('interval=1')" style="color:#7ab">1s</a>
  <a href="#" onclick="return set('interval=2')" style="color:#7ab">2s</a>
  <a href="#" onclick="return set('interval=5')" style="color:#7ab">5s</a> ·
  <a href="#" onclick="return set('shoot=1')" style="color:#7ab">capture once</a> ·
  camera <a href="#" onclick="return set('lock=on')" style="color:#7ab">lock</a>/<a
    href="#" onclick="return set('lock=off')" style="color:#7ab">unlock</a> ·
  <a href="#" onclick="return act('/rebase')" style="color:#7ab">rebase</a> ·
  crop <b id="crop">…</b>
  <a href="#" onclick="return set('crop=lock')" style="color:#7ab">lock proposed</a>/<a
    href="#" onclick="return set('crop=clear')" style="color:#7ab">full frame</a>
</div>
<img id="view" style="width:100%">
<script>
  // In-place updates, no page reloads — a full refresh every 2s made
  // the whole screen flicker. The image double-buffers: preload the
  // new frame, swap only once it's ready.
  function set(kv) { fetch('/set?' + kv); return false; }
  function act(path) { fetch(path); return false; }
  let lastFrame = -1;
  async function tick() {
    try {
      const s = await (await fetch('/status.json')).json();
      document.getElementById('line').textContent = s.line;
      document.getElementById('mode').textContent =
        (s.auto ? 'auto' : 'paused') + ' @ ' + s.interval + 's';
      const fmt = (c) => c ? c.map(v => v.toFixed(2)).join(',') : null;
      document.getElementById('crop').textContent =
        (s.crop ? 'LOCKED [' + fmt(s.crop) + ']' : 'full') +
        (s.crop_auto ? ' · proposed [' + fmt(s.crop_auto) + ']' : '');
      if (s.frames !== lastFrame) {
        lastFrame = s.frames;
        const img = new Image();
        img.onload = () => { document.getElementById('view').src = img.src; };
        img.src = '/latest.png?' + s.frames;
      }
    } catch (e) {}
    setTimeout(tick, 1000);
  }
  tick();
</script>
"""


def safe_ts(raw: str | None) -> str:
    ts = raw or datetime.now().isoformat(timespec='seconds')
    return ''.join(c if c.isalnum() or c in '-T' else '-' for c in ts)


def marker_uri(marker_id: int) -> str:
    img = cv2.aruco.generateImageMarker(DICT, marker_id, 400)
    ok, png = cv2.imencode('.png', img)
    return 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode()


def table_page() -> str:
    """What the TV shows: pattern.html's markers (calibration never
    stops working) plus a ring under every believed mini position —
    the confirmation glow, polled from /state.json. Click = fullscreen."""
    uris = [marker_uri(i) for i in range(4)]
    return """<!doctype html>
<meta charset="utf-8"><title>teller table — live</title>
<style>
  html, body { margin:0; height:100%%; background:#000; overflow:hidden; cursor:none; }
  .marker { position:absolute; image-rendering:pixelated; }
  #rings { position:absolute; inset:0; }
  #info { position:absolute; left:0; right:0; bottom:1.5%%; text-align:center;
          color:#555; font:14px monospace; }
</style>
<body>
<canvas id="rings"></canvas>
<img class="marker" id="m0" src="%s"><img class="marker" id="m1" src="%s">
<img class="marker" id="m2" src="%s"><img class="marker" id="m3" src="%s">
<div id="info"></div>
<script>
  function layout() {
    const W = innerWidth, H = innerHeight;
    const m = Math.round(0.01 * Math.min(W, H));
    const s = Math.round(0.07 * Math.min(W, H));
    [[m,m],[W-m-s,m],[m,H-m-s],[W-m-s,H-m-s]].forEach(([x,y],i) => {
      const el = document.getElementById('m'+i);
      el.style.left = x+'px'; el.style.top = y+'px';
      el.style.width = s+'px'; el.style.height = s+'px';
      el.style.outline = Math.round(s/8)+'px solid #fff';
    });
    const c = document.getElementById('rings');
    c.width = W; c.height = H;
    document.getElementById('info').textContent =
      `teller calibration · viewport ${W}x${H} · margin ${m} · marker ${s}`;
  }
  addEventListener('resize', layout); layout();
  document.body.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  async function poll() {
    try {
      const s = await (await fetch('/state.json')).json();
      const c = document.getElementById('rings');
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = '#f59e0b';
      g.lineWidth = %d;
      for (const [x, y] of s.rings) {
        g.beginPath(); g.arc(x, y, %d, 0, 7); g.stroke();
      }
    } catch (e) {}
    setTimeout(poll, 800);
  }
  poll();
</script>
""" % (uris[0], uris[1], uris[2], uris[3], RING_STROKE, RING_R)


# The inch card (gen_inch_card.py): ArUco id 10 printed at exactly 2".
# Seen through the same homography as everything else, it hands over
# the one fact nothing digital knows — what an inch is.
REF_ID = 10
REF_INCHES = 2.0
_last_cal = {'ppi': None, 'at': 0.0}


def ref_ppi(seen: dict, Hinv: np.ndarray) -> tuple[float, float] | None:
    """Screen px-per-inch, per axis, from the reference card if in view.

    The card is square, so its screen-space quad measures both axes —
    a stretched picture calibrates differently across and down, and
    that's a fact worth capturing, not an error to average away.
    """
    if REF_ID not in seen:
        return None
    quad = cv2.perspectiveTransform(
        seen[REF_ID].reshape(-1, 1, 2), Hinv
    ).reshape(4, 2)
    # Corners arrive TL, TR, BR, BL.
    width = (np.linalg.norm(quad[1] - quad[0]) + np.linalg.norm(quad[2] - quad[3])) / 2
    height = (np.linalg.norm(quad[3] - quad[0]) + np.linalg.norm(quad[2] - quad[1])) / 2
    ppi = float(width) / REF_INCHES
    ppi_y = float(height) / REF_INCHES
    if not (10 < ppi < 300 and 10 < ppi_y < 300):
        return None  # a misdetection, not a screen
    return round(ppi, 1), round(ppi_y, 1)


def keepalive():
    """Re-push the overlay every few seconds regardless of frames.

    The table clears the camera overlay 10s after the last event — but
    a full-res capture cycle can take LONGER than that, so the markers
    blinked off between frames and every other capture photographed a
    marker-less screen. The overlay's liveness now belongs to the
    bridge process, not to the frame cadence.
    """
    while True:
        time.sleep(5)
        with state_lock:
            rings = state['rings']
        push_to_teller(rings)


def push_calibration(ppi: float, ppi_y: float):
    """Write the measured scale onto every table-role display whose
    viewport matches the screen we're solving — the same PATCH the
    console's wizard makes, so it lands in the same slot and stays
    typed-over-able (rule 1). Throttled: the card sits on the glass
    for seconds, and one write per sighting is bookkeeping, not spam.
    """
    import time
    if not TELLER:
        return
    now = time.monotonic()
    if _last_cal['ppi'] and abs(_last_cal['ppi'] - ppi) < 0.2 \
            and now - _last_cal['at'] < 30:
        return
    _last_cal.update(ppi=ppi, at=now)
    try:
        req = urllib.request.Request(
            f'{TELLER}/api/campaigns/{TELLER_CAMPAIGN}/displays',
            headers={'x-teller-key': TELLER_KEY or ''},
        )
        displays = json.loads(urllib.request.urlopen(req, timeout=2).read())
        for display in displays:
            # This campaign's tables only, and only glass whose reported
            # viewport matches the screen we're actually solving — a
            # second TV at another size keeps its own calibration.
            if display.get('role') != 'table':
                continue
            if display.get('campaignId') != TELLER_CAMPAIGN:
                continue
            vp = display.get('viewport') or {}
            if vp.get('w') and (vp['w'], vp['h']) != (SW, SH):
                continue
            patch = urllib.request.Request(
                f'{TELLER}/api/displays/{display["id"]}',
                data=json.dumps({'ppi': ppi, 'ppiY': ppi_y}).encode(),
                headers={
                    'Content-Type': 'application/json',
                    'x-teller-key': TELLER_KEY or '',
                },
                method='PATCH',
            )
            urllib.request.urlopen(patch, timeout=2).read()
            print(f'calibrated {display["id"][:14]}: {ppi} × {ppi_y} px/in')
    except Exception as e:
        print(f'calibration push failed: {e}')


def crop_for(H: np.ndarray, img_w: int, img_h: int,
             applied: tuple[float, float, float, float] | None):
    """Where the screen sits in the FULL sensor frame, as fractions.

    The solve found the screen in the *received* image; if Eye already
    cropped, compose with the crop it says it applied — fractions
    within a fractional window need no knowledge of the sensor's pixel
    size. 10% margin so the markers never kiss the edge.
    """
    corners = np.float64([[0, 0], [SW, 0], [SW, SH], [0, SH]]).reshape(-1, 1, 2)
    quad = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
    x0, y0 = quad.min(axis=0)
    x1, y1 = quad.max(axis=0)
    mx, my = 0.10 * (x1 - x0), 0.10 * (y1 - y0)
    bx = max(0.0, (x0 - mx) / img_w)
    by = max(0.0, (y0 - my) / img_h)
    bw = min(1.0, (x1 + mx) / img_w) - bx
    bh = min(1.0, (y1 + my) / img_h) - by
    fx, fy, fw, fh = applied or (0.0, 0.0, 1.0, 1.0)
    # Plain floats — numpy's sneak into json.dumps and 500 the response.
    return [
        round(float(fx + bx * fw), 4), round(float(fy + by * fh), 4),
        round(float(bw * fw), 4), round(float(bh * fh), 4),
    ]


def process(jpeg: bytes, ts: str,
            applied: tuple[float, float, float, float] | None = None) -> str:
    # IGNORE_ORIENTATION is load-bearing: Eye crops the raw CGImage
    # bitmap (sensor space), but OpenCV applies EXIF rotation by
    # default — so crop fractions measured here were 90° off from the
    # space Eye applied them in, and every crop chopped the wrong side.
    # Both ends of the contract now speak raw sensor space.
    img = cv2.imdecode(
        np.frombuffer(jpeg, np.uint8),
        cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION,
    )
    if img is None:
        return 'undecodable frame'
    try:
        fresh, err, ids, seen = solve(img, SW, SH)
    except SystemExit as e:  # calibrate's helpers bail via sys.exit
        # Markers lost. The locked crop stays locked — a hand over the
        # table must not kick Eye back to full frame; if the crop
        # itself is bad, the human clears it from the status page.
        # Still ask the table to SHOW markers — the first frame of a
        # session fails exactly because they aren't up yet, and pushing
        # on failure is what bootstraps the loop out of that deadlock.
        push_to_teller([])
        return f'skipped: {e}'
    # Rectify through the PIN, not the fresh solve — the fresh one only
    # proves the pin still fits this frame's markers. Pinning and crop
    # proposals demand ALL FOUR corners: a 2-marker solve (one edge) is
    # near-degenerate and "succeeds" into a garbage homography — which
    # is exactly how a chopped crop kept re-proposing itself. A frame
    # with fewer markers may still ride an EXISTING pin that fits its
    # seen corners (a hand over one corner shouldn't stall detection).
    with state_lock:
        H = state['H']
    pin_note = ''
    if H is None:
        if len(ids) < 4:
            push_to_teller([])
            return f'skipped: only markers {ids} — need all 4 to pin'
        H = fresh
        pin_note = ' · pinned'
    else:
        fit = pin_rms(H, seen)
        if fit <= REPIN_RMS:
            err = fit
        elif len(ids) == 4:
            H, pin_note = fresh, f' · repinned ({fit:.1f}px drift)'
        else:
            push_to_teller([])
            return (f'skipped: pin misfit {fit:.1f}px and only markers '
                    f'{ids} — need all 4 to repin')
    with state_lock:
        state['H'] = H
    Hinv = np.linalg.inv(H)
    rect = cv2.warpPerspective(img, Hinv, (SW, SH))

    # The inch card, when it's lying on the glass: measure and file it.
    cal = ref_ppi(seen, Hinv)
    cal_note = ''
    if cal:
        push_calibration(*cal)
        cal_note = f' · inch card {cal[0]}×{cal[1]} px/in — calibrated, remove card'

    with state_lock:
        if len(ids) == 4:
            state['crop_auto'] = crop_for(H, img.shape[1], img.shape[0], applied)
        state['latest_rect'] = rect
        state['frames'] += 1
        if state['baseline'] is None:
            state['baseline'] = rect
            ok, png = cv2.imencode('.png', rect)
            state['latest_png'] = png.tobytes() if ok else None
            state['line'] = (
                f'{ts} · frame 1 · BASELINE SET · {len(ids)} markers'
                f' · RMS {err:.2f}px{pin_note}{cal_note}'
            )
            line, rings = state['line'], []
        else:
            ignore = [
                (x, y, RING_R, MASK_STROKE)
                for x, y in state['rings'] + state['prev_rings']
            ]
            found, annotated, _ = detect(state['baseline'], rect, ignore=ignore)
            ok, png = cv2.imencode('.png', annotated)
            state['latest_png'] = png.tobytes() if ok else None
            # What we found is what the table draws next — and what the
            # next frame's detector must ignore.
            state['prev_rings'] = state['rings']
            state['rings'] = [(int(cx), int(cy)) for cx, cy, _ in found]
            blobs = ' '.join(f'({cx:.0f},{cy:.0f})' for cx, cy, _ in
                             sorted(found)[:8])
            state['line'] = (
                f'{ts} · frame {state["frames"]} · {len(found)} object(s) {blobs}'
                f' · RMS {err:.2f}px{pin_note}{cal_note}'
            )
            line, rings = state['line'], state['rings']
    # Push outside the lock — a slow teller must never stall detection.
    # Markers ride from frame 1, so the table is solvable before
    # anything stands on it.
    push_to_teller(rings)
    return line


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        ts = safe_ts(self.headers.get('X-Ts'))

        if self.path == '/capture':
            (OUT / f'{ts}.jpg').write_bytes(body)
            raw = self.headers.get('X-Crop', 'full')
            applied = None
            if raw != 'full':
                try:
                    fx, fy, fw, fh = (float(v) for v in raw.split(','))
                    applied = (fx, fy, fw, fh)
                except ValueError:
                    pass
            print(process(body, ts, applied))
            with state_lock:
                crop = state['crop']
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'crop': crop}).encode())
            return
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
        if self.path == '/table':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(table_page().encode())
            return
        if self.path == '/status.json':
            with state_lock:
                body = {
                    'line': state['line'],
                    'frames': state['frames'],
                    'crop': state['crop'],
                    'crop_auto': state['crop_auto'],
                }
            with control_lock:
                body['auto'] = control['auto']
                body['interval'] = control['interval']
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())
            return
        if self.path == '/control':
            with control_lock:
                body = json.dumps(control)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body.encode())
            return
        if self.path.startswith('/set?'):
            from urllib.parse import parse_qs, urlparse
            q = parse_qs(urlparse(self.path).query)
            if 'crop' in q:
                with state_lock:
                    if q['crop'][0] == 'lock':
                        state['crop'] = state['crop_auto']
                    else:  # 'clear' — back to full frame
                        state['crop'] = None
            with control_lock:
                if 'interval' in q:
                    control['interval'] = max(0.5, float(q['interval'][0]))
                if 'auto' in q:
                    control['auto'] = q['auto'][0] == 'on'
                if 'lock' in q:
                    control['lock'] = q['lock'][0] == 'on'
                if 'shoot' in q:
                    control['shoot'] += 1
                control['rev'] += 1
            self.send_response(303)
            self.send_header('Location', '/')
            self.end_headers()
            return
        if self.path == '/state.json':
            with state_lock:
                body = json.dumps({'rings': state['rings'], 'r': RING_R})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body.encode())
            return
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
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(PAGE.encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--screen', required=True, help='pattern viewport, e.g. 1920x1080')
    ap.add_argument('--teller', help="teller host, e.g. http://localhost:4525 — "
                    'markers and rings go to the REAL table view')
    ap.add_argument('--campaign', help='campaign id the table is showing')
    ap.add_argument('--key', help='DM key (default: ~/.teller/dm.key)')
    ap.add_argument('port', nargs='?', type=int, default=8124)
    args = ap.parse_args()
    SW, SH = (int(v) for v in args.screen.lower().split('x'))
    if args.teller:
        if not args.campaign:
            ap.error('--teller needs --campaign')
        TELLER = args.teller.rstrip('/')
        TELLER_CAMPAIGN = args.campaign
        TELLER_KEY = args.key or (
            Path.home() / '.teller' / 'dm.key').read_text().strip()
        threading.Thread(target=keepalive, daemon=True).start()
        print(f'bridging to {TELLER} · campaign {TELLER_CAMPAIGN}')
    print(f'listening on 0.0.0.0:{args.port} · screen {SW}x{SH} · watch http://localhost:{args.port}/')
    ThreadingHTTPServer(('0.0.0.0', args.port), Handler).serve_forever()

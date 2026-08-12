#!/usr/bin/env python3
"""Generate pattern.html — the calibration target the table screen displays.

Four ArUco markers (DICT_4X4_50, ids 0-3) at the corners of the viewport,
laid out by a formula both this page and calibrate.py compute identically:

    m = round(0.06 * min(W, H))   # margin
    s = round(0.12 * min(W, H))   # marker side
    id 0 top-left     (m, m)
    id 1 top-right    (W - m - s, m)
    id 2 bottom-left  (m, H - m - s)
    id 3 bottom-right (W - m - s, H - m - s)

The page lays itself out with JS from the live viewport and prints the
viewport size on screen, so every photo of it carries the numbers the
solver needs. Optional ?ppi=NN draws a faint 1-inch grid for eyeballing
against a real ruler.

Run once: `./.venv/bin/python gen_pattern.py` → writes pattern.html.
"""

import base64
import cv2

MARKER_PX = 400  # generation resolution; the page scales via CSS

def marker_data_uri(marker_id: int) -> str:
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    img = cv2.aruco.generateImageMarker(d, marker_id, MARKER_PX)
    ok, png = cv2.imencode('.png', img)
    assert ok
    return 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode()

uris = [marker_data_uri(i) for i in range(4)]

html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>teller camera calibration pattern</title>
<style>
  html, body {{ margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }}
  .marker {{
    position: absolute;
    /* ArUco needs a light quiet zone: the white border is part of the target. */
    background: #fff;
    padding: 0;
    image-rendering: pixelated;
  }}
  #info {{
    position: absolute; left: 0; right: 0; bottom: 1.5%;
    text-align: center; color: #555; font: 14px monospace;
  }}
  #grid {{ position: absolute; inset: 0; }}
</style>
</head>
<body>
<canvas id="grid"></canvas>
<img class="marker" id="m0" src="{uris[0]}">
<img class="marker" id="m1" src="{uris[1]}">
<img class="marker" id="m2" src="{uris[2]}">
<img class="marker" id="m3" src="{uris[3]}">
<div id="info"></div>
<script>
  function layout() {{
    const W = window.innerWidth, H = window.innerHeight;
    const m = Math.round(0.06 * Math.min(W, H));
    const s = Math.round(0.12 * Math.min(W, H));
    const pos = [[m, m], [W - m - s, m], [m, H - m - s], [W - m - s, H - m - s]];
    pos.forEach(([x, y], i) => {{
      const el = document.getElementById('m' + i);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = s + 'px';
      el.style.height = s + 'px';
      // ArUco's outer border is black; on a black page it needs a white
      // quiet zone OUTSIDE the marker square. Outline doesn't move layout,
      // so the (x, y, s) box stays exactly what calibrate.py expects.
      el.style.outline = Math.round(s / 8) + 'px solid #fff';
    }});
    document.getElementById('info').textContent =
      `teller calibration · viewport ${{W}}x${{H}} · margin ${{m}} · marker ${{s}}`;

    // Optional true-inch grid for a ruler sanity check: ?ppi=80.1
    const ppi = parseFloat(new URLSearchParams(location.search).get('ppi'));
    const c = document.getElementById('grid');
    c.width = W; c.height = H;
    if (ppi > 0) {{
      const g = c.getContext('2d');
      g.strokeStyle = '#222';
      g.lineWidth = 1;
      for (let x = 0; x <= W; x += ppi) {{ g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }}
      for (let y = 0; y <= H; y += ppi) {{ g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }}
    }}
  }}
  window.addEventListener('resize', layout);
  layout();

  // One tap/click = true fullscreen (browser chrome gone), tap again to
  // leave. The resize listener re-lays-out and reprints the viewport —
  // use the numbers shown AFTER fullscreening.
  document.body.addEventListener('click', () => {{
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }});
</script>
</body>
</html>
"""

with open('pattern.html', 'w') as f:
    f.write(html)
print('wrote pattern.html')

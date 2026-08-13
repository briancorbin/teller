#!/usr/bin/env python3
"""Generate bezel-marks.html — printable ArUco markers for the TV bezel.

The endgame for calibration furniture: markers that physically exist.
Stuck to the bezel they are always visible, can never be chopped by a
bad crop, never blink with an overlay's timing, and don't care what
the screen shows — which also makes them compatible with a crossed
polarizer that blacks the screen out entirely (stickers are lit by
room light, which is unpolarized).

Ids 4-7, outside the on-screen set (0-3) and the inch card (10):

    4 top-left · 5 top-right · 6 bottom-left · 7 bottom-right

printed at exactly 1.5" (browsers print CSS `in` true-size — same
accuracy story as the inch card, same check strip). Cut on the dashed
lines: the white border IS the quiet zone, keep it.

Placement: one near each screen corner, on the bezel, any exact spot —
rotation and position need not be precise, because bezel markers are
calibrated by a one-time ceremony (not built yet): with the on-screen
pattern up, one photo sees both sets, the on-screen solve anchors
screen space, and the bezel corners are recorded in it. After that the
stickers alone carry the calibration, until they peel.

Run once: `./.venv/bin/python gen_bezel_marks.py` → writes bezel-marks.html.
Print at 100%, no "fit to page".
"""

import base64
import cv2

IDS = {4: 'top-left', 5: 'top-right', 6: 'bottom-left', 7: 'bottom-right'}
SIDE_IN = 1.5

d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)


def uri(marker_id: int) -> str:
    img = cv2.aruco.generateImageMarker(d, marker_id, 400)
    ok, png = cv2.imencode('.png', img)
    assert ok
    return 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode()


cards = '\n'.join(
    f'<div class="card"><img class="marker" src="{uri(i)}">'
    f'<div class="label">id {i} · {place}</div></div>'
    for i, place in IDS.items()
)

html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>teller bezel markers</title>
<style>
  @page {{ margin: 0.5in; }}
  body {{ font: 11pt system-ui; margin: 0.5in; }}
  .cards {{ display: flex; flex-wrap: wrap; gap: 0.3in; }}
  .card {{ text-align: center; }}
  .marker {{
    width: {SIDE_IN}in; height: {SIDE_IN}in;
    image-rendering: pixelated;
    /* the quiet zone the camera needs, and the cut line */
    padding: 0.2in; border: 1px dashed #999;
    background: #fff;
  }}
  .label {{ font-size: 9pt; color: #333; }}
  .ticks {{ display: flex; margin-top: 0.4in; }}
  .tick {{
    width: 1in; height: 0.25in;
    border-left: 1.5px solid #000; border-bottom: 1.5px solid #000;
  }}
  .tick:last-child {{ border-right: 1.5px solid #000; }}
  p {{ max-width: 5.5in; color: #333; }}
</style>
</head>
<body>
<h3>teller bezel markers</h3>
<div class="cards">
{cards}
</div>
<div class="ticks"><div class="tick"></div><div class="tick"></div><div class="tick"></div></div>
<p><b>Check once:</b> the strip must measure exactly 3 inches against a
ruler; if not, reprint at 100%, no "fit to page".</p>
<p><b>Placement:</b> cut on the dashed lines (keep the white border —
it is the quiet zone the camera needs) and fix one near each screen
corner ON THE BEZEL, matching the labels. Exact position and rotation
don't matter; the calibration ceremony measures where they actually
are. Flat matters — a curled corner reads as a warped marker.</p>
</body>
</html>
"""

with open('bezel-marks.html', 'w') as f:
    f.write(html)
print(f'wrote bezel-marks.html (ids {sorted(IDS)} at {SIDE_IN}")')

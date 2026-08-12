#!/usr/bin/env python3
"""Generate inch-card.html — the printable reference that makes display
calibration automatic.

The camera knows camera↔screen pixels perfectly; nothing in the loop
knows a physical INCH. This card introduces one: an ArUco marker
(id 10, outside the screen's 0-3) printed at exactly 2.000" square.
Browsers print CSS `in` units at true size, so "print at 100% scale"
IS the accuracy story — verified once against the printed check strip,
then never again.

Lay the card flat on the glass while the bridge runs: it sees the
marker through the same homography as everything else, measures its
screen-pixel size, and screen px-per-inch falls out — per axis, since
the card is square and a stretched picture isn't.

Run once: `./.venv/bin/python gen_inch_card.py` → writes inch-card.html.
Print it with margins/scale untouched (100%, no "fit to page").
"""

import base64
import cv2

REF_ID = 10
REF_INCHES = 2.0

d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
img = cv2.aruco.generateImageMarker(d, REF_ID, 400)
ok, png = cv2.imencode('.png', img)
uri = 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode()

html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>teller inch card</title>
<style>
  @page {{ margin: 0.5in; }}
  body {{ font: 11pt system-ui; margin: 0.5in; }}
  .marker {{
    width: {REF_INCHES}in; height: {REF_INCHES}in;
    image-rendering: pixelated;
    /* the quiet zone the camera needs, and a cut line */
    padding: 0.25in; border: 1px dashed #999;
  }}
  .ticks {{ display: flex; margin-top: 0.4in; }}
  .tick {{
    width: 1in; height: 0.25in;
    border-left: 1.5px solid #000; border-bottom: 1.5px solid #000;
  }}
  .tick:last-child {{ border-right: 1.5px solid #000; }}
  p {{ max-width: 5in; color: #333; }}
</style>
</head>
<body>
<h3>teller inch card</h3>
<img class="marker" src="{uri}">
<div class="ticks"><div class="tick"></div><div class="tick"></div><div class="tick"></div></div>
<p><b>Check once:</b> the strip above must measure exactly 3 inches
against a ruler. If it doesn't, the print dialog scaled the page —
reprint at 100%, no "fit to page".</p>
<p><b>Use:</b> lay this card flat anywhere on the table screen while
the camera runs. Calibration happens by itself; take it off when the
page says so.</p>
</body>
</html>
"""

with open('inch-card.html', 'w') as f:
    f.write(html)
print(f'wrote inch-card.html (marker id {REF_ID} at {REF_INCHES}")')

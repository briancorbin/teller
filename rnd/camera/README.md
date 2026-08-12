# rnd/camera — the table camera (TEL-77)

Phase 0 of the mini-tracking R&D: prove auto-calibration between a
camera and the table screen. Nothing here ships; when a piece earns its
place it moves into teller proper (the pattern becomes a page the host
serves, the solver becomes host-side vision).

## Setup (once)

```bash
python3 -m venv .venv
./.venv/bin/pip install opencv-python-headless numpy
./.venv/bin/python gen_pattern.py     # writes pattern.html
```

`.venv/` stays out of git.

## TV settings (once, before the first run)

In order of how badly each breaks calibration if left on:

1. **Overscan OFF** — "Just Scan" / "Screen Fit" / 1:1 pixel mapping;
   labeling the HDMI input "PC" forces it on most TVs. Overscan
   rescales the picture, moving every marker off its formula position.
2. **Ambient light sensor / eco / auto-brightness OFF** — a TV that
   dims itself shifts the subtraction baseline.
3. **Local dimming + dynamic contrast OFF** — per-zone, content-driven
   output changes are exactly what known-background subtraction can't
   tolerate.
4. **Game or PC mode** — kills remaining processing in one switch.
5. **Sharpness 0** — sharpening halos read as geometry to sub-pixel
   corner detection.
6. **HDR off / SDR** — tone mapping is another content-dependent
   luminance transform.
7. **Backlight fixed, moderate** — consistency beats brightness with a
   locked camera; max backlight blooms into glare.
8. **Sleep / screensaver off** for the session.

OLED caveat: pixel shift (burn-in protection) nudges the image a few
px and often can't be disabled. Per-frame auto-cal mostly absorbs it;
a consistent 2–3px residual error is probably this.

## The calibration run

1. **TV flat on the table**, driven by anything with a browser. Open
   `pattern.html` fullscreen (add `?ppi=80.1` to draw a true-inch grid
   for a ruler sanity check — ppi = horizontal resolution ÷ visible
   width in inches).
2. Note the **viewport size the page prints** at the bottom
   (`viewport 3840x2160 · …`).
3. **Phone photo** from roughly where the rail camera will hang —
   main 1× lens (not ultra-wide), AE/AF locked (long-press), all four
   markers in frame. Handheld is fine: auto-cal re-solves per frame,
   that's the property under test.
4. Get the photo to this folder (AirDrop; HEIC auto-converts via sips)
   and run:

   ```bash
   ./.venv/bin/python calibrate.py IMG_1234.HEIC --screen 3840x2160 --width-in 47.6
   ```

5. Read the outputs:
   - `*.rectified.png` — the photo warped to a flat top-down view,
     one output pixel = one screen pixel. **If this looks like a
     screenshot, calibration works.** Anything standing on the glass
     (put a die on it!) appears at its true grid position.
   - `*.overlay.png` — detections (green) vs reprojection (amber) on
     the original photo.
   - Reprojection RMS in screen px, and in inches given `--width-in`.

Success bar: RMS under ~0.1" across shots from several handheld poses.

`calibrate.py --selftest` proves the pipeline with no hardware at all
(synthesizes the pattern, warps it, requires sub-pixel recovery).

## The live loop (no AirDrop, no per-shot commands)

1. TV: `pattern.html`, one click → fullscreen. Note the viewport size.
2. Mac: `./.venv/bin/python receive.py --screen 1920x1080`
3. Phone: the Eye app (`../eye/` — build once via Xcode). URL =
   `http://<mac-lan-ip>:8124`. Prop the phone STILL (fixed pose is what
   makes reflections subtract out), frame all four markers, **LOCK**,
   then **auto** on.
4. Watch `http://localhost:8124/` (or that URL from any device) — the
   first good frame becomes the empty-table baseline; every frame
   after diffs against it. Move a mini between frames and watch it
   tracked. Hit **rebase** when you rearrange on purpose.

Frames with no solvable markers (a hand over the table) are skipped
and say so; raw frames still land in `captures/` for re-runs.

## What's next (in order)

1. Known-background subtraction: photo of the table view (not the
   pattern) with objects standing on it, minus what the host knows it
   rendered → object mask. The rectified view makes this a straight
   image diff.
2. Stable-frame lift/place detection over a sequence.
3. The capture node that feeds it (rail Pi — or the phone app, which
   also answers the LiDAR-depth question for free).

See TEL-77 for the full design and the shopping list.

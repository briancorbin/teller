#!/usr/bin/env python3
"""Solve camera↔screen calibration from one photo of pattern.html.

    ./.venv/bin/python calibrate.py photo.jpg --screen 3840x2160 [--width-in 47.6]
    ./.venv/bin/python calibrate.py --selftest

The pattern page prints its viewport size on screen (`viewport 3840x2160`);
pass exactly that as --screen. Marker positions are recomputed from the
same layout formula the page uses, so the photo plus that one number is
the entire input.

Outputs, next to the photo:
  <photo>.rectified.png — the photo warped to a flat, top-down view of the
      screen: one output pixel = one screen pixel. If this looks like a
      screenshot, calibration works.
  <photo>.overlay.png — detected corners and the reprojected marker
      outlines drawn on the original photo.

Report: reprojection RMS error in screen px (and in inches, given
--width-in = the physical width of the visible picture, for px/inch).

--selftest renders the pattern synthetically, warps it with a known
perspective, and requires the solver to recover it to sub-pixel error —
proof the pipeline works before pointing it at a real photo.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)


def layout(w: int, h: int):
    """Marker squares in screen px — must mirror pattern.html's formula."""
    m = round(0.06 * min(w, h))
    s = round(0.12 * min(w, h))
    origins = {
        0: (m, m),
        1: (w - m - s, m),
        2: (m, h - m - s),
        3: (w - m - s, h - m - s),
    }
    # Corner order matches what ArUco detection reports: TL, TR, BR, BL.
    corners = {
        i: np.array(
            [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], dtype=np.float64
        )
        for i, (x, y) in origins.items()
    }
    return corners, s


def read_image(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is not None:
        return img
    # iPhones shoot HEIC, which OpenCV can't read; macOS can convert.
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
        pass
    r = subprocess.run(
        ['sips', '-s', 'format', 'jpeg', str(path), '--out', tmp.name],
        capture_output=True,
    )
    if r.returncode == 0:
        img = cv2.imread(tmp.name)
        if img is not None:
            print(f'(converted {path.name} from HEIC via sips)')
            return img
    sys.exit(f'could not read {path} (HEIC conversion also failed)')


def detect(img: np.ndarray):
    detector = cv2.aruco.ArucoDetector(DICT, cv2.aruco.DetectorParameters())
    found, ids, _ = detector.detectMarkers(img)
    if ids is None:
        sys.exit('no ArUco markers found — is the pattern on screen and in frame?')
    return {int(i): c.reshape(4, 2).astype(np.float64) for i, c in zip(ids.flatten(), found)}


def solve(img: np.ndarray, screen_w: int, screen_h: int):
    expected, _ = layout(screen_w, screen_h)
    seen = detect(img)
    ids = sorted(set(expected) & set(seen))
    if len(ids) < 2:
        sys.exit(f'only markers {sorted(seen)} found; need at least 2 of 0-3')

    cam_pts = np.vstack([seen[i] for i in ids])
    scr_pts = np.vstack([expected[i] for i in ids])
    # Homography screen → camera (so we can reproject expected onto the photo).
    H, _ = cv2.findHomography(scr_pts, cam_pts, cv2.RANSAC, 5.0)
    if H is None:
        sys.exit('homography solve failed')

    # Reprojection error, measured in SCREEN pixels: send detections back.
    Hinv = np.linalg.inv(H)
    back = cv2.perspectiveTransform(cam_pts.reshape(-1, 1, 2), Hinv).reshape(-1, 2)
    err = np.sqrt(np.mean(np.sum((back - scr_pts) ** 2, axis=1)))
    return H, err, ids, seen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo', nargs='?', type=Path)
    ap.add_argument('--screen', help='viewport WxH as printed on the pattern page')
    ap.add_argument('--width-in', type=float,
                    help="physical width of the visible picture, inches (for px/inch)")
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return
    if not args.photo or not args.screen:
        ap.error('photo and --screen are required (or --selftest)')

    sw, sh = (int(v) for v in args.screen.lower().split('x'))
    img = read_image(args.photo)
    H, err, ids, seen = solve(img, sw, sh)

    print(f'markers used: {ids}')
    print(f'reprojection RMS: {err:.2f} screen px')
    if args.width_in:
        ppi = sw / args.width_in
        print(f'screen: {ppi:.1f} px/inch → RMS ≈ {err / ppi:.3f} inches')
        print(f'a 1" base covers ~{ppi:.0f} screen px in the rectified view')

    # The money shot: the photo flattened into screen space.
    rect = cv2.warpPerspective(img, np.linalg.inv(H), (sw, sh))
    rect_path = args.photo.with_suffix('.rectified.png')
    cv2.imwrite(str(rect_path), rect)

    # Overlay: detections (green) + reprojected expected outlines (amber).
    overlay = img.copy()
    expected, _ = layout(sw, sh)
    for i in ids:
        cv2.polylines(overlay, [seen[i].astype(np.int32)], True, (0, 255, 0), 2)
        proj = cv2.perspectiveTransform(expected[i].reshape(-1, 1, 2), H)
        cv2.polylines(overlay, [proj.astype(np.int32)], True, (0, 176, 255), 2)
    over_path = args.photo.with_suffix('.overlay.png')
    cv2.imwrite(str(over_path), overlay)

    print(f'wrote {rect_path.name} and {over_path.name}')
    if err > 3:
        print('⚠ RMS is high — check the photo is sharp and all four markers are visible')


def selftest():
    """Render the pattern, warp it with a known perspective, recover it."""
    sw, sh = 1920, 1080
    canvas = np.zeros((sh, sw), np.uint8)
    corners, s = layout(sw, sh)
    pad = s // 8  # the white quiet zone the page draws with an outline
    for i, pts in corners.items():
        marker = cv2.aruco.generateImageMarker(DICT, i, s)
        x, y = int(pts[0][0]), int(pts[0][1])
        canvas[y - pad:y + s + pad, x - pad:x + s + pad] = 255
        canvas[y:y + s, x:x + s] = marker
    canvas = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)

    # A believable phone pose: rotated, tilted, off-center.
    src = np.float64([[0, 0], [sw, 0], [sw, sh], [0, sh]])
    dst = np.float64([[210, 160], [1690, 90], [1770, 1010], [130, 940]])
    W = cv2.getPerspectiveTransform(src.astype(np.float32), dst.astype(np.float32))
    photo = cv2.warpPerspective(canvas, W, (1900, 1100))

    H, err, ids, _ = solve(photo, sw, sh)
    assert len(ids) == 4, f'expected 4 markers, found {ids}'
    assert err < 1.0, f'selftest RMS {err:.3f} px — too high'
    print(f'selftest OK: 4 markers, reprojection RMS {err:.3f} screen px')


if __name__ == '__main__':
    main()

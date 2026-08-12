#!/usr/bin/env python3
"""First object-detection pass: two photos → what's standing on the glass.

    ./.venv/bin/python subtract.py baseline.jpg objects.jpg --screen 1920x1080

Both photos are rectified into screen space (each solves its own
homography — they can be handheld from completely different poses),
then diffed. Blobs bigger than ~half a base are reported with their
centroids in screen px.

Honest prototype caveats: the baseline here is a PHOTO, so anything
that changed between shots (reflections of the photographer, sun)
diffs too. The real pipeline diffs against the frame the host KNOWS it
rendered, and only on stable frames — this script exists to prove the
geometry, not the segmentation.

Outputs: objects.detected.png (annotated rectified view), objects.mask.png.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np

from calibrate import read_image, solve


def rectify(path: Path, sw: int, sh: int) -> np.ndarray:
    img = read_image(path)
    H, err, ids, _ = solve(img, sw, sh)
    print(f'{path.name}: markers {ids}, RMS {err:.2f} px')
    return cv2.warpPerspective(img, np.linalg.inv(H), (sw, sh))


def detect(
    base: np.ndarray, objs: np.ndarray, min_area: int = 400
) -> tuple[list[tuple[float, float, int]], np.ndarray, np.ndarray]:
    """Diff two rectified frames → (blobs, annotated view, mask).

    Blobs are (cx, cy, area) in screen px. Shared by the CLI below and
    the live receiver — one detector, two doors.
    """
    g0 = cv2.GaussianBlur(cv2.cvtColor(base, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    g1 = cv2.GaussianBlur(cv2.cvtColor(objs, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    g0 = cv2.equalizeHist(g0)
    g1 = cv2.equalizeHist(g1)
    diff = cv2.absdiff(g0, g1)
    # Otsu picks the "best" split even when the diff is essentially
    # nothing — an empty table gets its sensor noise promoted to
    # objects. Floor the threshold so near-identical frames stay empty.
    t, _ = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    _, mask = cv2.threshold(diff, max(t, 40), 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    )
    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    )

    n, _, stats, centroids = cv2.connectedComponentsWithStats(mask)
    out = objs.copy()
    found: list[tuple[float, float, int]] = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        x, y, w, h = (int(stats[i, k]) for k in (
            cv2.CC_STAT_LEFT, cv2.CC_STAT_TOP, cv2.CC_STAT_WIDTH, cv2.CC_STAT_HEIGHT))
        cx, cy = centroids[i]
        found.append((float(cx), float(cy), area))
        cv2.rectangle(out, (x, y), (x + w, y + h), (0, 176, 255), 3)
        # Magenta, and bigger than a base: green-on-a-green-mini taught
        # us a crosshair must not match anything a player would paint.
        cv2.drawMarker(out, (int(cx), int(cy)), (255, 0, 255),
                       cv2.MARKER_CROSS, 48, 3)
        cv2.putText(out, f'({int(cx)},{int(cy)})', (x, y - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    return found, out, mask


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('baseline', type=Path)
    ap.add_argument('objects', type=Path)
    ap.add_argument('--screen', required=True)
    ap.add_argument('--min-area', type=int, default=400,
                    help='ignore blobs smaller than this, px² (default 400)')
    args = ap.parse_args()
    sw, sh = (int(v) for v in args.screen.lower().split('x'))

    base = rectify(args.baseline, sw, sh)
    objs = rectify(args.objects, sw, sh)
    found, out, mask = detect(base, objs, args.min_area)

    print(f'{len(found)} object(s):')
    for cx, cy, area in sorted(found, key=lambda f: f[0]):
        print(f'  centroid ({cx:.0f}, {cy:.0f}) screen px · area {area} px²')

    det = args.objects.with_suffix('.detected.png')
    cv2.imwrite(str(det), out)
    cv2.imwrite(str(args.objects.with_suffix('.mask.png')), mask)
    print(f'wrote {det.name} and {args.objects.stem}.mask.png')


if __name__ == '__main__':
    main()

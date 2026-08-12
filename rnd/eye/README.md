# Eye — the capture node, as a phone (TEL-77 phase 0)

A deliberately dumb camera app: full-resolution stills on demand or on
an interval, locked exposure, optional LiDAR depth, POSTed to a
receiver on the LAN. All vision runs on the host — same shape the rail
Pi node will have, so nothing learned here is throwaway.

## Build & install

```bash
xcodegen generate        # project.yml → Eye.xcodeproj (gitignored)
open Eye.xcodeproj       # select your phone, Run
```

First install on the phone: Settings → General → VPN & Device
Management → trust the developer cert. CLI alternative once that's
done: `xcodebuild -project Eye.xcodeproj -scheme Eye -destination
'generic/platform=iOS' build` and install via Xcode's Devices window.

**Simulators have no camera** — this only means anything on the real
phone.

## Use

1. Start the receiver on the Mac/host:
   `../camera/.venv/bin/python ../camera/receive.py` (port 8124).
2. In Eye, set the upload URL to `http://<mac-lan-ip>:8124`.
3. Frame the table, let auto settle, then **LOCK** — exposure, focus
   and white balance freeze so the screen below can't make the camera
   flinch. (This is the whole reason the app exists instead of the
   stock camera.)
4. Shutter for one capture, or **auto** for one every 2 s. LiDAR
   toggle rides along on Pro phones — depth arrives as float32 metres
   (256×192-ish) beside each JPEG.

Files land in `../camera/captures/`, ready for `calibrate.py`:

```bash
../camera/.venv/bin/python ../camera/calibrate.py \
    ../camera/captures/<ts>.jpg --screen 3840x2160 --width-in 47.6
```

## Notes

- The screen stays awake while Eye is open (it's a rig camera).
- Plain-HTTP uploads are deliberate (local-first table, LAN only) —
  `NSAllowsLocalNetworking`, not a blanket ATS exemption.
- Depth readback on the host:
  `np.fromfile('x.depth.f32', np.float32).reshape(meta['height'], meta['width'])`.

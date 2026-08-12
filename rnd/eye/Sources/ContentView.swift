import AVFoundation
import SwiftUI

/// Live preview behind a thin control strip. The workflow is the rig's:
/// frame the table → let auto settle → LOCK → capture (or let the
/// interval do it). Everything else is a setting that persists.
struct ContentView: View {
    @StateObject private var camera = CameraController()
    // Hardcoded to Brian's Mac by request — the phone lives on the rig
    // and nobody wants to type an IP on a propped phone. Becomes a
    // setting again the day this isn't a one-table prototype.
    private let uploadBase = "http://192.168.4.76:8124"
    @AppStorage("intervalSec") private var intervalSec = 2.0
    @State private var auto = false
    @State private var lastResult = ""
    @State private var timer: Timer?

    var body: some View {
        ZStack(alignment: .bottom) {
            Preview(session: camera.session)
                .ignoresSafeArea()

            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    Button(camera.locked ? "LOCKED" : "LOCK") {
                        camera.locked ? camera.unlock() : camera.lock()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(camera.locked ? .orange : .gray)

                    if camera.depthAvailable {
                        Toggle("LiDAR", isOn: $camera.depthEnabled)
                            .toggleStyle(.button)
                            .tint(.cyan)
                    }

                    Toggle(
                        "auto \(intervalSec < 1 ? String(format: "%.1f", intervalSec) : String(Int(intervalSec)))s",
                        isOn: $auto
                    )
                        .toggleStyle(.button)
                        .tint(.green)
                        .onChange(of: auto) { _, _ in restartTimer() }

                    Spacer()

                    Button {
                        shoot()
                    } label: {
                        Circle()
                            .strokeBorder(.white, lineWidth: 4)
                            .frame(width: 58, height: 58)
                            .background(Circle().fill(.white.opacity(0.25)))
                    }
                }

                Text("\(uploadBase) · \(camera.status)\(lastResult.isEmpty ? "" : " · \(lastResult)")")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding()
            .background(.black.opacity(0.35))
        }
        // A rig camera is a dark-room tool: solid black behind the
        // preview and forced dark scheme, so an empty session (starting
        // up, or permission denied) shows legible controls on black
        // instead of white-on-white nothing.
        .background(Color.black.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .onAppear {
            camera.start()
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .task { await followRemote() }
    }

    private func restartTimer() {
        timer?.invalidate()
        timer = nil
        if auto {
            timer = Timer.scheduledTimer(
                withTimeInterval: intervalSec, repeats: true
            ) { _ in shoot() }
        }
    }

    /// The propped phone is a puppet: poll the receiver's /control and
    /// apply whatever it says — interval, auto, exposure lock, one-shot
    /// captures — so nobody ever has to touch the rig. `rev` gates
    /// application to actual changes, so the local buttons still work
    /// between remote commands.
    private func followRemote() async {
        var lastRev = -1
        var lastShoot = -1
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard
                let url = URL(string: uploadBase)?.appendingPathComponent("control"),
                let (data, _) = try? await URLSession.shared.data(from: url),
                let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let rev = obj["rev"] as? Int
            else { continue }

            if rev != lastRev {
                lastRev = rev
                if let i = obj["interval"] as? Double { intervalSec = i }
                if let a = obj["auto"] as? Bool { auto = a }
                if let l = obj["lock"] as? Bool, l != camera.locked {
                    l ? camera.lock() : camera.unlock()
                }
                restartTimer()
                lastResult = "remote: \(auto ? "auto" : "paused") @ \(intervalSec)s"
            }
            let shootN = obj["shoot"] as? Int ?? 0
            if lastShoot >= 0 && shootN > lastShoot { shoot() }
            lastShoot = shootN
        }
    }

    private func shoot() {
        guard let url = URL(string: uploadBase) else {
            lastResult = "bad URL"
            return
        }
        camera.capture { capture in
            Task { @MainActor in
                let (line, next) = await Uploader(base: url)
                    .send(capture, applied: capture.applied)
                lastResult = line
                // The server said where the screen is; ship only that
                // from now on. nil = markers lost, go back to full.
                camera.cropFraction = next
            }
        }
    }
}

/// The capture session's own preview layer, resized with the view.
private struct Preview: UIViewRepresentable {
    let session: AVCaptureSession

    final class Host: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    }

    func makeUIView(context: Context) -> Host {
        let view = Host()
        view.backgroundColor = .black
        let layer = view.layer as! AVCaptureVideoPreviewLayer
        layer.session = session
        layer.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ view: Host, context: Context) {}
}

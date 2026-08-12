import AVFoundation
import SwiftUI

/// Live preview behind a thin control strip. The workflow is the rig's:
/// frame the table → let auto settle → LOCK → capture (or let the
/// interval do it). Everything else is a setting that persists.
struct ContentView: View {
    @StateObject private var camera = CameraController()
    @AppStorage("uploadBase") private var uploadBase = "http://192.168.1.10:8124"
    @AppStorage("intervalSec") private var intervalSec = 2.0
    @State private var auto = false
    @State private var lastResult = ""
    @State private var timer: Timer?

    var body: some View {
        ZStack(alignment: .bottom) {
            Preview(session: camera.session)
                .ignoresSafeArea()

            VStack(spacing: 10) {
                HStack {
                    TextField("http://host:8124", text: $uploadBase)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .padding(8)
                        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(.white)
                        .font(.system(.footnote, design: .monospaced))
                }

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

                    Toggle("auto \(Int(intervalSec))s", isOn: $auto)
                        .toggleStyle(.button)
                        .tint(.green)
                        .onChange(of: auto) { _, on in
                            timer?.invalidate()
                            timer = nil
                            if on {
                                timer = Timer.scheduledTimer(
                                    withTimeInterval: intervalSec, repeats: true
                                ) { _ in shoot() }
                            }
                        }

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

                Text("\(camera.status)\(lastResult.isEmpty ? "" : " · \(lastResult)")")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding()
            .background(.black.opacity(0.35))
        }
        .statusBarHidden()
        .onAppear {
            camera.start()
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }

    private func shoot() {
        guard let url = URL(string: uploadBase) else {
            lastResult = "bad URL"
            return
        }
        camera.capture { capture in
            Task { @MainActor in
                lastResult = await Uploader(base: url).send(capture)
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
        let layer = view.layer as! AVCaptureVideoPreviewLayer
        layer.session = session
        layer.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ view: Host, context: Context) {}
}

import AVFoundation
import UIKit

/// The camera, and nothing but the camera.
///
/// Two properties matter more than anything else here, both learned
/// from the table this points at:
///
/// * **Full-resolution stills, not video.** The pipeline runs at 1–2
///   captures per second on stable scenes; a 12–48MP still gives
///   ~84+ px per inch of table, which is what makes 1" bases and
///   (later) ArUco rings readable. There is no video path at all.
/// * **Locked exposure.** The surface under the minis is a screen that
///   changes constantly; auto-exposure chasing it would wreck the
///   host's background subtraction. `lock()` freezes exposure, focus
///   and white balance at whatever the operator framed.
final class CameraController: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()

    @Published var locked = false
    @Published var depthAvailable = false
    @Published var depthEnabled = false
    @Published var status = "starting…"

    private let queue = DispatchQueue(label: "ink.teller.eye.camera")
    private var device: AVCaptureDevice?
    private let photoOutput = AVCapturePhotoOutput()
    private var onCapture: ((Capture) -> Void)?

    struct Capture {
        let jpeg: Data
        /// Row-major float32 metres, when depth was delivered.
        let depth: (data: Data, width: Int, height: Int)?
    }

    func start() {
        queue.async { self.configure() }
    }

    private func configure() {
        session.beginConfiguration()
        session.sessionPreset = .photo

        // The LiDAR device IS the 1× wide camera plus depth; prefer it
        // where it exists so depth capture is a toggle, not a rebuild.
        let picked =
            AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        guard let picked, let input = try? AVCaptureDeviceInput(device: picked) else {
            report("no back camera")
            return
        }
        device = picked
        if session.canAddInput(input) { session.addInput(input) }
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }

        // Ask for the sensor's best still, not the default.
        if let best = picked.activeFormat.supportedMaxPhotoDimensions.last {
            photoOutput.maxPhotoDimensions = best
        }
        let hasDepth = photoOutput.isDepthDataDeliverySupported
        photoOutput.isDepthDataDeliveryEnabled = hasDepth

        session.commitConfiguration()
        session.startRunning()
        DispatchQueue.main.async {
            self.depthAvailable = hasDepth
            self.depthEnabled = hasDepth
        }
        report("ready — \(picked.localizedName)")
    }

    /// Freeze exposure, focus and white balance where they are now.
    /// (Frame the table, let auto settle, then lock.)
    func lock() {
        queue.async {
            guard let device = self.device,
                  (try? device.lockForConfiguration()) != nil else { return }
            if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
            if device.isFocusModeSupported(.locked) { device.focusMode = .locked }
            if device.isWhiteBalanceModeSupported(.locked) { device.whiteBalanceMode = .locked }
            device.unlockForConfiguration()
            DispatchQueue.main.async { self.locked = true }
            self.report("locked")
        }
    }

    func unlock() {
        queue.async {
            guard let device = self.device,
                  (try? device.lockForConfiguration()) != nil else { return }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                device.whiteBalanceMode = .continuousAutoWhiteBalance
            }
            device.unlockForConfiguration()
            DispatchQueue.main.async { self.locked = false }
            self.report("auto")
        }
    }

    func capture(_ handler: @escaping (Capture) -> Void) {
        onCapture = handler
        let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
        if photoOutput.isDepthDataDeliveryEnabled && depthEnabled {
            settings.isDepthDataDeliveryEnabled = true
        }
        photoOutput.capturePhoto(with: settings, delegate: self)
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            report("capture failed: \(error.localizedDescription)")
            return
        }
        guard let jpeg = photo.fileDataRepresentation() else {
            report("no image data")
            return
        }
        var depth: (Data, Int, Int)?
        if let raw = photo.depthData {
            // Whatever the sensor delivered (often disparity), as metres.
            let metres = raw.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
            depth = Self.planeData(metres.depthDataMap)
        }
        onCapture?(Capture(jpeg: jpeg, depth: depth.map { ($0.0, $0.1, $0.2) }))
        onCapture = nil
    }

    /// A pixel buffer's float plane as tightly-packed row-major bytes —
    /// rows can be padded, so copy per row rather than in one block.
    private static func planeData(_ buffer: CVPixelBuffer) -> (Data, Int, Int) {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let base = CVPixelBufferGetBaseAddress(buffer)!
        var data = Data(capacity: width * height * 4)
        for row in 0..<height {
            data.append(
                Data(bytes: base.advanced(by: row * stride), count: width * 4)
            )
        }
        return (data, width, height)
    }

    private func report(_ text: String) {
        DispatchQueue.main.async { self.status = text }
    }
}

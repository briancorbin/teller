import Foundation

/// Ships a capture to the receiver — raw bodies, no multipart, so the
/// other end (rnd/camera/receive.py, later the host) stays trivial.
///
///   POST <base>/capture   body = JPEG              header X-Ts
///   POST <base>/depth     body = float32 metres    headers X-Ts, X-Width, X-Height
///
/// One timestamp header ties an image to its depth map.
struct Uploader {
    let base: URL

    func send(_ capture: CameraController.Capture) async -> String {
        let ts = ISO8601DateFormatter().string(from: .now)
        do {
            try await post(
                path: "capture", body: capture.jpeg,
                type: "image/jpeg", headers: ["X-Ts": ts]
            )
            if let depth = capture.depth {
                try await post(
                    path: "depth", body: depth.data,
                    type: "application/octet-stream",
                    headers: [
                        "X-Ts": ts,
                        "X-Width": String(depth.width),
                        "X-Height": String(depth.height),
                    ]
                )
            }
            let kb = capture.jpeg.count / 1024
            let d = capture.depth.map { " + depth \($0.width)×\($0.height)" } ?? ""
            return "sent \(kb) KB\(d)"
        } catch {
            return "upload failed: \(error.localizedDescription)"
        }
    }

    private func post(
        path: String, body: Data, type: String, headers: [String: String]
    ) async throws {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue(type, forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        let (_, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}

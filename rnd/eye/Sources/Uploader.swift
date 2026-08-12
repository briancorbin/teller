import Foundation

/// Ships a capture to the receiver — raw bodies, no multipart, so the
/// other end (rnd/camera/receive.py, later the host) stays trivial.
///
///   POST <base>/capture   body = JPEG    headers X-Ts, X-Crop
///   POST <base>/depth     body = float32 headers X-Ts, X-Width, X-Height
///
/// One timestamp header ties an image to its depth map. X-Crop is the
/// fraction of the FULL sensor frame this JPEG covers ("fx,fy,fw,fh",
/// or "full"); /capture's response carries the crop the server wants
/// NEXT — it knows where the screen sits, so the phone can stop
/// photographing the room. `null` means markers were lost (the phone
/// moved): revert to full frame and the loop re-derives everything.
struct Uploader {
    let base: URL

    func send(
        _ capture: CameraController.Capture, applied: CGRect?
    ) async -> (line: String, nextCrop: CGRect?) {
        let ts = ISO8601DateFormatter().string(from: .now)
        let cropHeader = applied.map {
            "\($0.origin.x),\($0.origin.y),\($0.width),\($0.height)"
        } ?? "full"
        do {
            let reply = try await post(
                path: "capture", body: capture.jpeg,
                type: "image/jpeg", headers: ["X-Ts": ts, "X-Crop": cropHeader]
            )
            if let depth = capture.depth {
                _ = try await post(
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
            let zoom = applied == nil ? "full" : "cropped"
            return ("sent \(kb) KB \(zoom)\(d)", Self.crop(from: reply))
        } catch {
            return ("upload failed: \(error.localizedDescription)", applied)
        }
    }

    /// {"crop": [fx, fy, fw, fh]} or {"crop": null}.
    private static func crop(from reply: Data) -> CGRect? {
        guard
            let obj = try? JSONSerialization.jsonObject(with: reply) as? [String: Any],
            let f = obj["crop"] as? [Double], f.count == 4
        else { return nil }
        return CGRect(x: f[0], y: f[1], width: f[2], height: f[3])
    }

    private func post(
        path: String, body: Data, type: String, headers: [String: String]
    ) async throws -> Data {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue(type, forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}

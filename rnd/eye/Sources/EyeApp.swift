import SwiftUI

// Eye — the capture node, as a phone (TEL-77 phase 0).
//
// A deliberately dumb camera: it takes a full-resolution still when
// asked (or on an interval), locks exposure so the screen below can't
// make it flinch, and POSTs the result to wherever it's pointed. All
// vision runs on the host — this app has no smarts to configure, which
// is the same shape the rail Pi node will have.

@main
struct EyeApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

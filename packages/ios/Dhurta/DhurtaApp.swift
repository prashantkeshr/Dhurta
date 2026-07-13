import SwiftUI

/// Application entry point for the Dhurta iOS browser (v1.0.8.0).
///
/// iOS forces every browser onto WebKit, so the anonymity strategy differs from
/// Android: rather than randomising per-device, every Dhurta iOS user presents
/// an *identical* WKWebView surface (a shared anonymity set) and routes through
/// an embedded Tor loop via the iOS 17+ per-datastore proxy API.
@main
struct DhurtaApp: App {
    @StateObject private var session = BrowserSession()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
                .task {
                    await session.bootstrap()
                }
        }
    }
}

/// Owns the Tor proxy lifecycle and the shared, hardened data store.
@MainActor
final class BrowserSession: ObservableObject {
    @Published private(set) var isProtected = false
    @Published private(set) var killSwitchEngaged = false

    private let tor = TorProxy()

    func bootstrap() async {
        do {
            try await tor.start()
            isProtected = true
            tor.onHeartbeatLost = { [weak self] in
                Task { @MainActor in self?.engageKillSwitch() }
            }
        } catch {
            engageKillSwitch()
        }
    }

    /// Fail-closed: lock the UI until protection is restored. Mirrors the
    /// DHURTA_ERR_TOR_CIRCUIT_DOWN contract from @dhurta/core/ipc.
    private func engageKillSwitch() {
        isProtected = false
        killSwitchEngaged = true
    }

    func torProxyConfig() -> ProxyConfiguration? {
        tor.proxyConfiguration()
    }
}

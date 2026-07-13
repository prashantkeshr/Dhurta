import Foundation
import Network

/// Embedded Tor loop for iOS. Wraps Tor.framework (Onion Browser's maintained
/// Tor build) and exposes an iOS 17+ `ProxyConfiguration` that points WebKit at
/// the local SOCKS5 endpoint. Publishes a 1-second heartbeat; if the circuit
/// drops, `onHeartbeatLost` fires and the host engages the kill-switch.
final class TorProxy {

    enum TorError: Error {
        case bootstrapTimeout
        case processFailed
    }

    private let socksHost = "127.0.0.1"
    private let socksPort: UInt16 = 9050
    private let controlPort: UInt16 = 9051

    private var heartbeatTimer: DispatchSourceTimer?
    private let heartbeatQueue = DispatchQueue(label: "express.hyperlocal.dhurta.tor.heartbeat")
    private var lastHealthy = Date()

    /// Invoked when the circuit heartbeat is lost beyond the grace window.
    var onHeartbeatLost: (() -> Void)?

    /// Starts Tor and suspends until the first circuit is live.
    func start(timeout: TimeInterval = 45) async throws {
        try await TorRuntime.shared.startClient(
            socksPort: socksPort,
            controlPort: controlPort,
            timeout: timeout
        )
        lastHealthy = Date()
        beginHeartbeat()
    }

    func stop() {
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        TorRuntime.shared.stop()
    }

    /// iOS 17+ proxy descriptor routing all WebKit traffic through Tor SOCKS5.
    /// DNS resolution is delegated to the proxy (never a raw system resolver),
    /// closing the DNS-leak vector.
    func proxyConfiguration() -> ProxyConfiguration? {
        guard #available(iOS 17.0, *) else { return nil }
        let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(socksHost),
            port: NWEndpoint.Port(rawValue: socksPort)!
        )
        var proxy = ProxyConfiguration(socksv5Proxy: endpoint)
        // Resolve hostnames at the proxy so lookups ride the circuit.
        proxy.matchDomains = []   // empty → apply to all domains
        return proxy
    }

    private func beginHeartbeat() {
        let timer = DispatchSource.makeTimerSource(queue: heartbeatQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1.0)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if TorRuntime.shared.isCircuitHealthy() {
                self.lastHealthy = Date()
            } else if Date().timeIntervalSince(self.lastHealthy) > 1.5 {
                // Grace window matches @dhurta/core HEARTBEAT_GRACE_MS.
                self.heartbeatTimer?.cancel()
                self.onHeartbeatLost?()
            }
        }
        timer.resume()
        heartbeatTimer = timer
    }
}

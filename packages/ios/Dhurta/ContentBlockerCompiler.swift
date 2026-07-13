import Foundation
import WebKit

/// Compiles the shared blocklist (already translated to Safari Content Blocker
/// JSON by @dhurta/core `compileToSafariRules`) into a `WKContentRuleList` that
/// WebKit enforces at the network layer — no JS, no per-request callback.
///
/// The JSON is produced at build time by the core package and bundled as
/// `blocklist.json`; this loader compiles it once and caches the result.
enum ContentBlockerCompiler {

    enum CompileError: Error {
        case resourceMissing
        case compilationFailed(String)
    }

    private static let identifier = "express.hyperlocal.dhurta.blocklist"

    /// Loads and compiles the bundled rule list. Returns nil gracefully if the
    /// resource is absent so the browser still runs (unblocked) rather than
    /// failing to launch.
    static func loadRuleList() async -> WKContentRuleList? {
        guard
            let url = Bundle.main.url(forResource: "blocklist", withExtension: "json"),
            let json = try? String(contentsOf: url, encoding: .utf8)
        else {
            return nil
        }

        return await withCheckedContinuation { continuation in
            WKContentRuleListStore.default().compileContentRuleList(
                forIdentifier: identifier,
                encodedContentRuleList: json
            ) { ruleList, error in
                if let error {
                    // Compilation failure must not crash the app; log-and-continue.
                    NSLog("[Dhurta] Content blocker compile failed: \(error.localizedDescription)")
                    continuation.resume(returning: nil)
                } else {
                    continuation.resume(returning: ruleList)
                }
            }
        }
    }
}

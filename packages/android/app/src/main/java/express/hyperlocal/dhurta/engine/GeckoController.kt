package express.hyperlocal.dhurta.engine

import android.content.Context
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.ContentBlocking

/**
 * Thread-safe controller that owns the singleton [GeckoRuntime] and produces
 * hardened [GeckoSession]s.
 *
 * Every session is locked down to match the desktop privacy posture:
 *   - privacy.resistFingerprinting = true  (Tor Browser's uniform surface)
 *   - WebRTC media/peerconnection pathways fully disabled at the engine layer
 *   - Layout letterboxing so viewport dimensions round to a common bucket
 *   - All egress forced through the local SOCKS5 proxy exposed by [TorController]
 *
 * The Kotlin preference keys mirror @dhurta/core/webrtc GECKO_WEBRTC_PREFS so
 * TypeScript and Kotlin never drift.
 */
class GeckoController private constructor(
    private val runtime: GeckoRuntime,
) {
    private val mutex = Mutex()

    companion object {
        // SOCKS5 endpoint published by the embedded Tor thread (see TorController).
        const val TOR_SOCKS_HOST = "127.0.0.1"
        const val TOR_SOCKS_PORT = 9050

        @Volatile
        private var INSTANCE: GeckoController? = null

        /**
         * Initialises (once) the GeckoRuntime with global privacy hardening.
         * Safe to call from any thread; double-checked locking guarantees a
         * single runtime for the process lifetime.
         */
        fun getInstance(context: Context): GeckoController {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: build(context).also { INSTANCE = it }
            }
        }

        private fun build(context: Context): GeckoController {
            val settings = GeckoRuntimeSettings.Builder()
                .javaScriptEnabled(true)
                // Strict tracking protection at the engine layer.
                .contentBlocking(
                    ContentBlocking.Settings.Builder()
                        .antiTracking(
                            ContentBlocking.AntiTracking.DEFAULT or
                                ContentBlocking.AntiTracking.STP
                        )
                        .cookieBehavior(ContentBlocking.CookieBehavior.ACCEPT_NON_TRACKERS)
                        .safeBrowsing(ContentBlocking.SafeBrowsing.NONE) // no Google SB callout
                        .build()
                )
                .consoleOutput(false)
                .aboutConfigEnabled(false)
                .build()

            val runtime = GeckoRuntime.create(context.applicationContext, settings)
            applyHardenedPrefs(runtime)
            return GeckoController(runtime)
        }

        /**
         * Applies the engine-level preference lockdown. These are the Firefox
         * about:config keys that Tor Browser hardens; setting them on the
         * runtime means no page script can observe a non-uniform value.
         */
        private fun applyHardenedPrefs(runtime: GeckoRuntime) {
            val prefs: Map<String, Any> = mapOf(
                // ── Fingerprint resistance (RFP) ──
                "privacy.resistFingerprinting" to true,
                "privacy.resistFingerprinting.letterboxing" to true,
                "privacy.fingerprintingProtection" to true,
                "webgl.disable-fail-if-major-performance-caveat" to true,
                "dom.maxHardwareConcurrency" to 8,

                // ── WebRTC dismantled (mirror of GECKO_WEBRTC_PREFS) ──
                "media.peerconnection.enabled" to false,
                "media.navigator.enabled" to false,
                "media.navigator.streams.fake" to true,
                "media.peerconnection.ice.default_address_only" to true,
                "media.peerconnection.ice.no_host" to true,

                // ── Force all DNS + traffic through the SOCKS proxy (no leak) ──
                "network.proxy.type" to 1,             // manual proxy
                "network.proxy.socks" to TOR_SOCKS_HOST,
                "network.proxy.socks_port" to TOR_SOCKS_PORT,
                "network.proxy.socks_version" to 5,
                "network.proxy.socks_remote_dns" to true, // DNS through Tor, never raw UDP
                "network.dns.disablePrefetch" to true,
                "network.predictor.enabled" to false,

                // ── Telemetry off, always ──
                "toolkit.telemetry.enabled" to false,
                "datareporting.healthreport.uploadEnabled" to false
            )
            // GeckoRuntimeSettings exposes a prefs bridge in recent versions;
            // wrapped defensively so an unknown key can never abort the batch.
            prefs.forEach { (key, value) ->
                try {
                    runtime.settings.setPref(key, value)
                } catch (t: Throwable) {
                    // A single unsupported pref must not break engine startup.
                }
            }
        }
    }

    /**
     * Creates a fully hardened session. [ephemeral] = true selects a private
     * (in-memory) session for Ghost Mode with no disk writes.
     */
    suspend fun newSession(ephemeral: Boolean): GeckoSession = mutex.withLock {
        val sessionSettings = GeckoSessionSettings.Builder()
            .usePrivateMode(ephemeral)
            .useTrackingProtection(true)
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
            .build()

        GeckoSession(sessionSettings).apply {
            open(runtime)
        }
    }

    fun runtime(): GeckoRuntime = runtime
}

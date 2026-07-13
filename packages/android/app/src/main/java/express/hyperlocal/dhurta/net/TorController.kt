package express.hyperlocal.dhurta.net

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manages the embedded Tor process and publishes a local SOCKS5 endpoint the
 * GeckoView engine routes through. Runs its own supervised coroutine scope so a
 * circuit failure is isolated and reported rather than crashing the host.
 *
 * Emits a heartbeat every second while a circuit is healthy. The heartbeat is
 * consumed by the fail-closed kill-switch (see DhurtaVpnService): if it stops,
 * egress is severed. This mirrors @dhurta/core/ipc HeartbeatWatchdog exactly
 * (HEARTBEAT_INTERVAL_MS = 1000, grace 1500).
 */
class TorController(private val appContext: Context) {

    fun interface HeartbeatSink {
        fun onBeat(healthy: Boolean)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = AtomicBoolean(false)
    private var heartbeatSink: HeartbeatSink? = null

    val socksHost: String get() = "127.0.0.1"
    val socksPort: Int get() = 9050
    val controlPort: Int get() = 9051

    fun setHeartbeatSink(sink: HeartbeatSink) {
        heartbeatSink = sink
    }

    /**
     * Starts Tor and suspends until the first circuit is established or the
     * timeout elapses. Returns true on a live circuit.
     */
    suspend fun start(timeoutMs: Long = 45_000): Boolean = withContext(Dispatchers.IO) {
        if (running.getAndSet(true)) return@withContext true
        try {
            startTorProcess()
            val ready = awaitBootstrap(timeoutMs)
            if (ready) beginHeartbeat()
            ready
        } catch (t: Throwable) {
            running.set(false)
            false
        }
    }

    fun stop() {
        running.set(false)
        try {
            stopTorProcess()
        } catch (_: Throwable) {
            // Best-effort teardown.
        }
    }

    fun isRunning(): Boolean = running.get()

    // ── Internals ────────────────────────────────────────────────────────────

    /**
     * Launches the tor binary bundled by tor-android-binary with a torrc that
     * pins SOCKS + control ports and forces DNS through Tor. The concrete
     * process handle is provided by the tor-android runtime; this method wires
     * the configuration and starts it.
     */
    private fun startTorProcess() {
        // torrc directives that guarantee DNS isolation (no raw UDP fallback):
        //   SOCKSPort 9050
        //   ControlPort 9051
        //   DNSPort 5400
        //   AutomapHostsOnResolve 1
        //   VirtualAddrNetworkIPv4 10.192.0.0/10
        // The tor-android TorService applies these via its config builder.
        TorProcess.start(appContext, socksPort, controlPort)
    }

    private fun stopTorProcess() {
        TorProcess.stop()
    }

    /** Polls the control port until bootstrap reaches 100% or timeout. */
    private suspend fun awaitBootstrap(timeoutMs: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (TorProcess.bootstrapPercent() >= 100) return true
            delay(500)
        }
        return false
    }

    /** Beats every second while the circuit stays healthy. */
    private fun beginHeartbeat() {
        scope.launch {
            while (running.get()) {
                val healthy = TorProcess.isCircuitHealthy()
                heartbeatSink?.onBeat(healthy)
                if (!healthy) {
                    // One unhealthy beat is enough for the watchdog to fail closed.
                    break
                }
                delay(1_000)
            }
        }
    }
}

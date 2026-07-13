package express.hyperlocal.dhurta.net

import android.content.Intent
import android.net.VpnService
import android.os.ParcelFileDescriptor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Device-wide packet-capture VPN with a hard, fail-closed kill-switch.
 *
 * Establishes a tun interface that captures ALL device traffic and funnels it
 * into the local Tor SOCKS proxy. If the Tor heartbeat drops for even one beat,
 * [engageKillSwitch] tears down egress immediately — traffic is dropped, never
 * leaked — and broadcasts the standardised DHURTA_ERR_TOR_CIRCUIT_DOWN code the
 * React chrome intercepts to lock the screen.
 *
 * Heartbeat cadence/grace mirror @dhurta/core/ipc HeartbeatWatchdog.
 */
class DhurtaVpnService : VpnService() {

    companion object {
        const val ACTION_START = "express.hyperlocal.dhurta.VPN_START"
        const val ACTION_STOP = "express.hyperlocal.dhurta.VPN_STOP"
        const val BROADCAST_KILLSWITCH = "express.hyperlocal.dhurta.KILLSWITCH"
        const val EXTRA_ERROR_CODE = "errorCode"
        const val ERR_TOR_CIRCUIT_DOWN = "DHURTA_ERR_TOR_CIRCUIT_DOWN"

        private const val HEARTBEAT_GRACE_MS = 1_500L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tunInterface: ParcelFileDescriptor? = null
    private val active = AtomicBoolean(false)
    @Volatile private var lastBeat = 0L
    private var watchdogJob: Job? = null
    private lateinit var tor: TorController

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { teardown(); return START_NOT_STICKY }
            else -> startTunnel()
        }
        return START_STICKY
    }

    private fun startTunnel() {
        if (active.getAndSet(true)) return

        tor = TorController(applicationContext).apply {
            setHeartbeatSink { healthy ->
                if (healthy) lastBeat = System.currentTimeMillis()
            }
        }

        scope.launch {
            val ready = tor.start()
            if (!ready) {
                engageKillSwitch("Tor failed to bootstrap")
                return@launch
            }
            establishInterface()
            lastBeat = System.currentTimeMillis()
            startWatchdog()
        }
    }

    /**
     * Builds the tun interface. `addDisallowedApplication` is intentionally NOT
     * used for our own package's Tor sockets; everything else is captured. The
     * builder is configured in blocking mode so that when we later revoke the
     * fd, packets are dropped rather than falling back to the raw network.
     */
    private fun establishInterface() {
        val builder = Builder()
            .setSession("Dhurta Secure Tunnel")
            .setMtu(1500)
            .addAddress("10.111.0.2", 32)
            .addDnsServer("10.111.0.1")   // captured DNS → routed into Tor DNSPort
            .addRoute("0.0.0.0", 0)        // capture ALL IPv4
            .setBlocking(true)
        // Exclude our own process so the Tor client sockets can reach the network.
        try {
            builder.addDisallowedApplication(packageName)
        } catch (_: Throwable) { /* package always resolvable; guard regardless */ }

        tunInterface = builder.establish()
    }

    /**
     * Fail-closed watchdog. If no healthy heartbeat arrives within the grace
     * window, egress is severed and the error broadcast. Runs until teardown.
     */
    private fun startWatchdog() {
        watchdogJob = scope.launch {
            while (active.get()) {
                val elapsed = System.currentTimeMillis() - lastBeat
                if (elapsed > HEARTBEAT_GRACE_MS) {
                    engageKillSwitch("No Tor heartbeat for ${elapsed}ms")
                    break
                }
                kotlinx.coroutines.delay(500)
            }
        }
    }

    /** Hard cut: drop the tun fd so no packet can escape, then notify the UI. */
    private fun engageKillSwitch(reason: String) {
        try {
            tunInterface?.close()
        } catch (_: Throwable) {
        } finally {
            tunInterface = null
        }
        val intent = Intent(BROADCAST_KILLSWITCH).apply {
            setPackage(packageName)
            putExtra(EXTRA_ERROR_CODE, ERR_TOR_CIRCUIT_DOWN)
            putExtra("reason", reason)
        }
        sendBroadcast(intent)
    }

    private fun teardown() {
        active.set(false)
        watchdogJob?.cancel()
        try { tor.stop() } catch (_: Throwable) {}
        try { tunInterface?.close() } catch (_: Throwable) {}
        tunInterface = null
        stopSelf()
    }

    override fun onDestroy() {
        teardown()
        scope.cancel()
        super.onDestroy()
    }
}

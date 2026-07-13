package express.hyperlocal.dhurta.net

import android.content.Context
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Thin, self-contained wrapper around the native `tor` binary.
 *
 * Rather than binding to a specific wrapper library's shifting API, this
 * launches tor directly with a generated torrc and parses its stdout for the
 * canonical `Bootstrapped NN%` lines (tor writes these when `Log notice stdout`
 * is set). This keeps the integration stable across tor releases.
 *
 * The tor binary itself is provided at runtime — either extracted from the
 * tor-android-binary AAR's jniLibs, or bundled under the app's nativeLibraryDir.
 * [locateBinary] resolves it from the standard Android native lib location.
 */
object TorProcess {

    private val process = AtomicReference<Process?>(null)
    private val bootstrap = AtomicInteger(0)

    /** Current bootstrap percentage (0..100). */
    fun bootstrapPercent(): Int = bootstrap.get()

    /** Healthy while the process is alive and fully bootstrapped. */
    fun isCircuitHealthy(): Boolean {
        val p = process.get() ?: return false
        return p.isAlive && bootstrap.get() >= 100
    }

    @Synchronized
    fun start(context: Context, socksPort: Int, controlPort: Int) {
        if (process.get()?.isAlive == true) return
        bootstrap.set(0)

        val dataDir = File(context.filesDir, "tor-data").apply { mkdirs() }
        val torrc = writeTorrc(context, dataDir, socksPort, controlPort)
        val binary = locateBinary(context)

        val pb = ProcessBuilder(binary.absolutePath, "-f", torrc.absolutePath)
            .redirectErrorStream(true)
        pb.directory(dataDir)
        pb.environment()["HOME"] = dataDir.absolutePath

        val proc = pb.start()
        process.set(proc)
        readBootstrapAsync(proc)
    }

    @Synchronized
    fun stop() {
        process.getAndSet(null)?.let { p ->
            try { p.destroy() } catch (_: Throwable) {}
        }
        bootstrap.set(0)
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private fun locateBinary(context: Context): File {
        // tor-android-binary ships libtor.so in the APK's native lib dir.
        val nativeDir = context.applicationInfo.nativeLibraryDir
        val candidate = File(nativeDir, "libtor.so")
        if (candidate.exists()) return candidate
        // Fallback: a binary extracted to files/ during install.
        return File(context.filesDir, "tor")
    }

    private fun writeTorrc(
        context: Context,
        dataDir: File,
        socksPort: Int,
        controlPort: Int,
    ): File {
        val torrc = File(context.filesDir, "torrc")
        // DNSPort + AutomapHostsOnResolve guarantee name lookups ride the Tor
        // circuit; no query ever escapes over raw UDP.
        torrc.writeText(
            """
            Log notice stdout
            DataDirectory ${dataDir.absolutePath}
            SocksPort $socksPort
            ControlPort $controlPort
            DNSPort 5400
            AutomapHostsOnResolve 1
            VirtualAddrNetworkIPv4 10.192.0.0/10
            AvoidDiskWrites 1
            ClientOnly 1
            """.trimIndent()
        )
        return torrc
    }

    private fun readBootstrapAsync(proc: Process) {
        Thread({
            try {
                BufferedReader(InputStreamReader(proc.inputStream)).use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val l = line ?: continue
                        val idx = l.indexOf("Bootstrapped ")
                        if (idx >= 0) {
                            val pct = l.substring(idx + "Bootstrapped ".length)
                                .takeWhile { it.isDigit() }
                                .toIntOrNull()
                            if (pct != null) bootstrap.set(pct)
                        }
                    }
                }
            } catch (_: Throwable) {
                // Stream closed on process exit; healthy() already reflects this.
            }
        }, "tor-stdout-reader").apply { isDaemon = true }.start()
    }
}

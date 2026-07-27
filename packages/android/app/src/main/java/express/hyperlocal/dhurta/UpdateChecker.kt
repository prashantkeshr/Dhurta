package express.hyperlocal.dhurta

import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Checks GitHub Releases for a newer Dhurta APK, selects the asset that
 * matches this device's ABI (arm64-v8a preferred, x86_64 as fallback).
 */
object UpdateChecker {

    private const val API = "https://api.github.com/repos/prashantkeshr/Dhurta/releases/latest"

    data class UpdateInfo(
        val tagName: String,       // "v1.4.5"
        val versionName: String,   // "1.4.5"
        val downloadUrl: String,   // direct APK browser_download_url
        val assetName: String,     // filename e.g. "Dhurta-1.4.5-arm64-v8a-release.apk"
        val sizeBytes: Long = 0L,
    )

    /**
     * Returns [UpdateInfo] if a release newer than [currentVersion] exists, or null.
     * Always runs on Dispatchers.IO — safe to call from any coroutine.
     */
    suspend fun check(currentVersion: String): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val conn = (URL(API).openConnection() as HttpURLConnection).apply {
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "DhurtaAndroid/$currentVersion")
                connectTimeout = 12_000
                readTimeout = 12_000
            }
            if (conn.responseCode != 200) return@withContext null

            val root = JSONObject(conn.inputStream.bufferedReader().readText())
            val tag = root.optString("tag_name").takeIf { it.isNotEmpty() }
                ?: return@withContext null
            val remote = tag.trimStart('v')

            if (!isNewer(remote, currentVersion)) return@withContext null

            val assets = root.optJSONArray("assets") ?: return@withContext null

            // Prefer the APK for this device's primary ABI, fall back to arm64-v8a.
            val preferredAbi = Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
            val fallbackAbi = "arm64-v8a"

            fun findApk(abi: String): Triple<String, String, Long>? {
                for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    val name = a.optString("name", "")
                    if (name.endsWith(".apk") && name.contains(abi)) {
                        return Triple(
                            a.optString("browser_download_url"),
                            name,
                            a.optLong("size", 0L),
                        )
                    }
                }
                return null
            }

            val (url, name, size) = findApk(preferredAbi)
                ?: findApk(fallbackAbi)
                ?: run {
                    // Last resort: any APK asset
                    for (i in 0 until assets.length()) {
                        val a = assets.getJSONObject(i)
                        val n = a.optString("name", "")
                        if (n.endsWith(".apk")) {
                            return@withContext UpdateInfo(
                                tag, remote,
                                a.optString("browser_download_url"),
                                n, a.optLong("size", 0L),
                            )
                        }
                    }
                    return@withContext null
                }

            UpdateInfo(tag, remote, url, name, size)
        } catch (_: Exception) {
            null
        }
    }

    private fun isNewer(remote: String, current: String): Boolean {
        fun parts(v: String) = v.split(".").map { it.toIntOrNull() ?: 0 }
        val r = parts(remote)
        val c = parts(current)
        for (i in 0 until maxOf(r.size, c.size)) {
            val rv = r.getOrElse(i) { 0 }
            val cv = c.getOrElse(i) { 0 }
            if (rv > cv) return true
            if (rv < cv) return false
        }
        return false
    }
}

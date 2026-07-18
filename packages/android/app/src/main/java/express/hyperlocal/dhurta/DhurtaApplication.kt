package express.hyperlocal.dhurta

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import express.hyperlocal.dhurta.engine.GeckoController

/**
 * Process-level entry point. Warms the singleton [GeckoController] (which builds
 * the hardened GeckoRuntime once) and registers the foreground-service
 * notification channel Tor's onion-routing service posts into.
 */
class DhurtaApplication : Application() {

    companion object {
        const val TOR_CHANNEL_ID = "dhurta_tor_channel"
    }

    override fun onCreate() {
        super.onCreate()
        // Eagerly build the runtime so the first tab opens without engine-init lag.
        GeckoController.getInstance(this)
        createTorNotificationChannel()
    }

    private fun createTorNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                TOR_CHANNEL_ID,
                getString(R.string.tor_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.tor_notification_text)
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }
}

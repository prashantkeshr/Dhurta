package express.hyperlocal.dhurta

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

/**
 * Process-level entry point. Registers the foreground-service notification
 * channel Tor's onion-routing service posts into. (The browser engine is now
 * the OS-provided WebView, so there is no runtime to warm here.)
 */
class DhurtaApplication : Application() {

    companion object {
        const val TOR_CHANNEL_ID = "dhurta_tor_channel"
    }

    override fun onCreate() {
        super.onCreate()
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

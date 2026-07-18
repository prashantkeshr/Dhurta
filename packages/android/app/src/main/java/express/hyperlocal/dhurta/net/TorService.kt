package express.hyperlocal.dhurta.net

import android.app.Notification
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import express.hyperlocal.dhurta.DhurtaApplication
import express.hyperlocal.dhurta.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground service that owns the embedded Tor lifecycle for Ghost Mode.
 *
 * A foreground service (not a bare background thread) is mandatory on modern
 * Android: onion routing must survive the app being backgrounded, and the OS
 * kills unpromoted background processes. It broadcasts bootstrap state so the
 * UI can show a "connecting…" indicator, and exposes the live SOCKS endpoint
 * that [express.hyperlocal.dhurta.engine.GeckoController] routes every session
 * through.
 */
class TorService : Service() {

    companion object {
        const val ACTION_START = "express.hyperlocal.dhurta.TOR_START"
        const val ACTION_STOP = "express.hyperlocal.dhurta.TOR_STOP"
        const val BROADCAST_STATE = "express.hyperlocal.dhurta.TOR_STATE"
        const val EXTRA_READY = "ready"
        private const val NOTIFICATION_ID = 0x7012
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var controller: TorController

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTor()
                return START_NOT_STICKY
            }
            else -> startTor()
        }
        return START_STICKY
    }

    private fun startTor() {
        startForegroundCompat()
        controller = TorController(applicationContext)
        scope.launch {
            val ready = controller.start()
            broadcastState(ready)
            if (!ready) stopSelf()
        }
    }

    private fun stopTor() {
        if (::controller.isInitialized) controller.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startForegroundCompat() {
        val notification: Notification = NotificationCompat.Builder(
            this, DhurtaApplication.TOR_CHANNEL_ID,
        )
            .setContentTitle(getString(R.string.tor_notification_title))
            .setContentText(getString(R.string.tor_notification_text))
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun broadcastState(ready: Boolean) {
        sendBroadcast(
            Intent(BROADCAST_STATE).apply {
                setPackage(packageName)
                putExtra(EXTRA_READY, ready)
            },
        )
    }

    override fun onDestroy() {
        if (::controller.isInitialized) controller.stop()
        scope.cancel()
        super.onDestroy()
    }
}

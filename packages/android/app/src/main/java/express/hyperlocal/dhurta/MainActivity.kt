package express.hyperlocal.dhurta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import express.hyperlocal.dhurta.databinding.ActivityMainBinding
import express.hyperlocal.dhurta.engine.GeckoController
import express.hyperlocal.dhurta.net.DhurtaVpnService
import express.hyperlocal.dhurta.net.TorService
import kotlinx.coroutines.launch
import org.mozilla.geckoview.GeckoSession

/**
 * The browser surface. Hosts one hardened [GeckoSession] on the real Firefox
 * engine, wires the address bar / navigation, and toggles Ghost Mode (embedded
 * Tor + device-wide fail-closed VPN kill-switch).
 *
 * This is the first-milestone single-tab shell; multi-tab management, Omni, and
 * the Chakra VPN rail layer on top of this foundation.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var geckoController: GeckoController
    private var session: GeckoSession? = null

    private var ghostActive = false
    private var canGoBack = false
    private var canGoForward = false

    private companion object {
        const val HOME_URL = "https://search.brave.com"
    }

    // ── VPN consent: Android requires the user to approve VpnService once. ──
    private val vpnConsent = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            startService(Intent(this, DhurtaVpnService::class.java).apply {
                action = DhurtaVpnService.ACTION_START
            })
        } else {
            // Consent declined — roll Ghost Mode back so the UI never claims
            // protection that isn't actually engaged.
            Toast.makeText(this, "VPN permission is required for Ghost Mode", Toast.LENGTH_LONG).show()
            setGhost(false)
        }
    }

    // ── Tor bootstrap + kill-switch broadcasts from the services. ──
    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                TorService.BROADCAST_STATE -> {
                    val ready = intent.getBooleanExtra(TorService.EXTRA_READY, false)
                    if (ready) {
                        updateProtectionBadge(protected = true)
                        session?.reload()
                    } else {
                        Toast.makeText(this@MainActivity, "Tor failed to connect", Toast.LENGTH_LONG).show()
                        setGhost(false)
                    }
                }
                DhurtaVpnService.BROADCAST_KILLSWITCH -> {
                    // Fail-closed fired — protection dropped, egress severed.
                    updateProtectionBadge(protected = false)
                    Toast.makeText(this@MainActivity, getString(R.string.killswitch_engaged), Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        geckoController = GeckoController.getInstance(this)
        openInitialSession()
        wireChrome()
        updateProtectionBadge(protected = false)
    }

    private fun openInitialSession() {
        lifecycleScope.launch {
            val s = geckoController.newSession(ephemeral = ghostActive)
            attachDelegates(s)
            binding.geckoView.setSession(s)
            s.loadUri(HOME_URL)
            session = s
        }
    }

    private fun attachDelegates(s: GeckoSession) {
        s.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLocationChange(
                session: GeckoSession,
                url: String?,
                perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>,
                hasUserGesture: Boolean,
            ) {
                if (!binding.urlBar.hasFocus()) binding.urlBar.setText(url ?: "")
            }

            override fun onCanGoBack(session: GeckoSession, value: Boolean) {
                canGoBack = value
            }

            override fun onCanGoForward(session: GeckoSession, value: Boolean) {
                canGoForward = value
            }
        }

        s.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                binding.progressBar.visibility = android.view.View.VISIBLE
            }

            override fun onProgressChange(session: GeckoSession, progress: Int) {
                binding.progressBar.progress = progress
            }

            override fun onPageStop(session: GeckoSession, success: Boolean) {
                binding.progressBar.visibility = android.view.View.GONE
            }
        }
    }

    private fun wireChrome() {
        binding.urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigate(binding.urlBar.text.toString())
                true
            } else {
                false
            }
        }
        binding.reloadBtn.setOnClickListener { session?.reload() }
        binding.backBtn.setOnClickListener { if (canGoBack) session?.goBack() }
        binding.forwardBtn.setOnClickListener { if (canGoForward) session?.goForward() }
        binding.homeBtn.setOnClickListener { session?.loadUri(HOME_URL) }
        binding.ghostToggle.setOnClickListener { setGhost(!ghostActive) }
    }

    /** Turns a raw address-bar string into a real URL or a search query. */
    private fun navigate(raw: String) {
        val input = raw.trim()
        if (input.isEmpty()) return
        val looksLikeUrl = input.contains(".") && !input.contains(" ")
        val target = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            looksLikeUrl -> "https://$input"
            else -> "https://search.brave.com/search?q=" + android.net.Uri.encode(input)
        }
        session?.loadUri(target)
        binding.urlBar.clearFocus()
    }

    /**
     * Ghost Mode: start (or stop) embedded Tor + the fail-closed device VPN, and
     * swap in a fresh ephemeral (in-memory) session so nothing from a normal
     * session bleeds into the anonymized one.
     */
    private fun setGhost(enable: Boolean) {
        ghostActive = enable
        binding.ghostToggle.alpha = if (enable) 1f else 0.5f

        if (enable) {
            // 1) Onion routing service.
            ContextCompat.startForegroundService(
                this,
                Intent(this, TorService::class.java).apply { action = TorService.ACTION_START },
            )
            // 2) Device-wide kill-switch VPN — needs one-time consent.
            val consent = VpnService.prepare(this)
            if (consent != null) vpnConsent.launch(consent)
            else startService(Intent(this, DhurtaVpnService::class.java).apply {
                action = DhurtaVpnService.ACTION_START
            })
            Toast.makeText(this, getString(R.string.tor_connecting), Toast.LENGTH_SHORT).show()
        } else {
            stopService(Intent(this, DhurtaVpnService::class.java))
            startService(Intent(this, TorService::class.java).apply { action = TorService.ACTION_STOP })
            updateProtectionBadge(protected = false)
        }

        // Reopen the current page in a session matching the new privacy mode.
        reopenSession()
    }

    private fun reopenSession() {
        val current = binding.urlBar.text.toString().ifBlank { HOME_URL }
        session?.close()
        lifecycleScope.launch {
            val s = geckoController.newSession(ephemeral = ghostActive)
            attachDelegates(s)
            binding.geckoView.setSession(s)
            s.loadUri(current)
            session = s
        }
    }

    private fun updateProtectionBadge(protected: Boolean) {
        binding.protectionBadge.apply {
            text = if (protected) "PROTECTED" else "EXPOSED"
            setTextColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (protected) R.color.protected_green else R.color.exposed_red,
                ),
            )
        }
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter().apply {
            addAction(TorService.BROADCAST_STATE)
            addAction(DhurtaVpnService.BROADCAST_KILLSWITCH)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(stateReceiver, filter)
        }
    }

    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(stateReceiver)
        } catch (_: IllegalArgumentException) {
        }
    }

    override fun onDestroy() {
        session?.close()
        session = null
        super.onDestroy()
    }
}

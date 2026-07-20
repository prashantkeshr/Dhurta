package express.hyperlocal.dhurta

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import express.hyperlocal.dhurta.databinding.ActivityMainBinding
import express.hyperlocal.dhurta.net.DhurtaVpnService
import express.hyperlocal.dhurta.net.TorService

/**
 * Browser surface — Android System WebView (Chromium) inside the Dhurta
 * cyberpunk chrome. The rich screens (home, Omni control deck) are local asset
 * HTML reached through a dhurta:// scheme the WebViewClient intercepts, mirroring
 * the desktop's internal-page + Omni-actions pattern.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding

    // Browsing level + shield state (drives the Omni deck + the badge).
    private var mode = Mode.NORMAL
    private var af = false     // anti-fingerprint  (UI state; engine wiring is a follow-up)
    private var rtc = false    // block WebRTC       (ditto)
    private var ad = false     // ad blocker         (ditto)
    private var devMode = false

    private enum class Mode { NORMAL, CHAKRA, GHOST }
    private val protectedNow get() = mode != Mode.NORMAL

    private companion object {
        const val HOME = "file:///android_asset/newtab.html"
    }

    private fun omniUrl() = buildString {
        append("file:///android_asset/omni.html?")
        append("ghost=").append(if (mode == Mode.GHOST) 1 else 0)
        append("&chakra=").append(if (mode == Mode.CHAKRA) 1 else 0)
        append("&af=").append(if (af) 1 else 0)
        append("&rtc=").append(if (rtc) 1 else 0)
        append("&ad=").append(if (ad) 1 else 0)
    }

    private val vpnConsent = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            startService(Intent(this, DhurtaVpnService::class.java).apply {
                action = DhurtaVpnService.ACTION_START
            })
        } else {
            Toast.makeText(this, "VPN permission is required for protection", Toast.LENGTH_LONG).show()
            setMode(Mode.NORMAL)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        setupWebView()
        wireChrome()
        wireDrawer()
        startHubPulse()
        updateBadge()
        b.webView.loadUrl(HOME)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        b.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
            mediaPlaybackRequiresUserGesture = true
        }

        b.webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith("dhurta://")) { handleInternal(request.url); return true }
                return false
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                b.progressBar.visibility = View.VISIBLE
                if (!b.urlBar.hasFocus()) b.urlBar.setText(displayUrl(url))
            }

            override fun onPageFinished(view: WebView, url: String?) {
                b.progressBar.visibility = View.GONE
                if (!b.urlBar.hasFocus()) b.urlBar.setText(displayUrl(url))
            }
        }

        b.webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                b.progressBar.progress = newProgress
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    b.drawerLayout.isDrawerOpen(GravityCompat.START) ->
                        b.drawerLayout.closeDrawer(GravityCompat.START)
                    b.webView.canGoBack() -> b.webView.goBack()
                    else -> finish()
                }
            }
        })
    }

    /** dhurta:// internal routes — the mobile equivalent of the desktop Omni actions. */
    private fun handleInternal(uri: Uri) {
        when (uri.host ?: uri.schemeSpecificPart.trimStart('/')) {
            "omni" -> b.webView.loadUrl(omniUrl())
            "newtab", "home" -> b.webView.loadUrl(HOME)
            "normal" -> setMode(Mode.NORMAL)
            "chakra-on" -> setMode(Mode.CHAKRA)
            "ghost-on" -> setMode(Mode.GHOST)
            "ghost-off" -> setMode(Mode.NORMAL)
            "rotate" -> rotateCircuit()
            "toggle-af" -> { af = !af; refreshOmni() }
            "toggle-rtc" -> { rtc = !rtc; refreshOmni() }
            "toggle-ad" -> { ad = !ad; refreshOmni() }
            "autoclean" -> autoClean()
            "wipe" -> nuclearWipe()
            "devtools" -> toggleDevMode()
        }
    }

    private fun wireChrome() {
        b.urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) { navigate(b.urlBar.text.toString()); true } else false
        }
        b.reloadBtn.setOnClickListener { b.webView.reload() }
        b.backBtn.setOnClickListener { if (b.webView.canGoBack()) b.webView.goBack() }
        b.forwardBtn.setOnClickListener { if (b.webView.canGoForward()) b.webView.goForward() }
        b.homeBtn.setOnClickListener { b.webView.loadUrl(HOME) }
        b.tabsBtn.setOnClickListener { soon("Tabs manager") }
        b.hubBtn.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
    }

    private fun wireDrawer() {
        val close = { b.drawerLayout.closeDrawer(GravityCompat.START) }
        b.navOmni.setOnClickListener { b.webView.loadUrl(omniUrl()); close() }
        b.navNewTab.setOnClickListener { b.webView.loadUrl(HOME); close() }
        b.navGhost.setOnClickListener { setMode(if (mode == Mode.GHOST) Mode.NORMAL else Mode.GHOST); b.webView.loadUrl(omniUrl()); close() }
        b.navChakra.setOnClickListener { setMode(if (mode == Mode.CHAKRA) Mode.NORMAL else Mode.CHAKRA); b.webView.loadUrl(omniUrl()); close() }
        b.navSecurity.setOnClickListener { b.webView.loadUrl(omniUrl()); close() }
        b.navNetwork.setOnClickListener { b.webView.loadUrl(omniUrl()); close() }
        b.navDevtools.setOnClickListener { toggleDevMode(); close() }
        b.navWipe.setOnClickListener { nuclearWipe(); close() }
        b.navBookmarks.setOnClickListener { soon("Bookmarks"); close() }
        b.navHistory.setOnClickListener { soon("History"); close() }
        b.navDownloads.setOnClickListener { soon("Downloads"); close() }
        b.navConnect.setOnClickListener { soon("Dhurta Connect"); close() }
        b.navExtensions.setOnClickListener { soon("Extensions"); close() }
        b.navSettings.setOnClickListener { soon("Settings"); close() }
        b.navAbout.setOnClickListener { b.webView.loadUrl("https://dhurta.com"); close() }
    }

    // ── Browsing level ──────────────────────────────────────────────────────
    private fun setMode(target: Mode) {
        if (target == mode) return
        val wasProtected = protectedNow
        mode = target
        val nowProtected = protectedNow

        if (nowProtected && !wasProtected) {
            // Engage protection: embedded Tor + fail-closed device VPN.
            ContextCompat.startForegroundService(
                this, Intent(this, TorService::class.java).apply { action = TorService.ACTION_START },
            )
            val consent = VpnService.prepare(this)
            if (consent != null) vpnConsent.launch(consent)
            else startService(Intent(this, DhurtaVpnService::class.java).apply { action = DhurtaVpnService.ACTION_START })
            Toast.makeText(this, getString(R.string.tor_connecting), Toast.LENGTH_SHORT).show()
        } else if (!nowProtected && wasProtected) {
            stopService(Intent(this, DhurtaVpnService::class.java))
            startService(Intent(this, TorService::class.java).apply { action = TorService.ACTION_STOP })
            Toast.makeText(this, "Protection off — direct connection", Toast.LENGTH_SHORT).show()
        } else if (nowProtected) {
            Toast.makeText(this, if (mode == Mode.GHOST) "Ghost Mode" else "Chakra Shield", Toast.LENGTH_SHORT).show()
        }
        updateBadge()
    }

    private fun rotateCircuit() {
        if (mode != Mode.GHOST) return
        // Restart the Tor service to force a fresh circuit.
        startService(Intent(this, TorService::class.java).apply { action = TorService.ACTION_STOP })
        ContextCompat.startForegroundService(
            this, Intent(this, TorService::class.java).apply { action = TorService.ACTION_START },
        )
        Toast.makeText(this, "Requesting a fresh Tor circuit…", Toast.LENGTH_SHORT).show()
    }

    // ── Data hygiene ────────────────────────────────────────────────────────
    private fun autoClean() {
        b.webView.clearCache(true)
        CookieManager.getInstance().removeAllCookies(null)
        b.webView.clearHistory()
        Toast.makeText(this, "Site data cleared — cookies, cache, history", Toast.LENGTH_SHORT).show()
        refreshOmni()
    }

    private fun nuclearWipe() {
        b.webView.clearCache(true)
        b.webView.clearFormData()
        b.webView.clearHistory()
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        Toast.makeText(this, "☢ Nuclear Wipe — all site data destroyed", Toast.LENGTH_LONG).show()
        b.webView.loadUrl(HOME)
    }

    private fun toggleDevMode() {
        devMode = !devMode
        WebView.setWebContentsDebuggingEnabled(devMode)
        Toast.makeText(
            this,
            if (devMode) "Developer Mode ON — connect chrome://inspect over USB" else "Developer Mode OFF",
            Toast.LENGTH_LONG,
        ).show()
    }

    private fun refreshOmni() {
        b.webView.url?.let { if (it.contains("omni.html")) b.webView.loadUrl(omniUrl()) }
    }

    private fun soon(what: String) =
        Toast.makeText(this, "$what — coming soon", Toast.LENGTH_SHORT).show()

    private fun navigate(raw: String) {
        val input = raw.trim()
        if (input.isEmpty()) return
        val looksLikeUrl = input.contains(".") && !input.contains(" ")
        val target = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            looksLikeUrl -> "https://$input"
            else -> "https://search.brave.com/search?q=" + Uri.encode(input)
        }
        b.webView.loadUrl(target)
        b.urlBar.clearFocus()
    }

    private fun displayUrl(url: String?): String =
        if (url == null || url.startsWith("file:///android_asset")) "" else url

    private fun updateBadge() {
        b.protectionBadge.apply {
            text = if (protectedNow) "PROTECTED" else "EXPOSED"
            setTextColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (protectedNow) R.color.protected_green else R.color.exposed_red,
                ),
            )
        }
    }

    /** Soft looping glow pulse on the Hub. */
    private fun startHubPulse() {
        val ring = b.hubRing
        ValueAnimator.ofFloat(0.85f, 1.25f).apply {
            duration = 2600
            repeatCount = ValueAnimator.INFINITE
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener {
                val s = it.animatedValue as Float
                ring.scaleX = s; ring.scaleY = s
                ring.alpha = 1f - ((s - 0.85f) / 0.4f)
            }
            start()
        }
        ObjectAnimator.ofFloat(b.hubBtn, "scaleX", 1f, 1.05f, 1f).apply {
            duration = 2600; repeatCount = ValueAnimator.INFINITE; start()
        }
        ObjectAnimator.ofFloat(b.hubBtn, "scaleY", 1f, 1.05f, 1f).apply {
            duration = 2600; repeatCount = ValueAnimator.INFINITE; start()
        }
    }

    override fun onDestroy() {
        b.webView.destroy()
        super.onDestroy()
    }
}

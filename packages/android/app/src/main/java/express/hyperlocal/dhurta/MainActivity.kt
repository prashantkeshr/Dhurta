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
 * The browser surface. Hosts an Android System WebView (Chromium — same engine
 * family as the Electron desktop) inside the Dhurta cyberpunk chrome: compact
 * top URL pill, floating bottom dock with the raised center Dhurta Hub, and a
 * slide-out command drawer.
 *
 * Rich UI (home, Omni dashboard) is served as local asset HTML and reached via
 * a small dhurta:// scheme the WebViewClient intercepts — the same pattern the
 * desktop uses for its internal pages.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private var ghost = false
    private var devMode = false

    private companion object {
        const val HOME = "file:///android_asset/newtab.html"
        fun omniUrl(ghost: Boolean) = "file:///android_asset/omni.html?ghost=" + if (ghost) "1" else "0"
    }

    private val vpnConsent = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            startService(Intent(this, DhurtaVpnService::class.java).apply {
                action = DhurtaVpnService.ACTION_START
            })
        } else {
            Toast.makeText(this, "VPN permission is required for Ghost Mode", Toast.LENGTH_LONG).show()
            setGhost(false)
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
                if (url.startsWith("dhurta://")) {
                    handleInternal(request.url)
                    return true
                }
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

    /** dhurta:// internal routes — mirrors the desktop's internal-page scheme. */
    private fun handleInternal(uri: Uri) {
        when (uri.host ?: uri.schemeSpecificPart.trimStart('/')) {
            "omni" -> b.webView.loadUrl(omniUrl(ghost))
            "newtab", "home" -> b.webView.loadUrl(HOME)
            "ghost-on" -> setGhost(true)
            "ghost-off" -> setGhost(false)
            "devtools" -> toggleDevMode()
        }
    }

    private fun wireChrome() {
        b.urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigate(b.urlBar.text.toString()); true
            } else false
        }
        b.reloadBtn.setOnClickListener { b.webView.reload() }
        b.backBtn.setOnClickListener { if (b.webView.canGoBack()) b.webView.goBack() }
        b.forwardBtn.setOnClickListener { if (b.webView.canGoForward()) b.webView.goForward() }
        b.homeBtn.setOnClickListener { b.webView.loadUrl(HOME) }
        b.tabsBtn.setOnClickListener { soon("Tabs manager") }
        // The Hub is the command center — opens the drawer.
        b.hubBtn.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
    }

    private fun wireDrawer() {
        val close = { b.drawerLayout.closeDrawer(GravityCompat.START) }
        b.navOmni.setOnClickListener { b.webView.loadUrl(omniUrl(ghost)); close() }
        b.navNewTab.setOnClickListener { b.webView.loadUrl(HOME); close() }
        b.navGhost.setOnClickListener { setGhost(!ghost); close() }
        b.navDevtools.setOnClickListener { toggleDevMode(); close() }
        b.navBookmarks.setOnClickListener { soon("Bookmarks"); close() }
        b.navHistory.setOnClickListener { soon("History"); close() }
        b.navDownloads.setOnClickListener { soon("Downloads"); close() }
        b.navSettings.setOnClickListener { soon("Settings"); close() }
        b.navAbout.setOnClickListener { b.webView.loadUrl("https://dhurta.com"); close() }
    }

    /** Developer Mode: enables WebView remote debugging (chrome://inspect). */
    private fun toggleDevMode() {
        devMode = !devMode
        WebView.setWebContentsDebuggingEnabled(devMode)
        Toast.makeText(
            this,
            if (devMode) "Developer Mode ON — connect chrome://inspect over USB"
            else "Developer Mode OFF",
            Toast.LENGTH_LONG,
        ).show()
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

    private fun setGhost(enable: Boolean) {
        ghost = enable
        if (enable) {
            ContextCompat.startForegroundService(
                this,
                Intent(this, TorService::class.java).apply { action = TorService.ACTION_START },
            )
            val consent = VpnService.prepare(this)
            if (consent != null) vpnConsent.launch(consent)
            else startService(Intent(this, DhurtaVpnService::class.java).apply {
                action = DhurtaVpnService.ACTION_START
            })
            Toast.makeText(this, getString(R.string.tor_connecting), Toast.LENGTH_SHORT).show()
        } else {
            stopService(Intent(this, DhurtaVpnService::class.java))
            startService(Intent(this, TorService::class.java).apply { action = TorService.ACTION_STOP })
        }
        updateBadge()
        // If Omni is on screen, refresh it so it reflects the new state.
        b.webView.url?.let { if (it.contains("omni.html")) b.webView.loadUrl(omniUrl(ghost)) }
    }

    private fun updateBadge() {
        b.protectionBadge.apply {
            text = if (ghost) "PROTECTED" else "EXPOSED"
            setTextColor(
                ContextCompat.getColor(
                    this@MainActivity,
                    if (ghost) R.color.protected_green else R.color.exposed_red,
                ),
            )
        }
    }

    /** Soft, looping glow pulse on the Hub ring. */
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
        // Subtle breathing on the Hub itself.
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

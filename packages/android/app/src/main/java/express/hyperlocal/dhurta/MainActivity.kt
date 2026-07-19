package express.hyperlocal.dhurta

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.VpnService
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.WebChromeClient
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
 * family as the Electron desktop), wired to the Dhurta chrome: top URL/search
 * bar with a PROTECTED/EXPOSED badge, bottom navigation, and a slide-out sidebar
 * drawer. Ghost Mode toggles embedded Tor + the fail-closed device VPN.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private var ghost = false

    private companion object {
        const val HOME = "file:///android_asset/newtab.html"
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

        // Route the hardware/gesture Back button through WebView history.
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

    private fun wireChrome() {
        b.urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                navigate(b.urlBar.text.toString())
                true
            } else {
                false
            }
        }
        b.reloadBtn.setOnClickListener { b.webView.reload() }
        b.backBtn.setOnClickListener { if (b.webView.canGoBack()) b.webView.goBack() }
        b.forwardBtn.setOnClickListener { if (b.webView.canGoForward()) b.webView.goForward() }
        b.homeBtn.setOnClickListener { b.webView.loadUrl(HOME) }
        b.ghostToggle.setOnClickListener { setGhost(!ghost) }
        b.menuBtn.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
    }

    private fun wireDrawer() {
        val close = { b.drawerLayout.closeDrawer(GravityCompat.START) }
        b.navNewTab.setOnClickListener { b.webView.loadUrl(HOME); close() }
        b.navGhost.setOnClickListener { setGhost(!ghost); close() }
        b.navSecurity.setOnClickListener { setGhost(!ghost); close() }
        b.navBookmarks.setOnClickListener { soon("Bookmarks"); close() }
        b.navHistory.setOnClickListener { soon("History"); close() }
        b.navDownloads.setOnClickListener { soon("Downloads"); close() }
        b.navSettings.setOnClickListener { soon("Settings"); close() }
        b.navAbout.setOnClickListener {
            b.webView.loadUrl("https://dhurta.com"); close()
        }
    }

    private fun soon(what: String) =
        Toast.makeText(this, "$what — coming soon", Toast.LENGTH_SHORT).show()

    /** Turns an address-bar string into a URL or a Brave search query. */
    private fun navigate(raw: String) {
        val input = raw.trim()
        if (input.isEmpty()) return
        val looksLikeUrl = input.contains(".") && !input.contains(" ")
        val target = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            looksLikeUrl -> "https://$input"
            else -> "https://search.brave.com/search?q=" + android.net.Uri.encode(input)
        }
        b.webView.loadUrl(target)
        b.urlBar.clearFocus()
    }

    /** Blank the internal new-tab file:// URL in the bar so it reads as a clean home. */
    private fun displayUrl(url: String?): String =
        if (url == null || url.startsWith("file:///android_asset")) "" else url

    /**
     * Ghost Mode: start (or stop) embedded Tor + the fail-closed device VPN, and
     * clear the WebView's cookies/cache so nothing carries across the boundary.
     */
    private fun setGhost(enable: Boolean) {
        ghost = enable
        b.ghostToggle.alpha = if (enable) 1f else 0.5f

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

    override fun onDestroy() {
        b.webView.destroy()
        super.onDestroy()
    }
}

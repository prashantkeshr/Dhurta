package express.hyperlocal.dhurta

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.TextUtils
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import android.net.VpnService
import android.os.Bundle
import android.os.Environment
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.core.view.GestureDetectorCompat
import androidx.core.view.GravityCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import express.hyperlocal.dhurta.databinding.ActivityMainBinding
import express.hyperlocal.dhurta.net.DhurtaVpnService
import express.hyperlocal.dhurta.net.TorService
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import java.util.Collections

/**
 * Browser surface — Android System WebView (Chromium) inside the Dhurta
 * cyberpunk chrome, laid out to Chrome/Opera standards: top URL pill,
 * 5-slot bottom dock (back / forward / Hub / tabs / menu), slide-up menu
 * sheet, find-in-page, real multi-tab, fullscreen, and an injected on-device
 * inspect-element panel. Rich screens (home, Omni, Settings) are local asset
 * HTML reached through the dhurta:// scheme the WebViewClient intercepts.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private lateinit var prefs: android.content.SharedPreferences

    // Browsing level + shield state (drives the Omni deck + the badge).
    private var mode = Mode.NORMAL
    private var af = false     // anti-fingerprint  (UI state; engine wiring is a follow-up)
    private var rtc = false    // block WebRTC       (ditto)
    private var ad = false     // ad blocker         (ditto)
    private var devMode = false
    private var inspectorOn = false
    private var fullscreen = false
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // ── Animation state ──
    private var pillHidden = false
    private lateinit var gestureDetector: GestureDetectorCompat

    // ── OTA update state ──
    private var updateDownloadId = -1L
    private var updateReceiver: BroadcastReceiver? = null

    // ── Tab switcher overlay ──
    private var tabSwitcherShown = false

    // ── Tabs ──
    private val tabs = mutableListOf<WebView>()
    private var cur = 0
    private val web get() = tabs[cur]
    private val desktopTabs = HashSet<WebView>()
    private val tabTitles = HashMap<WebView, String>()
    // Bounded log of all network requests made this session (METHOD + host), newest first.
    private val recentRequests = Collections.synchronizedList(mutableListOf<String>())

    private enum class Mode { NORMAL, CHAKRA, GHOST }
    private val protectedNow get() = mode != Mode.NORMAL

    private companion object {
        const val HOME = "file:///android_asset/newtab.html"
        const val INTERNAL_BASE = "https://dhurta.internal/"
        const val MOBILE_UA_SUFFIX = " DhurtaMobile"
    }

    // ── Persistent user preferences (Settings page state) ──
    private var searchEngine: String
        get() = prefs.getString("se", "brave") ?: "brave"
        set(v) { prefs.edit().putString("se", v).apply() }
    private var textZoom: Int
        get() = prefs.getInt("zoom", 100)
        set(v) { prefs.edit().putInt("zoom", v).apply() }
    private var jsEnabled: Boolean
        get() = prefs.getBoolean("js", true)
        set(v) { prefs.edit().putBoolean("js", v).apply() }
    private var forceDark: Boolean
        get() = prefs.getBoolean("dark", false)
        set(v) { prefs.edit().putBoolean("dark", v).apply() }

    private fun omniUrl() = buildString {
        append("file:///android_asset/omni.html?")
        append("ghost=").append(if (mode == Mode.GHOST) 1 else 0)
        append("&chakra=").append(if (mode == Mode.CHAKRA) 1 else 0)
        append("&af=").append(if (af) 1 else 0)
        append("&rtc=").append(if (rtc) 1 else 0)
        append("&ad=").append(if (ad) 1 else 0)
    }

    private fun settingsUrl() = buildString {
        append("file:///android_asset/settings.html?")
        append("se=").append(searchEngine)
        append("&zoom=").append(textZoom)
        append("&js=").append(if (jsEnabled) 1 else 0)
        append("&dark=").append(if (forceDark) 1 else 0)
        append("&rtc=").append(if (rtc) 1 else 0)
        append("&af=").append(if (af) 1 else 0)
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        prefs = getSharedPreferences("dhurta", Context.MODE_PRIVATE)

        tabs.add(b.webView)
        setupGestures()
        configureWebView(b.webView)
        wireChrome()
        wireMenu()
        wireFind()
        wireTabSwitcher()
        wireDrawer()
        wireBack()
        startHubPulse()
        updateBadge()
        updateTabCount()
        web.loadUrl(HOME)

        // Silent background update check — at most once per 24 h
        val lastCheck = prefs.getLong("last_update_check", 0L)
        if (System.currentTimeMillis() - lastCheck > 86_400_000L) {
            lifecycleScope.launch {
                delay(5_000) // let the home page settle before hitting the network
                checkForUpdates(silent = true)
            }
        }
    }

    // ── WebView factory / shared configuration ──────────────────────────────
    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView(w: WebView) {
        w.settings.apply {
            javaScriptEnabled = jsEnabled
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
            mediaPlaybackRequiresUserGesture = true
            textZoom = this@MainActivity.textZoom
            userAgentString += MOBILE_UA_SUFFIX
        }
        applyForceDark(w)

        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith("dhurta://")) { handleInternal(request.url); return true }
                return false
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): android.webkit.WebResourceResponse? {
                val url = request.url.toString()
                if (!url.startsWith("file://") && !url.startsWith(INTERNAL_BASE) && !url.startsWith("data:")) {
                    val method = request.method ?: "GET"
                    val entry = "$method ${request.url.host ?: url.take(80)}"
                    recentRequests.add(0, entry)
                    if (recentRequests.size > 150) recentRequests.removeAt(recentRequests.size - 1)
                }
                return null
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                view.settings.javaScriptEnabled = jsEnabled ||
                    url?.startsWith("file:///android_asset") == true ||
                    url?.startsWith(INTERNAL_BASE) == true
                if (view != web) return
                b.progressBar.visibility = View.VISIBLE
                if (!b.urlBar.hasFocus()) b.urlBar.setText(displayUrl(url))
                if (!fullscreen && url != HOME) b.urlPill.visibility = View.VISIBLE
                // Always slide pill + dock back into view on navigation
                if (!fullscreen && pillHidden) {
                    pillHidden = false
                    b.urlPill.animate().translationY(0f).setDuration(200).start()
                    b.dock.animate().translationY(0f).setDuration(200).start()
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (view == web) {
                    b.progressBar.visibility = View.GONE
                    if (!b.urlBar.hasFocus()) b.urlBar.setText(displayUrl(url))
                    // The home page carries its own integrated search bar — hide the
                    // native pill there so there's exactly one address field on screen.
                    if (!fullscreen) {
                        b.urlPill.visibility =
                            if (url == HOME) View.GONE else View.VISIBLE
                    }
                }
                if (url != null && url.startsWith("http") && !url.startsWith(INTERNAL_BASE)) {
                    recordHistory(url, view.title ?: url)
                }
                if (inspectorOn && view == web) injectInspector()
                // Inject captured request log into the Omni dashboard after it loads.
                if (url?.contains("omni.html") == true) {
                    val snap: List<String>
                    synchronized(recentRequests) { snap = recentRequests.take(50).toList() }
                    val json = snap.joinToString(",") {
                        "\"${it.replace("\\", "\\\\").replace("\"", "\\\"")}\""
                    }
                    view.evaluateJavascript(
                        "window.__dhurtaRequests=[$json];if(typeof renderRequests==='function')renderRequests();",
                        null,
                    )
                }
            }
        }

        w.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                if (view == web) b.progressBar.progress = newProgress
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                if (title != null) tabTitles[view] = title
            }

            // HTML5 video fullscreen (YouTube etc.)
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) { callback.onCustomViewHidden(); return }
                customView = view
                customViewCallback = callback
                (window.decorView as ViewGroup).addView(
                    view,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
                    ),
                )
                hideSystemBars(true)
            }

            override fun onHideCustomView() {
                customView?.let { (window.decorView as ViewGroup).removeView(it) }
                customView = null
                customViewCallback = null
                if (!fullscreen) hideSystemBars(false)
            }
        }

        w.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            try {
                val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    setTitle(fileName)
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                Toast.makeText(this, "⬇ Downloading $fileName", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "Download failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }

        w.setFindListener { activeMatchOrdinal, numberOfMatches, isDoneCounting ->
            if (isDoneCounting && w == web) {
                b.findCount.text = if (numberOfMatches == 0) "0/0"
                else "${activeMatchOrdinal + 1}/$numberOfMatches"
            }
        }

        // Scroll-to-hide URL pill + dock (only the active tab drives it)
        w.setOnScrollChangeListener { _, _, scrollY, _, oldScrollY ->
            if (w != web || fullscreen || tabSwitcherShown) return@setOnScrollChangeListener
            val dy = scrollY - oldScrollY
            if (dy > 12 && !pillHidden) {
                pillHidden = true
                val pillH = b.urlPill.height.toFloat().coerceAtLeast(140f)
                val dockH = b.dock.height.toFloat().coerceAtLeast(100f) +
                    22f * resources.displayMetrics.density
                b.urlPill.animate().translationY(-pillH).setDuration(220)
                    .setInterpolator(AccelerateDecelerateInterpolator()).start()
                b.dock.animate().translationY(dockH).setDuration(260)
                    .setInterpolator(AccelerateDecelerateInterpolator()).start()
            } else if (dy < -8 && pillHidden) {
                pillHidden = false
                b.urlPill.animate().translationY(0f).setDuration(200)
                    .setInterpolator(AccelerateDecelerateInterpolator()).start()
                b.dock.animate().translationY(0f).setDuration(220)
                    .setInterpolator(AccelerateDecelerateInterpolator()).start()
            }
        }

        // Swipe right → back, swipe left → forward (pass-through: WebView still scrolls)
        @SuppressLint("ClickableViewAccessibility")
        w.setOnTouchListener { _, event ->
            gestureDetector.onTouchEvent(event)
            false
        }
    }

    private fun applyForceDark(w: WebView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(
                w.settings,
                if (forceDark) WebSettingsCompat.FORCE_DARK_ON else WebSettingsCompat.FORCE_DARK_OFF,
            )
        }
    }

    // ── Tabs ────────────────────────────────────────────────────────────────
    private fun newTab(url: String) {
        val w = WebView(this)
        configureWebView(w)
        w.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
        )
        b.webContainer.addView(w)
        tabs.add(w)
        switchTab(tabs.size - 1)
        w.loadUrl(url)
    }

    private fun switchTab(i: Int) {
        if (i !in tabs.indices) return
        cur = i
        tabs.forEachIndexed { idx, t -> t.visibility = if (idx == cur) View.VISIBLE else View.GONE }
        b.urlBar.setText(displayUrl(web.url))
        updateTabCount()
        // Always show pill + dock when switching tabs
        pillHidden = false
        b.urlPill.animate().translationY(0f).setDuration(150).start()
        if (!tabSwitcherShown) b.dock.animate().translationY(0f).setDuration(150).start()
    }

    private fun closeTab(i: Int) {
        if (tabs.size == 1) { web.loadUrl(HOME); return }
        val w = tabs.removeAt(i)
        tabTitles.remove(w); desktopTabs.remove(w)
        b.webContainer.removeView(w)
        w.destroy()
        switchTab(if (cur >= tabs.size) tabs.size - 1 else cur.coerceAtMost(tabs.size - 1))
    }

    private fun tabLabel(w: WebView): String {
        val t = tabTitles[w] ?: w.title
        if (!t.isNullOrBlank()) return t
        val u = displayUrl(w.url)
        return if (u.isBlank()) "New Tab" else u
    }

    private fun showTabs() {
        val labels = tabs.mapIndexed { i, w ->
            (if (i == cur) "● " else "○ ") + tabLabel(w).take(40)
        }.toTypedArray()
        AlertDialog.Builder(this, R.style.DhurtaDialog)
            .setTitle("Tabs (${tabs.size})")
            .setItems(labels) { _, i -> switchTab(i) }
            .setPositiveButton("➕ New tab") { _, _ -> newTab(HOME) }
            .setNegativeButton("✕ Close current") { _, _ -> closeTab(cur) }
            .setNeutralButton("Done", null)
            .show()
    }

    private fun updateTabCount() { b.tabCount.text = tabs.size.toString() }

    // ── Tab switcher (Opera-style card overlay) ─────────────────────────────

    private fun wireTabSwitcher() {
        b.tabSwitcherDone.setOnClickListener { hideTabSwitcher() }
        b.tabSwitcherNewTab.setOnClickListener { newTab(HOME); hideTabSwitcher() }
    }

    private fun showTabSwitcher() {
        tabSwitcherShown = true
        b.tabSwitcherTitle.text = "${tabs.size} TAB${if (tabs.size != 1) "S" else ""}"
        b.tabCardList.removeAllViews()
        tabs.forEachIndexed { i, w -> b.tabCardList.addView(buildTabCard(i, w, i == cur)) }
        b.tabSwitcherOverlay.visibility = View.VISIBLE
        b.tabSwitcherOverlay.alpha = 0f
        b.tabSwitcherOverlay.animate().alpha(1f).setDuration(200).start()
        val dockH = b.dock.height.toFloat().coerceAtLeast(100f) +
            22f * resources.displayMetrics.density
        b.dock.animate().translationY(dockH).setDuration(200)
            .setInterpolator(AccelerateDecelerateInterpolator()).start()
    }

    private fun hideTabSwitcher() {
        tabSwitcherShown = false
        b.tabSwitcherOverlay.animate().alpha(0f).setDuration(160)
            .withEndAction { b.tabSwitcherOverlay.visibility = View.GONE }.start()
        b.dock.animate().translationY(0f).setDuration(220)
            .setInterpolator(OvershootInterpolator(1.5f)).start()
    }

    private fun buildTabCard(index: Int, w: WebView, isCurrent: Boolean): LinearLayout {
        val dp = resources.displayMetrics.density
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 16 * dp
            setColor(if (isCurrent) 0xFF131320.toInt() else 0xFF0C0C17.toInt())
            setStroke(
                (if (isCurrent) 2 * dp else dp).toInt(),
                if (isCurrent) 0xFFFF4500.toInt() else 0x1AFFFFFF,
            )
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = bg
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, (68 * dp).toInt(),
            )
            lp.bottomMargin = (10 * dp).toInt()
            layoutParams = lp
            setPadding((14 * dp).toInt(), 0, (8 * dp).toInt(), 0)
            isClickable = true; isFocusable = true
            setOnClickListener { switchTab(index); hideTabSwitcher() }
        }
        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        textCol.addView(TextView(this).apply {
            text = tabLabel(w).take(42)
            textSize = 12f
            setTextColor(if (isCurrent) Color.WHITE else Color.parseColor("#C8CCE8"))
            setTypeface(null, Typeface.BOLD)
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            )
        })
        textCol.addView(TextView(this).apply {
            text = displayUrl(w.url).ifEmpty { "New Tab" }
            textSize = 9f
            setTextColor(if (isCurrent) Color.parseColor("#FF7A2F") else Color.parseColor("#7B81A4"))
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).also { it.topMargin = (3 * dp).toInt() }
        })
        val closeBtn = TextView(this).apply {
            text = "✕"
            textSize = 15f
            setTextColor(Color.parseColor("#7B81A4"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                (40 * dp).toInt(), LinearLayout.LayoutParams.MATCH_PARENT,
            )
            isClickable = true; isFocusable = true
            setOnClickListener {
                closeTab(index)
                if (tabSwitcherShown) showTabSwitcher()
            }
        }
        card.addView(textCol)
        card.addView(closeBtn)
        return card
    }

    // ── dhurta:// internal routes — the mobile equivalent of desktop Omni actions ──
    private fun handleInternal(uri: Uri) {
        when (uri.host ?: uri.schemeSpecificPart.trimStart('/')) {
            "omni" -> web.loadUrl(omniUrl())
            "newtab", "home" -> web.loadUrl(HOME)
            "normal" -> setMode(Mode.NORMAL)
            "chakra-on" -> setMode(Mode.CHAKRA)
            "ghost-on" -> setMode(Mode.GHOST)
            "ghost-off" -> setMode(Mode.NORMAL)
            "rotate" -> rotateCircuit()
            "toggle-af" -> { af = !af; refreshOmni(); refreshSettings() }
            "toggle-rtc" -> { rtc = !rtc; refreshOmni(); refreshSettings() }
            "toggle-ad" -> { ad = !ad; refreshOmni() }
            "autoclean" -> autoClean()
            "wipe" -> nuclearWipe()
            "devtools" -> toggleDevMode()
            "inspect" -> toggleInspector()
            "settings" -> web.loadUrl(settingsUrl())
            "se-brave" -> { searchEngine = "brave"; refreshSettings() }
            "se-google" -> { searchEngine = "google"; refreshSettings() }
            "se-ddg" -> { searchEngine = "ddg"; refreshSettings() }
            "zoom-90" -> setZoom(90)
            "zoom-100" -> setZoom(100)
            "zoom-110" -> setZoom(110)
            "zoom-125" -> setZoom(125)
            "toggle-js" -> {
                jsEnabled = !jsEnabled
                tabs.forEach { it.settings.javaScriptEnabled = jsEnabled }
                refreshSettings()
            }
            "toggle-dark" -> {
                forceDark = !forceDark
                tabs.forEach { applyForceDark(it) }
                refreshSettings()
            }
            "bookmarks" -> showBookmarks()
            "history" -> showHistory()
            "downloads" -> showDownloads()
            "bm-del" -> { deleteBookmark(uri.getQueryParameter("i")?.toIntOrNull() ?: -1); showBookmarks() }
            "hist-clear" -> { prefs.edit().remove("history").apply(); showHistory() }
            "check-update" -> checkForUpdates(silent = false)
            "network" -> showNetworkMonitor()
            "net-clear" -> { synchronized(recentRequests) { recentRequests.clear() }; showNetworkMonitor() }
            "open" -> uri.getQueryParameter("u")?.let { web.loadUrl(it) }
        }
    }

    private fun setZoom(z: Int) {
        textZoom = z
        tabs.forEach { it.settings.textZoom = z }
        refreshSettings()
    }

    private fun refreshSettings() {
        web.url?.let { if (it.contains("settings.html")) web.loadUrl(settingsUrl()) }
    }

    // ── Chrome wiring ───────────────────────────────────────────────────────
    private fun wireChrome() {
        b.urlBar.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) { navigate(b.urlBar.text.toString()); true } else false
        }
        addSpringClick(b.reloadBtn) { web.reload() }
        addSpringClick(b.backBtn) { if (web.canGoBack()) web.goBack() }
        addSpringClick(b.forwardBtn) { if (web.canGoForward()) web.goForward() }
        addSpringClick(b.tabsBtn) { showTabSwitcher() }
        addSpringClick(b.menuBtn) { showMenu(true) }
        b.hubBtn.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
    }

    private fun wireMenu() {
        val hide = { showMenu(false) }
        b.menuOverlay.setOnClickListener { hide() }
        b.menuSheet.setOnClickListener { /* swallow so sheet taps don't dismiss */ }
        b.mExit.setOnClickListener { hide() }
        b.mHome.setOnClickListener { web.loadUrl(HOME); hide() }
        b.mNewTab.setOnClickListener { newTab(HOME); hide() }
        b.mOmni.setOnClickListener { web.loadUrl(omniUrl()); hide() }
        b.mAddBookmark.setOnClickListener { addBookmark(); hide() }
        b.mShare.setOnClickListener { sharePage(); hide() }
        b.mFind.setOnClickListener { showFindBar(); hide() }
        b.mDesktop.setOnClickListener { toggleDesktopSite(); hide() }
        b.mFullscreen.setOnClickListener { toggleFullscreen(); hide() }
        b.mInspect.setOnClickListener { toggleInspector(); hide() }
        b.mBookmarks.setOnClickListener { showBookmarks(); hide() }
        b.mHistory.setOnClickListener { showHistory(); hide() }
        b.mDownloads.setOnClickListener { showDownloads(); hide() }
        b.mAutoClean.setOnClickListener { autoClean(); hide() }
        b.mSettings.setOnClickListener { web.loadUrl(settingsUrl()); hide() }
    }

    private fun showMenu(show: Boolean) {
        if (show) {
            b.menuOverlay.visibility = View.VISIBLE
            b.menuSheet.translationY = 300f
            b.menuSheet.animate().translationY(0f).setDuration(180).start()
            // Desktop-site row reflects the current tab's state.
            b.mDesktop.text = if (web in desktopTabs) "📱  Mobile site" else "🖥  Desktop site"
            b.mFullscreen.text = if (fullscreen) "⛶  Exit fullscreen" else "⛶  Fullscreen"
            b.mInspect.text = if (inspectorOn) "🧪  Close inspector" else "🧪  Inspect element"
        } else {
            b.menuOverlay.visibility = View.GONE
        }
    }

    // ── Find in page ────────────────────────────────────────────────────────
    private fun wireFind() {
        b.findInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                web.findAllAsync(b.findInput.text.toString()); true
            } else false
        }
        b.findInput.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {
                val q = s?.toString() ?: ""
                if (q.isEmpty()) { web.clearMatches(); b.findCount.text = "0/0" }
                else web.findAllAsync(q)
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
        })
        b.findNext.setOnClickListener { web.findNext(true) }
        b.findPrev.setOnClickListener { web.findNext(false) }
        b.findClose.setOnClickListener { hideFindBar() }
    }

    private fun showFindBar() {
        b.findBar.visibility = View.VISIBLE
        b.findInput.requestFocus()
    }

    private fun hideFindBar() {
        b.findBar.visibility = View.GONE
        b.findInput.setText("")
        web.clearMatches()
    }

    // ── Desktop site / fullscreen ──────────────────────────────────────────
    private fun toggleDesktopSite() {
        val s = web.settings
        if (web in desktopTabs) {
            desktopTabs.remove(web)
            s.userAgentString = null   // reset to the WebView default…
            s.userAgentString += MOBILE_UA_SUFFIX
        } else {
            desktopTabs.add(web)
            s.userAgentString = s.userAgentString
                .replace("Android", "X11; Linux x86_64")
                .replace(Regex("Mobile ?"), "")
        }
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        web.reload()
    }

    private fun toggleFullscreen() {
        fullscreen = !fullscreen
        val chrome = listOf(b.urlPill, b.progressBar, b.dock, b.dockSpacer)
        chrome.forEach { it.visibility = if (fullscreen) View.GONE else View.VISIBLE }
        if (fullscreen) b.findBar.visibility = View.GONE
        b.progressBar.visibility = View.GONE
        hideSystemBars(fullscreen)
        if (fullscreen) Toast.makeText(this, "⛶ Fullscreen — back to exit", Toast.LENGTH_SHORT).show()
    }

    private fun hideSystemBars(hide: Boolean) {
        WindowCompat.setDecorFitsSystemWindows(window, !hide)
        val c = WindowInsetsControllerCompat(window, window.decorView)
        if (hide) {
            c.hide(WindowInsetsCompat.Type.systemBars())
            c.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
            c.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    // ── Inspector (on-device inspect element) ──────────────────────────────
    private fun toggleInspector() {
        inspectorOn = !inspectorOn
        injectInspector()   // the script itself toggles: 2nd injection = teardown
        Toast.makeText(
            this,
            if (inspectorOn) "🧪 Inspector ON — tap ◎ Pick, then tap any element" else "Inspector OFF",
            Toast.LENGTH_SHORT,
        ).show()
    }

    private fun injectInspector() {
        val js = assets.open("inspector.js").bufferedReader().use { it.readText() }
        web.evaluateJavascript(js, null)
    }

    // ── Share ──────────────────────────────────────────────────────────────
    private fun sharePage() {
        val url = web.url ?: return
        if (url.startsWith("file://") || url.startsWith(INTERNAL_BASE)) {
            Toast.makeText(this, "Nothing to share on internal pages", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, web.title)
            putExtra(Intent.EXTRA_TEXT, url)
        }, "Share page"))
    }

    // ── Bookmarks / History / Downloads (internal library pages) ───────────
    private fun esc(s: String) = s
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private fun libraryPage(title: String, emoji: String, rows: String, actions: String = "") = """
        <!DOCTYPE html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
        <style>
          body{background:#06060c;color:#e9ecff;font-family:'Segoe UI',system-ui,sans-serif;padding:18px 14px 40px;margin:0}
          h1{font-size:16px;letter-spacing:.15em;color:#ff7a2f;margin:0 0 2px;font-weight:800}
          .sub{font-size:8px;color:#7b81a4;margin-bottom:16px;letter-spacing:.18em}
          .row{display:block;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;
               padding:12px 14px;margin-bottom:10px;text-decoration:none;color:#e9ecff}
          .t{font-size:12px;margin-bottom:4px;word-break:break-all;font-weight:500}
          .u{font-size:9px;color:#22d3ff;word-break:break-all}
          .m{font-size:9px;color:#7b81a4;margin-top:3px}
          .del{color:#ff5470;font-size:10px;float:right;text-decoration:none;padding:2px 8px;
               border:1px solid rgba(255,84,112,.3);border-radius:6px;margin-left:6px}
          .act{display:inline-block;color:#ff5470;font-size:10px;border:1px solid rgba(255,84,112,.3);
               border-radius:8px;padding:8px 14px;text-decoration:none;margin-bottom:14px}
          .empty{color:#7b81a4;font-size:11px;padding:30px 0;text-align:center}
        </style></head><body>
        <h1>$emoji $title</h1><div class="sub">DHURTA LIBRARY</div>
        $actions
        ${if (rows.isBlank()) "<div class=\"empty\">Nothing here yet.</div>" else rows}
        </body></html>
    """.trimIndent()

    private fun loadInternal(html: String) =
        web.loadDataWithBaseURL(INTERNAL_BASE, html, "text/html", "utf-8", null)

    private fun bookmarksJson() = JSONArray(prefs.getString("bookmarks", "[]"))

    private fun addBookmark() {
        val url = web.url ?: return
        if (url.startsWith("file://") || url.startsWith(INTERNAL_BASE)) {
            Toast.makeText(this, "Internal pages can't be bookmarked", Toast.LENGTH_SHORT).show()
            return
        }
        val arr = bookmarksJson()
        for (i in 0 until arr.length()) {
            if (arr.getJSONObject(i).optString("u") == url) {
                Toast.makeText(this, "Already bookmarked", Toast.LENGTH_SHORT).show()
                return
            }
        }
        arr.put(JSONObject().put("t", web.title ?: url).put("u", url))
        prefs.edit().putString("bookmarks", arr.toString()).apply()
        Toast.makeText(this, "⭐ Bookmarked", Toast.LENGTH_SHORT).show()
    }

    private fun deleteBookmark(i: Int) {
        val arr = bookmarksJson()
        if (i in 0 until arr.length()) {
            arr.remove(i)
            prefs.edit().putString("bookmarks", arr.toString()).apply()
        }
    }

    private fun showBookmarks() {
        val arr = bookmarksJson()
        val rows = StringBuilder()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            rows.append(
                "<a class=\"row\" href=\"${esc(o.optString("u"))}\">" +
                    "<a class=\"del\" href=\"dhurta://bm-del?i=$i\">✕ remove</a>" +
                    "<div class=\"t\">${esc(o.optString("t"))}</div>" +
                    "<div class=\"u\">${esc(o.optString("u"))}</div></a>",
            )
        }
        loadInternal(libraryPage("BOOKMARKS", "🔖", rows.toString()))
    }

    private fun recordHistory(url: String, title: String) {
        val arr = JSONArray(prefs.getString("history", "[]"))
        // Skip consecutive duplicates (reloads, redirects).
        if (arr.length() > 0 && arr.getJSONObject(0).optString("u") == url) return
        val out = JSONArray().put(
            JSONObject().put("t", title).put("u", url).put("at", System.currentTimeMillis()),
        )
        for (i in 0 until minOf(arr.length(), 199)) out.put(arr.getJSONObject(i))
        prefs.edit().putString("history", out.toString()).apply()
    }

    private fun showHistory() {
        val arr = JSONArray(prefs.getString("history", "[]"))
        val fmt = java.text.SimpleDateFormat("dd MMM · HH:mm", java.util.Locale.US)
        val rows = StringBuilder()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            rows.append(
                "<a class=\"row\" href=\"${esc(o.optString("u"))}\">" +
                    "<div class=\"t\">${esc(o.optString("t"))}</div>" +
                    "<div class=\"u\">${esc(o.optString("u"))}</div>" +
                    "<div class=\"m\">${fmt.format(java.util.Date(o.optLong("at")))}</div></a>",
            )
        }
        loadInternal(
            libraryPage(
                "HISTORY", "🕑", rows.toString(),
                "<a class=\"act\" href=\"dhurta://hist-clear\">🧹 Clear all history</a>",
            ),
        )
    }

    @SuppressLint("Range")
    private fun showDownloads() {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val rows = StringBuilder()
        dm.query(DownloadManager.Query()).use { c ->
            var n = 0
            while (c.moveToNext() && n < 50) {
                val title = c.getString(c.getColumnIndex(DownloadManager.COLUMN_TITLE)) ?: "download"
                val status = when (c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS))) {
                    DownloadManager.STATUS_SUCCESSFUL -> "✓ done"
                    DownloadManager.STATUS_RUNNING -> "⬇ downloading…"
                    DownloadManager.STATUS_PENDING -> "… queued"
                    DownloadManager.STATUS_PAUSED -> "⏸ paused"
                    else -> "✕ failed"
                }
                val bytes = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val size = if (bytes > 0) "%.1f MB".format(bytes / 1048576.0) else ""
                rows.append(
                    "<div class=\"row\"><div class=\"t\">${esc(title)}</div>" +
                        "<div class=\"m\">$status · $size · saved in Downloads folder</div></div>",
                )
                n++
            }
        }
        loadInternal(libraryPage("DOWNLOADS", "⬇", rows.toString()))
    }

    // ── Drawer ─────────────────────────────────────────────────────────────
    private fun wireDrawer() {
        val close = { b.drawerLayout.closeDrawer(GravityCompat.START) }
        b.navOmni.setOnClickListener { web.loadUrl(omniUrl()); close() }
        b.navNewTab.setOnClickListener { newTab(HOME); close() }
        b.navGhost.setOnClickListener { setMode(if (mode == Mode.GHOST) Mode.NORMAL else Mode.GHOST); web.loadUrl(omniUrl()); close() }
        b.navChakra.setOnClickListener { setMode(if (mode == Mode.CHAKRA) Mode.NORMAL else Mode.CHAKRA); web.loadUrl(omniUrl()); close() }
        b.navSecurity.setOnClickListener { web.loadUrl(omniUrl()); close() }
        b.navNetwork.setOnClickListener { showNetworkMonitor(); close() }
        b.navDevtools.setOnClickListener { toggleDevMode(); close() }
        b.navWipe.setOnClickListener { nuclearWipe(); close() }
        b.navBookmarks.setOnClickListener { showBookmarks(); close() }
        b.navHistory.setOnClickListener { showHistory(); close() }
        b.navDownloads.setOnClickListener { showDownloads(); close() }
        b.navConnect.setOnClickListener { soon("Dhurta Connect"); close() }
        b.navExtensions.setOnClickListener { soon("Extensions"); close() }
        b.navSettings.setOnClickListener { web.loadUrl(settingsUrl()); close() }
        b.navAbout.setOnClickListener { web.loadUrl("https://dhurta.com"); close() }
    }

    private fun wireBack() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    customView != null -> customViewCallback?.onCustomViewHidden()
                    tabSwitcherShown -> hideTabSwitcher()
                    b.menuOverlay.visibility == View.VISIBLE -> showMenu(false)
                    fullscreen -> toggleFullscreen()
                    b.findBar.visibility == View.VISIBLE -> hideFindBar()
                    b.drawerLayout.isDrawerOpen(GravityCompat.START) ->
                        b.drawerLayout.closeDrawer(GravityCompat.START)
                    web.canGoBack() -> web.goBack()
                    tabs.size > 1 -> closeTab(cur)
                    else -> finish()
                }
            }
        })
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
        tabs.forEach { it.clearCache(true); it.clearHistory() }
        CookieManager.getInstance().removeAllCookies(null)
        Toast.makeText(this, "Site data cleared — cookies, cache, history", Toast.LENGTH_SHORT).show()
        refreshOmni()
    }

    private fun nuclearWipe() {
        tabs.forEach { it.clearCache(true); it.clearFormData(); it.clearHistory() }
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        prefs.edit().remove("history").remove("bookmarks").apply()
        Toast.makeText(this, "☢ Nuclear Wipe — all site data destroyed", Toast.LENGTH_LONG).show()
        web.loadUrl(HOME)
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
        web.url?.let { if (it.contains("omni.html")) web.loadUrl(omniUrl()) }
    }

    private fun soon(what: String) =
        Toast.makeText(this, "$what — coming soon", Toast.LENGTH_SHORT).show()

    private fun navigate(raw: String) {
        val input = raw.trim()
        if (input.isEmpty()) return
        val looksLikeUrl = input.contains(".") && !input.contains(" ")
        val target = when {
            input.startsWith("http://") || input.startsWith("https://") -> input
            input.startsWith("dhurta://") -> { handleInternal(Uri.parse(input)); b.urlBar.clearFocus(); return }
            looksLikeUrl -> "https://$input"
            else -> searchUrl(input)
        }
        web.loadUrl(target)
        b.urlBar.clearFocus()
    }

    private fun searchUrl(q: String) = when (searchEngine) {
        "google" -> "https://www.google.com/search?q=" + Uri.encode(q)
        "ddg" -> "https://duckduckgo.com/?q=" + Uri.encode(q)
        else -> "https://search.brave.com/search?q=" + Uri.encode(q)
    }

    private fun displayUrl(url: String?): String = when {
        url == null -> ""
        url.startsWith("file:///android_asset") -> ""
        url.startsWith(INTERNAL_BASE) -> ""
        url.startsWith("data:") -> ""
        else -> url
    }

    private fun updateBadge() {
        val colorRes = if (protectedNow) R.color.protected_green else R.color.exposed_red
        val color = ContextCompat.getColor(this, colorRes)
        b.lockIcon.setImageResource(
            if (protectedNow) R.drawable.ic_nav_lock else R.drawable.ic_nav_lock_open,
        )
        b.lockIcon.imageTintList = ColorStateList.valueOf(color)
    }

    // ── Network Monitor ─────────────────────────────────────────────────────
    private fun showNetworkMonitor() {
        val snap: List<String>
        synchronized(recentRequests) { snap = recentRequests.take(150).toList() }
        loadInternal(networkPage(snap))
    }

    private fun networkPage(requests: List<String>): String {
        val rows = if (requests.isEmpty()) {
            "<div class=\"empty\">No requests captured yet — browse a few pages first.</div>"
        } else {
            requests.joinToString("") { req ->
                val spaceIdx = req.indexOf(' ')
                val method = if (spaceIdx > 0) req.substring(0, spaceIdx) else req
                val host = if (spaceIdx > 0) esc(req.substring(spaceIdx + 1)) else ""
                val cls = when (method) { "POST" -> "post"; "GET" -> "get"; else -> "other" }
                "<div class=\"nrow\"><span class=\"m $cls\">${esc(method)}</span><span class=\"host\">$host</span></div>"
            }
        }
        return """
            <!DOCTYPE html><html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
            <style>
              body{background:#06060c;color:#e9ecff;font-family:'Consolas',monospace;padding:18px 14px 40px;margin:0}
              h1{font-size:15px;letter-spacing:.2em;color:#ff7a2f;margin:0 0 2px;font-weight:800}
              .sub{font-size:8px;color:#7b81a4;margin-bottom:16px;letter-spacing:.2em}
              .cnt{font-size:9px;color:#7b81a4;margin-bottom:12px}
              .nrow{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:10px}
              .m{width:42px;flex:0 0 auto;text-align:center;padding:2px 0;border-radius:4px;font-size:8px;font-weight:700;letter-spacing:.05em}
              .get{background:rgba(34,211,255,.12);color:#22d3ff;border:1px solid rgba(34,211,255,.25)}
              .post{background:rgba(255,122,47,.12);color:#ff7a2f;border:1px solid rgba(255,122,47,.25)}
              .other{background:rgba(168,85,247,.12);color:#a855f7;border:1px solid rgba(168,85,247,.25)}
              .host{color:#c8cce8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              .empty{color:#7b81a4;font-size:11px;padding:30px 0;text-align:center}
              .act{display:inline-block;color:#ff5470;font-size:10px;border:1px solid rgba(255,84,112,.3);border-radius:8px;padding:8px 14px;text-decoration:none;margin-right:8px;margin-bottom:16px}
              .back{display:inline-block;color:#22d3ff;font-size:10px;border:1px solid rgba(34,211,255,.3);border-radius:8px;padding:8px 14px;text-decoration:none;margin-bottom:16px}
            </style></head><body>
            <h1>🌐 NETWORK MONITOR</h1>
            <div class="sub">DATA LEAVING THIS DEVICE · LIVE SESSION LOG</div>
            <div>
              <a class="back" href="dhurta://newtab">‹ Home</a>
              <a class="act" href="dhurta://net-clear">🧹 Clear log</a>
            </div>
            <div class="cnt">${requests.size} request(s) captured this session</div>
            $rows
            </body></html>
        """.trimIndent()
    }

    // ── OTA Self-Update ─────────────────────────────────────────────────────

    private fun checkForUpdates(silent: Boolean) {
        lifecycleScope.launch {
            prefs.edit().putLong("last_update_check", System.currentTimeMillis()).apply()
            val info = UpdateChecker.check(BuildConfig.VERSION_NAME)
            if (info == null) {
                if (!silent) {
                    Toast.makeText(
                        this@MainActivity,
                        "✓ Dhurta is up to date (${BuildConfig.VERSION_NAME})",
                        Toast.LENGTH_SHORT,
                    ).show()
                }
                return@launch
            }
            val sizeMb = if (info.sizeBytes > 0) " · %.1f MB".format(info.sizeBytes / 1_048_576.0) else ""
            AlertDialog.Builder(this@MainActivity, R.style.DhurtaDialog)
                .setTitle("Update — ${info.tagName}")
                .setMessage(
                    "A newer version is available.\n\n" +
                        "Installed : ${BuildConfig.VERSION_NAME}\n" +
                        "Latest    : ${info.versionName}\n\n" +
                        "File: ${info.assetName}$sizeMb\n\n" +
                        "Download and install now?",
                )
                .setPositiveButton("⬇  Download & Install") { _, _ -> downloadUpdate(info) }
                .setNegativeButton("Later", null)
                .show()
        }
    }

    private fun downloadUpdate(info: UpdateChecker.UpdateInfo) {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val req = DownloadManager.Request(Uri.parse(info.downloadUrl)).apply {
            setTitle("Dhurta ${info.tagName}")
            setDescription("Downloading update…")
            setMimeType("application/vnd.android.package-archive")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, info.assetName)
        }
        updateDownloadId = dm.enqueue(req)
        Toast.makeText(this, "⬇ Downloading ${info.tagName}…", Toast.LENGTH_SHORT).show()

        // Listen for completion — unregisters itself after firing
        updateReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                if (id == updateDownloadId) {
                    unregisterReceiver(this)
                    updateReceiver = null
                    installDownloadedApk(id)
                }
            }
        }
        registerReceiver(updateReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
    }

    private fun installDownloadedApk(downloadId: Long) {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val uri = dm.getUriForDownloadedFile(downloadId) ?: run {
            Toast.makeText(this, "Download failed — try again", Toast.LENGTH_SHORT).show()
            return
        }
        // Android 8+ requires the user to allow unknown-source installs for this app
        if (!packageManager.canRequestPackageInstalls()) {
            Toast.makeText(
                this,
                "Enable 'Install unknown apps' for Dhurta in Settings, then run the APK from Downloads",
                Toast.LENGTH_LONG,
            ).show()
            startActivity(
                Intent(
                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName"),
                ),
            )
            return
        }
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                },
            )
        } catch (e: Exception) {
            Toast.makeText(this, "Could not open installer: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    // ── Animation helpers ───────────────────────────────────────────────────

    /** Spring-scale feedback on dock/chrome button taps. */
    private fun addSpringClick(view: View, action: () -> Unit) {
        view.setOnClickListener {
            view.animate().scaleX(0.82f).scaleY(0.82f).setDuration(80).withEndAction {
                view.animate().scaleX(1f).scaleY(1f).setDuration(180)
                    .setInterpolator(OvershootInterpolator(2.5f)).start()
            }.start()
            action()
        }
    }

    /** Swipe-right = back, swipe-left = forward on the active WebView. */
    private fun setupGestures() {
        gestureDetector = GestureDetectorCompat(
            this,
            object : GestureDetector.SimpleOnGestureListener() {
                private val MIN_DIST = 110f
                private val MIN_VEL = 280f

                override fun onFling(
                    e1: MotionEvent?,
                    e2: MotionEvent,
                    vX: Float,
                    vY: Float,
                ): Boolean {
                    if (e1 == null) return false
                    val dX = e2.x - e1.x
                    val dY = e2.y - e1.y
                    if (abs(dX) < abs(dY) * 1.4f) return false  // mostly vertical — let WebView scroll
                    if (abs(dX) < MIN_DIST || abs(vX) < MIN_VEL) return false
                    return if (dX > 0 && web.canGoBack()) {
                        web.goBack(); true
                    } else if (dX < 0 && web.canGoForward()) {
                        web.goForward(); true
                    } else false
                }
            },
        )
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

    /** Pop-up video: leaving the app while HTML5 video is fullscreen floats it
     *  in a picture-in-picture window over the home screen / other apps. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (customView != null) {
            try {
                enterPictureInPictureMode(
                    android.app.PictureInPictureParams.Builder()
                        .setAspectRatio(android.util.Rational(16, 9))
                        .build(),
                )
            } catch (e: Exception) {
                // Device may not support PiP — nothing to do.
            }
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: android.content.res.Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        // When the floating window is dismissed, drop back out of video fullscreen.
        if (!isInPictureInPictureMode && customView != null && !fullscreen) {
            customViewCallback?.onCustomViewHidden()
        }
    }

    override fun onDestroy() {
        updateReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        tabs.forEach { it.destroy() }
        super.onDestroy()
    }
}

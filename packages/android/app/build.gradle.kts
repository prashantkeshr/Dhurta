plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "express.hyperlocal.dhurta"
    compileSdk = 34

    defaultConfig {
        applicationId = "express.hyperlocal.dhurta"
        minSdk = 26            // Android 8.0 — required for VpnService always-on + modern Gecko
        targetSdk = 34
        versionCode = 10400    // 1.4.0
        versionName = "1.4.0"  // aligned to package.json

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    // GeckoView ships the full Firefox engine as native .so per ABI (~150 MB
    // each). A universal APK bundling arm64 + armv7 + x86 + x86_64 was ~635 MB,
    // which is why it failed to install. Split per-ABI so each APK carries only
    // one architecture: arm64-v8a for real phones (incl. the POCO), x86_64 for
    // the CI emulator. No universal APK — nothing needs all four at once.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
        // Compress the native libs in the APK (smaller download; extracted on
        // install). GeckoView libs dominate the size, so this helps materially.
        jniLibs.useLegacyPackaging = true
    }
}

dependencies {
    // ── Engine: Android System WebView (Chromium) ──
    // Same engine family as the Electron desktop, so behaviour matches. It's
    // part of the OS (nothing to bundle → tiny APK) and can't be low-memory-
    // killed the way the bundled GeckoView engine was. androidx.webkit adds the
    // modern WebView APIs (proxy override, safe-browsing toggles) we layer the
    // privacy features onto later.
    implementation("androidx.webkit:webkit:1.11.0")
    // Slide-out sidebar drawer.
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")

    // ── AndroidX core + lifecycle ──
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-service:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.6")

    // ── Room persistence (thread-safe migrations) ──
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // ── Kotlin coroutines (structured async) ──
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // ── Tor for Android (embedded onion routing) ──
    // Guardian Project's tor-android-binary ships the tor binary as libtor.so in
    // the APK's native lib dir; TorProcess.kt launches that binary directly and
    // parses its stdout, so only the binary (not any Java control API) is needed.
    // 0.4.4.6 is the newest version actually published to gpmaven. jtorctl is not
    // in that repo and is unused (bootstrap is read from stdout), so it's dropped.
    implementation("org.torproject:tor-android-binary:0.4.4.6")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}

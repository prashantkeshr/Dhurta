# GeckoView + Tor host — keep engine, JNI, and service entry points.
-keep class org.mozilla.geckoview.** { *; }
-keep class org.torproject.** { *; }
-keep class info.guardianproject.** { *; }
-keep class express.hyperlocal.dhurta.net.** { *; }
-keepclassmembers class * { native <methods>; }
-dontwarn org.mozilla.geckoview.**

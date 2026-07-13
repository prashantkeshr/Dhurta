pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Mozilla Maven — GeckoView artifacts
        maven { url = uri("https://maven.mozilla.org/maven2/") }
        // Guardian Project — tor-android binaries
        maven { url = uri("https://raw.githubusercontent.com/guardianproject/gpmaven/master") }
    }
}

rootProject.name = "DhurtaAndroid"
include(":app")

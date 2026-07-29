plugins {
    id("com.android.application")
}

// The web app is the single source of truth at the repo root; copy it into the
// APK's assets at build time rather than keeping a second copy under android/.
val syncWebAssets = tasks.register<Copy>("syncWebAssets") {
    from(rootProject.file("../assets")) { include("index.html") }
    into(layout.buildDirectory.dir("generated/webassets"))
}

android {
    namespace = "com.moushana.javaprep"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.moushana.javaprep"
        minSdk = 24
        targetSdk = 35
        versionCode = (project.findProperty("appVersionCode") as String? ?: "1").toInt()
        versionName = project.findProperty("appVersionName") as String? ?: "1.0"
    }

    // Populated from environment variables in CI. When they are absent (a plain
    // local build) the release variant falls back to debug signing below, which
    // still produces a v2/v3-signed, zipaligned APK — just not with a stable key.
    val keystorePath = System.getenv("KEYSTORE_PATH")
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }

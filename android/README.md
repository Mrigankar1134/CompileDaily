# Compile Daily — Android app

A thin WebView shell around `assets/index.html` (the repo root copy is the
single source of truth; `app/build.gradle.kts` copies it into the APK at build
time). The app talks to the backend at `https://compiledaily.onrender.com`.

This replaces the old `build_apk.py`, which hand-assembled a DEX, a minimal
`resources.arsc` and a v1-only `jarsigner` signature. That APK failed to
install on modern Android: no APK Signature Scheme v2/v3 block, and
`resources.arsc` was not 4-byte aligned. The Gradle build handles both.

## Building

You do not need a local Android SDK — CI builds it. Push to `main`, or run the
**Build Android APK** workflow manually, then download the `CompileDaily-apk`
artifact from the run.

To build locally instead, you need JDK 17 and the Android SDK:

```
cd android
gradle assembleRelease        # or ./gradlew if you add a wrapper
```

Output: `app/build/outputs/apk/release/app-release.apk`.

Without signing credentials the release build falls back to debug signing. That
APK installs fine, but its signature changes on every machine, so it cannot
update an existing install.

## Signing

Release builds read four repository secrets:

| Secret | Purpose |
| --- | --- |
| `KEYSTORE_BASE64` | base64 of the PKCS12 keystore |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | key alias |
| `KEY_PASSWORD` | key password |

Set the last three, then run the **Generate signing keystore (one-time)**
workflow once to produce the first. Back that value up offline — Android will
not install an update signed with a different key.

## Installing

Sideloading still shows a Play Protect warning ("unsafe app blocked"), because
the app is not distributed through Play. Tap **Install anyway** — the `OK`
button cancels the install.

If you previously tried to install a `build_apk.py` APK, uninstall any leftover
`com.moushana.javaprep` first; the signatures differ.

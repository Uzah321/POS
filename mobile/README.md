# Core POS for Android

The till app for Android handhelds (Sunmi V2 and similar), written in Flutter. It
signs in to a Core site's API (`https://msilisi.mycorre.com` unless changed on the
sign-in screen) and prints receipts on the device's built-in printer:

- **Sunmi** handhelds: through Sunmi's printer service (`com.sunmi:printerlibrary`),
  found automatically — see `android/app/src/main/kotlin/.../MainActivity.kt`.
- **Other handhelds**: through the RawBT app, if installed.

Receipts are the same ESC/POS layout the web till prints (`lib/printing/receipt.dart`
is a port of `frontend/src/lib/hardware/printer.ts`).

Runs on **Android 6.0 and newer** (`handheldMinSdk = 23` in `android/app/build.gradle.kts`,
with v1 + v2 signatures). Sunmi handhelds still run 6.0 and 7.1, and an APK asking for more
fails to install with "There was a problem parsing the package". For the same reason the
app saves its settings through its own channel (`lib/core/store*.dart`), not the
shared_preferences plugin, which needs Android 7.

On old handheld GPUs it draws with Skia rather than Impeller (`EnableImpeller` = false in
the manifest). If the app ever closes unexpectedly, the next start shows why, with the
device model and Android version, before opening the till (`StartupGuard.kt`,
`LaunchActivity.kt`) — ask for a photo of that screen.

What it does: sign in, sell (search, categories, camera barcode scan, weighed items),
cash / card / mobile money with change, receipt printing (fiscal QR included), recent
sales and reprints, till and currency choice. Back-office work stays on the website.

## Releasing a new version

1. Raise `version:` in `pubspec.yaml` (e.g. `1.0.1+2` — the number after `+` must go up,
   or Android won't install it over the old one) and `appVersion` in
   `lib/ui/settings_screen.dart`.
2. Build with **Flutter 3.38.x** (JDK 17+ in `JAVA_HOME`) — not newer: from 3.41 Flutter's
   engine calls an Android 7-only method on start (`Configuration.getLocales()` in
   `LocalizationPlugin`), so the app installs on a Sunmi V1s (Android 6) and closes at once.
   On the build PC that SDK is `C:\Users\dingulwazi.zondo\dev\flutter-3.38`:

   ```
   C:\Users\dingulwazi.zondo\dev\flutter-3.38\bin\flutter test
   C:\Users\dingulwazi.zondo\dev\flutter-3.38\bin\flutter build apk --release --target-platform android-arm
   ```

3. Copy `build/app/outputs/flutter-apk/app-release.apk` to
   `backend/resources/downloads/core-pos.apk`, commit, push and update the server.
   Tills download it from "Add Core to this device" (`/api/download/core-pos.apk`).

### The signing key

Android only installs an update over the app already on a till when both are signed
with the same key. Release builds are signed with the key named in
`android/key.properties` (not committed; it points to `core-pos-release.jks`). **Keep a
backup of both files somewhere safe** — without them, an update can only be installed
after uninstalling the old app. Without `key.properties` the build falls back to the
computer's debug key.

## Trying it in a browser

`flutter build web` gives the same screens in a browser (no printing or camera there),
served from the Core site so `/api` is on the same address — handy for checking the
screens and the sale flow without a device.

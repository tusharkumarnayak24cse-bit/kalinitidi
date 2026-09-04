# Kaali Ni Tidi — Android App Setup

This version is prepared to become a native Android app using Capacitor.

## Multiplayer backend

The app connects to:

https://three-spades.onrender.com

Your Render server stays online and handles rooms, bots, bidding, turns and Socket.IO multiplayer.

## Requirements on your Mac

Install:
1. Node.js
2. Android Studio
3. Android SDK through Android Studio

## Fast setup

Open Terminal inside this project folder and run:

```bash
npm install
npx cap add android
npx cap sync android
npx cap open android
```

Or on macOS, double-click `setup-android.command`. If macOS blocks it, right-click → Open.

## Test on Android phone

In Android Studio:
1. Connect the Android phone with USB.
2. Enable Developer Options and USB debugging.
3. Select the phone at the top of Android Studio.
4. Press Run ▶.

## Create a test APK

In Android Studio use:

Build → Build App Bundle(s) / APK(s) → Build APK(s)

The debug APK is normally created under:

android/app/build/outputs/apk/debug/app-debug.apk

## Create a Play Store build

Use:

Build → Generate Signed Bundle / APK → Android App Bundle

Choose Android App Bundle (AAB), create or select your signing key, and build the release bundle.

Keep the signing key safe. You need the same key for future updates.

## Important

This source uses a real HTTPS Render backend. The frontend is bundled inside the Android app, while multiplayer communication goes to the Render Socket.IO server.

Before publishing, add:
- App icon
- Splash screen
- Privacy policy
- Redis/shared room persistence for restart recovery (same-seat browser reconnect is already included in v9)
- Crash/error logging
- Store screenshots

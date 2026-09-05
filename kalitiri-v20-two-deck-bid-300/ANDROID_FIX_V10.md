# Android v10 fix

This build fixes the packaged Android app not starting games or saving profile data.

## What was fixed
- Capacitor Android uses `https://localhost` for bundled assets. The client now detects that as a packaged app and connects Socket.IO to `https://three-spades.onrender.com`.
- The Socket.IO browser client is loaded from the live game backend instead of `/socket.io/socket.io.js` on the device.
- Profile name/avatar are persisted when creating or joining a room, in addition to the Save Profile button.
- TypeScript is included as a dev dependency for `capacitor.config.ts`.

## Rebuild after replacing the project
```bash
npm install
npx cap sync android
npx cap open android
```

Then in Android Studio use **Build > Build App Bundle(s) / APK(s) > Build APK(s)**.

If you already have an older APK installed, uninstall it first or clear its app storage before testing v10.

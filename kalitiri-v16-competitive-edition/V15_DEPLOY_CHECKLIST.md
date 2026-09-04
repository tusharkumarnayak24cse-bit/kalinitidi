# v15 deployment checklist

1. Deploy the full project to the same Render service used by the Android app, or update `public/config.js` if the backend URL changes.
2. Keep `TURN_TIMEOUT_MS=60000`.
3. Keep `RECONNECT_GRACE_MS=90000`.
4. For restart recovery, attach a persistent disk and set `PERSISTENCE_FILE=/var/data/kalitiri-state.json`.
5. For reliable mobile voice, configure `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL`.
6. Test Quick Match with two real devices.
7. Test Ready and Rematch with multiple players.
8. Test one player disconnecting for under 90 seconds and reconnecting to the same seat.
9. Test a disconnect lasting over 90 seconds and verify permanent bot takeover.
10. Test public-room Join, Spectate, Mute, Report, and host Remove.
11. Complete at least one full 4-player and one 8-player match.
12. Rebuild Android after `npx cap sync android`.
13. Uninstall older debug APKs before testing a new debug APK.
14. For Play Store distribution, create a signing keystore and build a signed Android App Bundle (AAB).

# 60-second action timer

This build changes the authoritative action timer from 30 seconds to 60 seconds.

It applies to:
- bidding turns
- Hukum / hidden-partner selection
- card-play turns

The server default is `TURN_TIMEOUT_MS=60000`, and `render.yaml` also sets `60000`.

After deploying the server update, run `npx cap sync android` before rebuilding the APK so the Android UI also shows 60 seconds.

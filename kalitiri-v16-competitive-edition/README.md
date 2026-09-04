# Kaali Ni Tidi v16 — Competitive Edition

The v15 public-ready game plus accounts, ranked seasons, friends/invites, achievements, daily challenges, replay history, tournaments, private PIN rooms, AFK Bot Assist, ranked spectator delay, themes/card backs/accessibility, bot personalities, admin analytics, optional Redis Socket.IO adapter, and English/Gujarati/Hindi core UI.

## Run
```bash
npm install
npm start
```

## Android
```bash
npm install
npx cap sync android
npx cap open android
```

Android package: `com.kaalinitidi.game`, version 1.6 (code 4).

## Recommended Render variables
`TURN_TIMEOUT_MS=60000`
`RECONNECT_GRACE_MS=90000`
`PERSISTENCE_FILE=/var/data/kalitiri-state.json`
`ACCOUNTS_FILE=/var/data/kalitiri-accounts.json`
`ADMIN_KEY=<strong-random-secret>`
`SPECTATOR_DELAY_MS=5000`
Optional: `REDIS_URL`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`, `REGION_ID`.

See V16_COMPETITIVE_EDITION.md for feature notes and external-service requirements.

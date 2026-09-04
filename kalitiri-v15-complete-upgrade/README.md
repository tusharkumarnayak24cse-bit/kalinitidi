# Kaali Ni Tidi v15 — Complete Public Upgrade

This build keeps the existing rules, realistic table, Android fix, 60-second authoritative turn timer, no-wallet setup, two-decks-after-4-players rule, multiplayer, bots, voice, reconnect, and animations.

## New in v15

- Quick Match: finds an open public table or creates one.
- Public room browser: shows open tables and games that can be watched.
- Ready system: every connected human presses Ready before the host starts.
- Rematch voting: all connected humans can request a rematch; unanimous rematch starts the next round automatically.
- Practice mode: creates a 4-player private table and fills empty seats with easy bots.
- First-launch tutorial: explains bidding, Hukum, hidden partners, follow-suit play, and scoring.
- Bot difficulty: Easy / Normal / Hard.
- Player stats: local wins, losses, win rate, points earned, and recent-round history.
- Public leaderboard: nickname/avatar based leaderboard from completed rounds.
- Spectator mode: watch a room by code or from the public table browser.
- Public-table moderation: host remove, local chat mute, per-player voice mute, and player report.
- Network quality indicator: live Socket.IO ping in milliseconds.
- Reconnect countdown: a disconnected seat is held for 90 seconds before permanent bot takeover.
- Optional room persistence: active room snapshots can survive Node restarts when `PERSISTENCE_FILE` points to a persistent disk.
- TURN-ready voice: optional TURN credentials can be supplied by environment variables.
- Client error reporting: browser/Android runtime errors are sent to server logs with rate limits.
- Android haptics and microphone permissions.

## Existing rules kept

- 4 players: 1 full deck, 13 cards each.
- 5 players: 2 reduced decks, 16 cards each.
- 6 players: 2 reduced decks, 16 cards each.
- 7 players: 2 reduced decks, 8 cards each.
- 8 players: 2 full decks, 13 cards each.
- Human action timeout: 60 seconds.
- No wallet, deposits, cash-out, betting, or real-money system.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Android

The Android project is already included. After changing web files, run:

```bash
npm install
npx cap sync android
npx cap open android
```

In Android Studio use **Build > Clean Project**, then **Build > Rebuild Project**, then **Build APK(s)**.

The debug APK is normally created at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Render / production environment

Required/recommended:

```text
NODE_ENV=production
TURN_TIMEOUT_MS=60000
RECONNECT_GRACE_MS=90000
```

Optional persistence (requires a persistent disk):

```text
PERSISTENCE_FILE=/var/data/kalitiri-state.json
```

Optional TURN relay for more reliable voice:

```text
TURN_URL=turn:your-turn-server.example.com:3478
TURN_USERNAME=your-user
TURN_CREDENTIAL=your-password
```

If you use a custom web domain, set `ALLOWED_ORIGINS` to that domain.

## Important production notes

- The server remains authoritative for bids, contract choices, legal-card validation, scoring, turn order, and timeouts.
- The global leaderboard is nickname/avatar based; there is no account authentication yet.
- File persistence only survives host restarts if the file is on persistent storage. Render free ephemeral storage does not guarantee this.
- A signed Play Store AAB/APK still requires your own Android signing keystore.

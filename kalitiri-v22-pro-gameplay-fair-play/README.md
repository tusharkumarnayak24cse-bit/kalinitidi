# Kaali Ni Tidi v22 — Pro Gameplay + Fair Play Edition

This build upgrades v21 without changing the current 3–8 player rules, 4-player one/two-deck option, or point values.

### v22 highlights
- Legal-card highlighting with optional tap-select + **Play Card** confirmation.
- Full bid history, last-five trick history, and a complete Match Audit review.
- Cryptographically secure server-only shuffle, duplicate/missing-card integrity checks, score verification and safe score-state recovery.
- Unique Audit ID for every round.
- Live Bidder-vs-Defense score race, contract target progress, danger state, trick +points, winner highlight, MVP and shareable result.
- Sort by suit/rank/points/Hukum plus existing manual hand order.
- Reconnect recap, AFK countdown, action locking, Android leave/back protection and screen wake lock where supported.
- Host presets, 30/45/60/90 second timers and 0/5/10 second spectator delay choices.
- Data Saver / Performance mode reduces heavy effects and trims live history payloads.
- Android version **2.2** (versionCode **10**).

See `V22_PRO_GAMEPLAY_FAIR_PLAY.md` for details.

---

## v21 update
4-player rooms may now choose 1 or 2 decks, and the game displays a detailed live point table. See `V21_4P_DOUBLE_DECK_POINTS.md`.

# Kaali Ni Tidi v20

## v20 — Two-deck bidding starts at 300
- Every **2-deck** table (5, 6, 7 and 8 players) now starts bidding at **300**.
- Maximum bid remains **500**.
- Minimum bid increase remains **+5**.
- 3- and 4-player one-deck modes keep their existing **150–250** range.

**Human-required room behavior:** bot-only matches no longer continue. When all real players are offline, play pauses; when no real player can return, the room closes automatically.

# Kaali Ni Tidi v17 — Controlled Play Edition

This build keeps the v16 competitive/tournament features and improves live card-table pacing.

## v17 gameplay changes

- Completed tricks remain face-up on the table for about **3.8 seconds** before the next trick starts.
- A permanent **Previous trick** strip shows the last trick's cards, winner, and points during the next trick.
- Bot actions are slowed to about **1.4 seconds** by default instead of firing almost instantly.
- The hand no longer replays its deal/shuffle animation after every state update. The deal animation runs once per new round.
- Players can choose their own card order with **Arrange**. On phones, tap one card and then tap its new position. On desktop, drag-and-drop also works.
- **Auto sort** restores suit/rank order at any time.
- No move can be made while a completed trick is in the review pause.
- Existing 60-second human turn timer is unchanged.

### Render settings

```text
TURN_TIMEOUT_MS=60000
BOT_ACTION_DELAY_MS=1400
TRICK_REVIEW_MS=3800
RECONNECT_GRACE_MS=90000
```

Android package: `com.kaalinitidi.game`, version **1.7** (code **5**).

---

## Features carried forward from v16


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



## Recommended Render variables
`TURN_TIMEOUT_MS=60000`
`RECONNECT_GRACE_MS=90000`
`PERSISTENCE_FILE=/var/data/kalitiri-state.json`
`ACCOUNTS_FILE=/var/data/kalitiri-accounts.json`
`ADMIN_KEY=<strong-random-secret>`
`SPECTATOR_DELAY_MS=5000`
Optional: `REDIS_URL`, `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`, `REGION_ID`.

See V16_COMPETITIVE_EDITION.md for feature notes and external-service requirements.


## v19 — 3-player support
- Supported table sizes are now **3–8 players**.
- 3-player custom variant uses one reduced deck with all 2s removed: **48 cards, 16 each, 250 total points**.
- The bidder calls **1 hidden partner**, producing a 2-vs-1 team after reveal.
- Create Room, Quick Match, Ranked, public rooms, bots, reconnect and Android all accept 3-player tables.

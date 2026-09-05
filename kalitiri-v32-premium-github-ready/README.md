# Kaali Ni Tidi — v33 Ultimate Premium Edition

**3♠ multiplayer for 3–8 players.** v33 combines the premium table, competitive systems, live voice, cinematic match flow, XP/ranks/missions, QR invites, replay/audit, tournaments, PWA installability and release moderation.

See `V33_ULTIMATE_PREMIUM.md` for the v33 feature list and invariants.

# Kaali Ni Tidi v33 — Premium Edition

## v33 Premium upgrade
- Luxury black/gold/emerald visual system across lobby, game table, cards, controls and results.
- Premium startup splash and branding.
- Cleaner competitive HUD with live-table treatment, stronger hierarchy and glass panels.
- Upgraded card depth, legal-card glow, trick presentation, seats, timers and voice controls.
- Premium responsive layout keeps the hand as the highest-priority gameplay surface, including 26-card 4P double-deck games.
- Enhanced Classic Green, Dark, Royal Blue and Red Felt room themes.
- Premium winner presentation, modal styling, forms, buttons, score tables and mobile controls.
- All v31 gameplay systems remain: push-to-talk/open mic voice, best-of series, score ledger, last trick, reconnect snapshot, fair-play audit, fixed/random teams and direct card play.
- Android version 3.3 / versionCode 20.

# Kaali Ni Tidi v31 — Clean Table + Competitive Match Edition

## v31 highlights
- Compact Game Mode keeps the live table large and collapses chat/history/log while playing.
- Bottom-hand priority plus adaptive card sizing keeps large 26-card hands usable.
- Voice supports Open Mic and Push-to-Talk, auto-reconnect, speaking rings, echo cancellation, noise suppression and automatic gain control where supported.
- Private rooms can choose Single / Best of 3 / Best of 5, random partners or fixed teams (4/6/8 players), voice, spectators, timers and shared table themes.
- Series scoreboard, contract-progress meter, bid mini-strip, Last Trick review and full trick-by-trick score ledger.
- End-of-round winner celebration, same-team rematch, detailed winner/loser tables and a Fair Play receipt with audit/deck/score verification.
- Match settings include card size, Card/Alert/Voice volume, PTT mode, voice auto-reconnect and vibration.
- Existing 3–8 player rules, 4P one/two-deck choice, hidden partner-card reveal, direct legal-card play and 300–500 two-deck bidding remain unchanged.

## v28 — Final winner/loser result table
- Round end now shows separate WINNERS and LOSERS tables.
- Each player row shows role, captured points, round award and scoring cards captured.
- Each team shows its proper total points and all point cards captured.
- Bid, contract result and total-points audit remain visible.

# Kaali Ni Tidi v26

## v26 — Hukum + partner-card start display
- When bidding/contract selection ends, the game clearly shows the bidder's chosen Hukum (for example, ♠ Spades).
- The partner section shows only the called partner card(s).
- No partner name is shown until the exact called card is actually played.
- Once that card is played, a “Partner Revealed” banner shows the player name.


## v25 — Partner Card Call shown clearly at start of play
- After the winning bidder locks Hukum and partner card(s), every player sees a prominent PARTNER CALL banner before/while the first trick starts.
- The banner names the bidder and shows the exact called partner card(s), including Deck 1 / Deck 2 for double-deck games.
- It clearly explains that whoever holds the called card is on the bidder team and stays hidden until that exact card is played.
- The called-card summary remains visible during play.

# Kaali Ni Tidi v24

## v24 — Full hand visibility
- Automatically compresses card overlap so the full hand stays visible.
- 4-player 2-deck hands with 26 cards now fit the table width on desktop/landscape.
- Dense mobile hands use smaller cards and adaptive overlap.
- Recalculates after resize/orientation changes.
- Horizontal scrolling is used only as a last-resort fallback.

# Kaali Ni Tidi v23

## v23 — Partner Call + Final Winner Points
- The bidder explicitly chooses the exact card(s) that call the hidden partner(s).
- The live table shows the bidder, called partner card(s), and revealed partner name(s).
- Bidder + partner(s) win when their combined captured points are **at least the bid**.
- If they finish below the bid, the opposite/defense team wins.
- The final result shows both teams, player names, exact points, scoring-card breakdown, captured point-card chips, called partner card → partner mapping, and a total-point audit.

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
# Kaali Ni Tidi v22 — Pro Gameplay + Fair Play

## Added
- Full bid history and last-five trick history.
- Legal-move emphasis plus optional tap-select / Play Card confirmation.
- Server-confirmed action lock to prevent duplicate bid/pass/play requests.
- Winning-card highlight and live trick points.
- Bidder-vs-defense contract progress with danger warning.
- Sort hand by suit, rank, scoring points, or Hukum first; manual ordering remains available.
- Reconnect catch-up showing tricks missed while offline.
- AFK takeover warning before the third missed turn enables Bot Assist.
- Data Saver / older-phone Performance mode: disables heavy effects and asks the server for shorter bid/trick/chat/log history payloads.
- Landscape full-screen request, screen wake lock, and live-match leave protection where supported.
- Cryptographically secure server-side Fisher-Yates shuffle.
- Deal integrity and score integrity checks.
- Unique round Audit ID shown in the game and result summary.
- Host presets, 30/45/60/90 second private-room timers, and spectator delay choices.
- High-latency server status warning.
- End-of-round MVP summary and shareable result text.

## Existing v21 rules preserved
- 3–8 players.
- 4 players can choose 1 deck (250 pts, bid 150–250) or 2 decks (500 pts, bid 300–500).
- All other 2-deck modes bid 300–500.
- 60-second default timer, slower trick review, manual hand arrangement, human-required rooms, competitive systems, voice, reconnect and Android support remain.


## Final fair-play validation
- Hidden partner ownership is never exposed by the live point totals. Until all partners are revealed, the UI separates **Known bidder**, **Known defense**, and **Hidden / unassigned** captured points.
- Android packaged web assets are synchronized with the web build.
- Android keeps the screen awake natively during gameplay and declares WAKE_LOCK permission.
- Server/client JavaScript syntax and packaged-asset parity are checked before release packaging.

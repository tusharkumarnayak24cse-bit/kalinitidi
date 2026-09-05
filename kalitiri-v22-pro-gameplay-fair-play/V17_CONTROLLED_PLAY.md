# v17 Controlled Play

## What changed

1. **One-time deal animation** — hand cards animate only when a new round is dealt. Normal player moves, chat, timers, score updates, and network state changes no longer visually reshuffle the hand.
2. **Manual hand arrangement** — press **Arrange**, then tap a card and tap its new position. Desktop players may also drag cards. Press **Done arranging** when finished. **Auto sort** restores suit/rank order.
3. **Completed-trick review** — the server freezes play for `TRICK_REVIEW_MS` (default 3800 ms) after the last card of a trick. All cards stay face-up and the winner/points are shown.
4. **Previous trick strip** — after the review window, a compact history strip keeps the prior trick visible while the next trick is played.
5. **Slower bots** — `BOT_ACTION_DELAY_MS` defaults to 1400 ms for easier visual tracking.
6. **60-second human timer preserved** — `TURN_TIMEOUT_MS` remains 60000 ms.

The trick-review pause is server authoritative, so deploy the full v17 project to Render. Rebuilding only the APK will not slow the backend unless the server is also updated.

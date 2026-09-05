# Public Launch Checklist — Kaali Ni Tidi v9

## Required before sharing the link

- [ ] Deploy the v9 ZIP, not an older v8 build.
- [ ] Confirm `/healthz` returns `{ "ok": true }`.
- [ ] Create and join a room from two separate browsers or devices.
- [ ] Complete bidding and Hukum/partner selection.
- [ ] Confirm the 60-second countdown matches on both clients.
- [ ] Let one turn expire and confirm the server auto-plays / auto-passes.
- [ ] Refresh during a game and confirm the same seat and hand return.
- [ ] Disconnect a player and confirm the seat shows BOT ASSIST and play continues.
- [ ] Reconnect that player and confirm control returns to them.
- [ ] Verify Leave Room intentionally removes the reconnect session.
- [ ] Test room creation and joining after repeated clicks; rate limits should stop spam without affecting normal play.
- [ ] Test 4P (1 deck) and a 5–8P mode (2 decks).
- [ ] Test laptop + phone landscape/portrait layouts.

## Recommended for a larger launch

- [ ] Add a TURN relay service for voice reliability.
- [ ] Move active room state to Redis for restart/multi-instance recovery.
- [ ] Add player mute/report/moderation controls if strangers can join public rooms.
- [ ] Add monitoring/error tracking and uptime alerts.
- [ ] Use a custom domain and set `ALLOWED_ORIGINS`.

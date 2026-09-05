# Kaali Ni Tidi v18 — Human Required Rooms

## Bot-only room fix

- Bots never continue a match when zero real players are connected.
- If every real player disconnects, the game pauses during the reconnect grace window.
- If a real player reconnects, the same room resumes normally.
- If the last reconnectable real-player seat expires, the room is closed and all bots are removed with it.
- If the final real player intentionally leaves an active match, the room closes immediately.
- Bot-only rooms from old persisted state are not restored after a server restart.

This keeps the 60-second turn timer, v17 slower trick review, previous-trick display, manual card arrangement, and v16 competitive features.

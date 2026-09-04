# V14 Lobby + Avatar Fix

- Fixed the avatar picker not rendering on deployments where the frontend and Socket.IO backend use different Render hostnames.
- Added a same-origin-first Socket.IO bootstrap with backend fallback.
- Updated CSP to allow the configured multiplayer backend script.
- Redesigned player profile with selected-avatar preview and 12 tappable avatar choices.
- Replaced the room player dropdown with 4P/5P/6P/7P/8P buttons while preserving the existing game rules.
- Kept the 60-second authoritative timer, no-wallet setup, animations, Android fixes, multiplayer, reconnect and voice features.

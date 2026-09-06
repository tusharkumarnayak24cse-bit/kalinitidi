# v3.8.0 — Organized Mobile Table UI

- Reworked the live mobile table into clear zones for players, trick cards, game information, and hand controls.
- Added deterministic seat/trick position classes without changing game rules or network logic.
- Removed negative hand/table overlap on mobile and moved Arrange / Sort controls into a stable 3-button row.
- Kept score, chat, history, log, voice, contract, bidding, and play controls functional while reducing visual collisions.
- Added dedicated 3-player and 4-player mobile positioning for cleaner symmetric play.

# Changelog

## v3.7.0 — Production Hardening

- Added durable PostgreSQL account/replay/tournament/session snapshot persistence.
- Added automatic migration from the legacy JSON account snapshot when available.
- Added fail-closed `REQUIRE_DATABASE` production option.
- Replaced raw in-memory session tokens with SHA-256 token hashes, expiry, per-user session caps, cleanup and revocation.
- Logout and moderator bans now revoke active account sessions.
- Changed password hashing/verification from synchronous scrypt to asynchronous scrypt to avoid blocking the Node event loop.
- Raised new-account password minimum from 6 to 8 characters and capped password input at 128 characters.
- Removed admin keys from URL query strings; admin API accepts `x-admin-key` only and responses are `no-store`.
- Admin secret comparison now uses timing-safe comparison.
- Added graceful account persistence flush on SIGTERM/SIGINT.
- Standardized server, client, package and PWA cache versions to 3.7.0/v37.
- Updated packaged-app backend fallback to `https://tusharevent-2.onrender.com`.
- Added session/account-store tests and security/deployment documentation.
- Consolidated historical release notes into this changelog for a cleaner repository.

## v3.6.0 — Compact Left Contract

- Compact upper-left Hukum + partner-card dock.

## v3.5.0 — Android White Screen Fix

- Capacitor/Android splash and loading fixes.

## v3.4.0 — Clear Trick Zone

- Contract/voice docks kept clear of played cards.

## v3.3.0 — Ultimate Premium

- Premium navigation, progression, cinematic flow, invites, reactions, PWA, moderation, replay/audit and competitive features.

Earlier gameplay milestones remain preserved in Git history/tags instead of duplicate full project folders.

# Security notes — Kaali Ni Tidi v37

## Secrets

- `ADMIN_KEY` must be stored only in Render/host environment variables.
- Use at least 32 random characters.
- Admin API requests authenticate with the `x-admin-key` header only. Query-string admin keys are intentionally rejected.
- Never commit `.env` or a real `DATABASE_URL`.

## Accounts and sessions

- Passwords are derived with Node.js `crypto.scrypt` and a unique random salt.
- Password verification uses `crypto.timingSafeEqual`.
- New passwords must be 8–128 characters.
- Account session bearer tokens use 32 random bytes. Only SHA-256 token hashes are stored server-side.
- Sessions expire after `SESSION_TTL_DAYS` (30 by default), are capped per user, and are revoked on logout or moderator ban.

## Persistence

- Production uses PostgreSQL through `DATABASE_URL`.
- The old JSON file remains only as a local fallback and one-time migration source.
- `REQUIRE_DATABASE=true` makes production fail closed rather than silently starting without durable account storage.

## Multiplayer trust boundary

The server remains authoritative for card ownership, legal plays, bidding, scoring, room state and match results. Clients request actions; they do not declare authoritative outcomes.

## Recommended production settings

- `NODE_ENV=production`
- `REQUIRE_DATABASE=true`
- a durable managed PostgreSQL database
- a long `ADMIN_KEY`
- HTTPS/WSS only
- a TURN service if reliable voice chat is required across mobile networks

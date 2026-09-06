# Kaali Ni Tidi — v37 Production Hardened

Online 3♠ multiplayer card game for 3–8 players with bots, private/public rooms, ranked matchmaking, voice, spectators, friends, achievements, challenges, tournaments, replays and server-authoritative fair-play validation.

Current application version: **3.7.0**.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Run security/storage unit tests with:

```bash
npm test
```

## Production persistence

v37 uses PostgreSQL when `DATABASE_URL` is set. The server creates its own `kalitiri_snapshots` table automatically. The old `ACCOUNTS_FILE` JSON format is retained only for local development and one-time migration.

For a real deployment set:

```text
NODE_ENV=production
REQUIRE_DATABASE=true
DATABASE_URL=<managed PostgreSQL connection URL>
ADMIN_KEY=<32+ random characters>
PUBLIC_GAME_URL=https://tusharevent-2.onrender.com
```

If your database provider specifically requires application-side TLS, also set `DATABASE_SSL=true`. Keep certificate verification enabled unless your provider explicitly documents otherwise.

## Render deployment

1. Create or choose a durable PostgreSQL database. A free Render PostgreSQL database currently expires after 30 days, so use a paid Render database or another durable managed PostgreSQL provider for long-term accounts.
2. In the existing Render web service, add `DATABASE_URL` and a new random `ADMIN_KEY` under **Environment**.
3. Set `REQUIRE_DATABASE=true`.
4. Remove the old `ACCOUNTS_FILE=/var/data/...` setting from the Render service; free Render web-service files are ephemeral.
5. Deploy this repository. The health endpoint `/healthz` should report `storage: "postgres"`.
6. Open `/admin.html` and enter the admin key only in the password box. v37 never places it in the URL.

## Repository policy

Keep only the current application in `main`. Use Git tags/releases (`v3.7.0`, `v3.8.0`, etc.) instead of copying the entire project into new version directories. See `CHANGELOG.md` for historical milestones.

## Security

See `SECURITY.md`. Important points:

- scrypt password hashing with unique salts
- timing-safe password/admin-secret comparisons
- expiring hashed bearer sessions with revocation
- server-authoritative moves/scoring
- origin filtering, request size limits and Socket.IO rate limiting
- no committed admin secret
- durable external account persistence

## Mobile packaging

The Capacitor configuration and Android project are included. `public/config.js` points packaged clients to `https://tusharevent-2.onrender.com`; update that value if you later move to a custom domain.

# Kaali Ni Tidi v3.7 Deployment Checklist

Use this checklist for the existing Render service at `https://tusharevent-2.onrender.com`.

## 1. Create a durable PostgreSQL database

For production, use a PostgreSQL plan/provider that does not expire. Render's free Postgres is suitable for testing but currently expires after 30 days.

Copy the database connection string into Render as `DATABASE_URL`.

## 2. Update Render environment variables

In **Render → tusharevent-2 → Environment**, set:

```text
NODE_ENV=production
DATABASE_URL=<your PostgreSQL connection string>
REQUIRE_DATABASE=true
ADMIN_KEY=<new random secret, 32+ characters>
PUBLIC_GAME_URL=https://tusharevent-2.onrender.com
SESSION_TTL_DAYS=30
MAX_SESSIONS_PER_USER=5
```

Optional PostgreSQL TLS settings, only if your provider requires them:

```text
DATABASE_SSL=true
DATABASE_SSL_REJECT_UNAUTHORIZED=true
```

Remove the old `ACCOUNTS_FILE=/var/data/kalitiri-accounts.json` production setting after the database is verified. The code still supports a local JSON fallback for development and one-time migration, but Render free web-service storage is not durable.

## 3. Deploy the v3.7 code

Deploy the contents of this project as the active repository root.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

## 4. Verify the deployment

Open:

```text
https://tusharevent-2.onrender.com/healthz
```

Expected shape:

```json
{
  "ok": true,
  "region": "singapore",
  "version": "3.7.0",
  "storage": "postgres"
}
```

If `storage` is not `postgres` while `REQUIRE_DATABASE=true`, do not treat the deployment as complete.

## 5. Verify account and session behavior

1. Create a test account.
2. Log out and confirm the old session no longer resumes.
3. Log in again.
4. Restart/redeploy the service.
5. Confirm the account remains available.
6. Confirm a valid session can resume until it expires.

## 6. Verify admin security

Open `/admin.html` and use the new `ADMIN_KEY`.

The admin key is sent only in the `x-admin-key` request header. It is no longer placed in the URL query string.

Test that:

- no key → 401
- wrong key → 401
- correct key → admin data loads
- banning a user revokes that user's active sessions

## 7. Keep secrets out of GitHub

Do not commit `.env`, real database URLs, or the real `ADMIN_KEY`. The included `.env.example` contains placeholders only.

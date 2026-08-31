# Eventora Railway Edition

This build is made specifically to deploy more reliably on Railway.

## Main change
`better-sqlite3` has been completely removed, so there is no native SQLite package to compile during the Railway build.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

## Railway

Deploy from GitHub. Railway detects Node automatically.

Required environment variables:

- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Razorpay variables are optional.

## Important

This edition uses JSON file storage to make deployment simpler. On hosting platforms with ephemeral storage, data can be lost on redeploy/restart. For real ticket sales, the next step should be an external managed database such as PostgreSQL.

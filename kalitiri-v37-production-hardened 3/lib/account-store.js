const fs = require("fs");
const path = require("path");

function createAccountStore({ databaseUrl = "", filePath = "", isProd = false, logger = console } = {}) {
  const dbUrl = String(databaseUrl || "").trim();
  const fallbackFile = String(filePath || "").trim();
  let pool = null;
  let saveTimer = null;
  let pendingSnapshotFactory = null;
  let initialized = false;

  function mode() {
    if (dbUrl) return "postgres";
    if (fallbackFile) return "file";
    return "memory";
  }

  async function initPostgres() {
    if (!dbUrl || pool) return;
    const { Pool } = require("pg");
    const sslEnabled = String(process.env.DATABASE_SSL || "").toLowerCase() === "true";
    const rejectUnauthorized = String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";
    pool = new Pool({
      connectionString: dbUrl,
      max: Math.max(1, Math.min(10, Number(process.env.DATABASE_POOL_MAX || 5))),
      connectionTimeoutMillis: Math.max(2_000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 8_000)),
      idleTimeoutMillis: 30_000,
      ...(sslEnabled ? { ssl: { rejectUnauthorized } } : {})
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kalitiri_snapshots (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  function readFileSnapshot() {
    if (!fallbackFile || !fs.existsSync(fallbackFile)) return null;
    return JSON.parse(fs.readFileSync(fallbackFile, "utf8"));
  }

  function writeFileSnapshot(snapshot) {
    if (!fallbackFile) return;
    fs.mkdirSync(path.dirname(fallbackFile), { recursive: true });
    const tmp = `${fallbackFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, fallbackFile);
  }

  async function save(snapshot) {
    if (!snapshot) return;
    if (dbUrl) {
      await initPostgres();
      await pool.query(
        `INSERT INTO kalitiri_snapshots (id, payload, updated_at)
         VALUES ('accounts-v2', $1::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [JSON.stringify(snapshot)]
      );
      return;
    }
    if (fallbackFile) writeFileSnapshot(snapshot);
  }

  async function restore() {
    initialized = true;
    if (dbUrl) {
      await initPostgres();
      const result = await pool.query("SELECT payload FROM kalitiri_snapshots WHERE id = 'accounts-v2' LIMIT 1");
      if (result.rows[0]?.payload) return result.rows[0].payload;

      // One-time migration path for users upgrading from the legacy JSON account file.
      const legacy = readFileSnapshot();
      if (legacy) {
        logger.info?.("Migrating legacy account snapshot into PostgreSQL.");
        await save({ ...legacy, version: 2, migratedAt: Date.now() });
        return legacy;
      }
      return null;
    }
    if (fallbackFile) return readFileSnapshot();
    return null;
  }

  function schedule(snapshotFactory, delayMs = 250) {
    if (mode() === "memory") return;
    pendingSnapshotFactory = snapshotFactory;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const factory = pendingSnapshotFactory;
      pendingSnapshotFactory = null;
      try {
        await save(typeof factory === "function" ? factory() : factory);
      } catch (error) {
        logger.error?.("Account persistence failed:", error?.message || error);
      }
    }, Math.max(50, Number(delayMs) || 250));
    saveTimer.unref?.();
  }

  async function flush(snapshotFactory) {
    clearTimeout(saveTimer);
    saveTimer = null;
    const factory = snapshotFactory || pendingSnapshotFactory;
    pendingSnapshotFactory = null;
    if (mode() === "memory" || !factory) return;
    await save(typeof factory === "function" ? factory() : factory);
  }

  async function close() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (pool) {
      await pool.end();
      pool = null;
    }
  }

  function status() {
    return { mode: mode(), initialized, database: Boolean(dbUrl), fileFallback: Boolean(fallbackFile) };
  }

  return { restore, save, schedule, flush, close, status, mode };
}

module.exports = { createAccountStore };

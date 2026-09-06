const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function createSessionStore({ ttlMs = 30 * 24 * 60 * 60 * 1000, maxSessionsPerUser = 5 } = {}) {
  const sessions = new Map();
  const safeTtl = Math.max(60_000, Number(ttlMs) || 30 * 24 * 60 * 60 * 1000);
  const safeMax = Math.max(1, Math.min(20, Number(maxSessionsPerUser) || 5));

  function cleanup(now = Date.now()) {
    let removed = 0;
    for (const [sessionHash, session] of sessions) {
      if (!session || Number(session.expiresAt || 0) <= now) {
        sessions.delete(sessionHash);
        removed++;
      }
    }
    return removed;
  }

  function trimUserSessions(userId) {
    const rows = [...sessions.entries()]
      .filter(([, s]) => s?.userId === userId)
      .sort((a, b) => Number(a[1].createdAt || 0) - Number(b[1].createdAt || 0));
    while (rows.length >= safeMax) {
      const [hash] = rows.shift();
      sessions.delete(hash);
    }
  }

  function issue(userId, now = Date.now()) {
    cleanup(now);
    trimUserSessions(userId);
    const token = crypto.randomBytes(32).toString("hex");
    const sessionHash = hashToken(token);
    const session = {
      userId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + safeTtl
    };
    sessions.set(sessionHash, session);
    return { token, sessionHash, expiresAt: session.expiresAt };
  }

  function validate(token, now = Date.now()) {
    const sessionHash = hashToken(token);
    const session = sessions.get(sessionHash);
    if (!session) return null;
    if (Number(session.expiresAt || 0) <= now) {
      sessions.delete(sessionHash);
      return null;
    }
    session.lastUsedAt = now;
    return { ...session, sessionHash };
  }

  function revokeHash(sessionHash) {
    return sessionHash ? sessions.delete(String(sessionHash)) : false;
  }

  function revokeToken(token) {
    return sessions.delete(hashToken(token));
  }

  function revokeUser(userId) {
    let removed = 0;
    for (const [sessionHash, session] of sessions) {
      if (session?.userId === userId) {
        sessions.delete(sessionHash);
        removed++;
      }
    }
    return removed;
  }

  function serialize(now = Date.now()) {
    cleanup(now);
    return [...sessions.entries()].map(([sessionHash, session]) => ({ sessionHash, ...session }));
  }

  function restore(rows = [], now = Date.now()) {
    sessions.clear();
    for (const row of Array.isArray(rows) ? rows : []) {
      const sessionHash = String(row?.sessionHash || "");
      if (!/^[a-f0-9]{64}$/i.test(sessionHash)) continue;
      if (!row?.userId || Number(row?.expiresAt || 0) <= now) continue;
      sessions.set(sessionHash, {
        userId: String(row.userId),
        createdAt: Number(row.createdAt || now),
        lastUsedAt: Number(row.lastUsedAt || row.createdAt || now),
        expiresAt: Number(row.expiresAt)
      });
    }
    cleanup(now);
    return sessions.size;
  }

  function size() {
    cleanup();
    return sessions.size;
  }

  return {
    issue,
    validate,
    revokeHash,
    revokeToken,
    revokeUser,
    serialize,
    restore,
    cleanup,
    size,
    hashToken
  };
}

module.exports = { createSessionStore, hashToken };

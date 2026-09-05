const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionStore, hashToken } = require("../lib/session-store");

test("session tokens are stored only as hashes and expire", () => {
  const store = createSessionStore({ ttlMs: 60_000 });
  const issued = store.issue("user-1", 1_000);
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  assert.equal(store.serialize(1_001)[0].sessionHash, hashToken(issued.token));
  assert.equal(store.validate(issued.token, 1_001).userId, "user-1");
  assert.equal(store.validate(issued.token, 61_001), null);
});

test("revoke user removes all active sessions", () => {
  const store = createSessionStore({ ttlMs: 60_000 });
  const now = Date.now();
  store.issue("user-1", now);
  store.issue("user-1", now + 100);
  store.issue("user-2", now + 200);
  assert.equal(store.revokeUser("user-1"), 2);
  assert.equal(store.size(), 1);
});

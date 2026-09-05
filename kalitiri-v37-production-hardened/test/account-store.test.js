const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAccountStore } = require("../lib/account-store");

test("file fallback saves and restores a snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knt-store-"));
  const file = path.join(dir, "accounts.json");
  const store = createAccountStore({ filePath: file });
  const snapshot = { version: 2, users: [{ id: "u1", username: "test" }], sessions: [] };
  await store.save(snapshot);
  const restored = await store.restore();
  assert.deepEqual(restored, snapshot);
  await store.close();
});

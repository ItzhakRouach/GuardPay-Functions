import test from "node:test";
import assert from "node:assert/strict";
import { mishmeretAuthorized } from "../src/auth-guard.js";
import { findAccount } from "../src/find-account.js";

const SECRET = "test-secret";

function mockUsers(usersArr) {
  return { list: async () => ({ total: usersArr.length, users: usersArr }) };
}
function mockDatabases(prefsDocs) {
  return {
    listDocuments: async () => ({ total: prefsDocs.length, documents: prefsDocs }),
  };
}

test("mishmeretAuthorized: true only with matching secret and no user session", () => {
  process.env.MISHMERET_SECRET = SECRET;
  assert.equal(mishmeretAuthorized({ headers: {} }, { secret: SECRET }), true);
  assert.equal(mishmeretAuthorized({ headers: {} }, { secret: "wrong" }), false);
  assert.equal(mishmeretAuthorized({ headers: {} }, {}), false);
  // App-user execution (session header present) is always rejected.
  assert.equal(
    mishmeretAuthorized({ headers: { "x-appwrite-user-id": "u1" } }, { secret: SECRET }),
    false,
  );
  // Unset secret on the function ⇒ nothing is authorized.
  delete process.env.MISHMERET_SECRET;
  assert.equal(mishmeretAuthorized({ headers: {} }, { secret: "" }), false);
  process.env.MISHMERET_SECRET = SECRET;
});

test("findAccount: bad email → BAD_PAYLOAD 400", async () => {
  const out = await findAccount({ users: mockUsers([]), databases: mockDatabases([]) }, { email: "not-an-email" });
  assert.equal(out.status, 400);
  assert.equal(out.body.code, "BAD_PAYLOAD");
});

test("findAccount: no matching user → NOT_FOUND 404", async () => {
  const out = await findAccount({ users: mockUsers([]), databases: mockDatabases([]) }, { email: "a@b.com" });
  assert.equal(out.status, 404);
  assert.equal(out.body.code, "NOT_FOUND");
});

test("findAccount: user without prefs → NO_PREFS 404", async () => {
  const out = await findAccount(
    { users: mockUsers([{ $id: "u1", email: "a@b.com", name: "A" }]), databases: mockDatabases([]) },
    { email: "a@b.com" },
  );
  assert.equal(out.status, 404);
  assert.equal(out.body.code, "NO_PREFS");
});

test("findAccount: success returns userId + prefs name, email normalized", async () => {
  const out = await findAccount(
    {
      users: mockUsers([{ $id: "u1", email: "a@b.com", name: "auth-name" }]),
      databases: mockDatabases([{ user_name: "יצחק רואש" }]),
    },
    { email: "  A@B.com " },
  );
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, userId: "u1", name: "יצחק רואש", email: "a@b.com" });
});

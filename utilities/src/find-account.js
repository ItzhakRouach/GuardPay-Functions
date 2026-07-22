import { Query } from "node-appwrite";

const DB_ID = process.env.APPWRITE_DB_ID ?? "695835c0002144f7a605";
const USERS_PREFS = "users_prefs";

/** FIND_ACCOUNT: locate a GuardPay Appwrite user by email; return the display
 *  name (from users_prefs) for מִשְׁמֶרֶת's link-confirmation step. */
export async function findAccount({ users, databases }, payload) {
  const email = String(payload?.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { status: 400, body: { ok: false, code: "BAD_PAYLOAD" } };
  }

  const list = await users.list([Query.equal("email", email), Query.limit(1)]);
  const user = list.users?.[0];
  if (!user) return { status: 404, body: { ok: false, code: "NOT_FOUND" } };

  const prefsRes = await databases.listDocuments(DB_ID, USERS_PREFS, [
    Query.equal("user_id", user.$id),
    Query.limit(1),
  ]);
  const prefs = prefsRes.documents?.[0];
  if (!prefs) return { status: 404, body: { ok: false, code: "NO_PREFS" } };

  return {
    status: 200,
    body: { ok: true, userId: user.$id, name: prefs.user_name || user.name || email, email: user.email },
  };
}

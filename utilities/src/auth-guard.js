/** מִשְׁמֶרֶת-only actions gate. These actions are server-to-server: the app
 *  never calls them, and IMPORT_WEEK writes to an arbitrary user_id — so a
 *  user-session execution (x-appwrite-user-id header) is always rejected. */
export function mishmeretAuthorized(req, payload) {
  return (
    !!process.env.MISHMERET_SECRET &&
    payload?.secret === process.env.MISHMERET_SECRET &&
    !req?.headers?.["x-appwrite-user-id"]
  );
}

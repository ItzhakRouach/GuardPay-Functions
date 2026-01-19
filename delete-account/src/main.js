// initilize appwrite sdk
import { Client, Databases, Query, Users } from "node-appwrite";

const client = new Client();
client
  .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const users = new Users(client);

export default async ({ req, res, log, error }) => {
  //check for data arrive
  if (!req.body) {
    error("Request body is missing!");
    return res.json({ error: "No Data Provided" }, 400);
  }

  //check for how data arive and destruct like should
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    error("JSON Parse Error: " + e.message);
    return res.json({ error: "Invalid JSON format" }, 400);
  }
  try {
    const { userId } = body;
    const userPref = await databases.listDocuments(
      process.env.DATABASE_ID,
      process.env.USERS_PREFS_ID,
      [Query.equal("user_id", userId)],
    );

    const userShifts = await databases.listDocuments(
      process.env.DATABASE_ID,
      process.env.SHIFTS_HISTORY_ID,
      [Query.equal("user_id", userId)],
    );

    // now after fetching we delete all the records if existed

    // Delete user Pref records
    if (userPref.documents.length !== 0) {
      await Promise.all(
        userPref.documents.map((doc) =>
          databases.deleteDocument(
            process.env.DATABASE_ID,
            process.env.USERS_PREFS_ID,
            doc.$id,
          ),
        ),
      );
    }

    //Delete all user shifts record
    if (userShifts.documents.length !== 0) {
      await Promise.all(
        userShifts.documents.map((doc) =>
          databases.deleteDocument(
            process.env.DATABASE_ID,
            process.env.SHIFTS_HISTORY_ID,
            doc.$id,
          ),
        ),
      );
    }
    // after deleted all records we can move on to delete the user
    await users.delete({ userId: `${userId}` });
    return context.res.json({ message: "All data deleted successfully" });
  } catch (err) {
    log(err);
    error("Error happend: " + e.message);
    return res.json({ error: "unable to delete the account" }, 400);
  }
};

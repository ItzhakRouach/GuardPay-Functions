// initilize appwrite sdk
import { Client, Databases, Query, Users } from "node-appwrite";
import {
  DATABASE_ID,
  USERS_PREFS,
  SHIFTS_HISTORY,
  API,
  ENDPOINT,
  PROJECT,
} from "./appwrite.js";

export default async ({ req, res, log, error }) => {
  const client = new Client();
  client.setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API);

  const databases = new Databases(client);
  const users = new Users(client);

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
    const [userPref, userShifts] = await Promise.all([
      databases.listDocuments(DATABASE_ID, USERS_PREFS, [
        Query.equal("user_id", userId),
      ]),
      databases.listDocuments(DATABASE_ID, SHIFTS_HISTORY, [
        Query.equal("user_id", userId),
      ]),
    ]);

    // now after fetching we delete all the records if existed

    // Delete user Pref records
    const deleteTasks = [
      ...userPref.documents.map((doc) =>
        databases.deleteDocument(DATABASE_ID, USERS_PREFS, doc.$id),
      ),
      ...userShifts.documents.map((doc) =>
        databases.deleteDocument(DATABASE_ID, SHIFTS_HISTORY, doc.$id),
      ),
    ];

    await Promise.all(deleteTasks);
    log("Documents deleted successfully.");

    // after deleted all records we can move on to delete the user
    await users.delete({ userId: `${userId}` });
    log("User account deleted successfully.");
    return res.json({ message: "All data deleted successfully" });
  } catch (err) {
    log(err);
    error("Error happened: " + err.message);
    return res.json(
      { error: "Unable to delete the account", details: err.message },
      500,
    );
  }
};

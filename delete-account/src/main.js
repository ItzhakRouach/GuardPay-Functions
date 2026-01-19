// initilize appwrite sdk
import { Client, Databases, Query, Users } from "node-appwrite";
export default async ({ req, res, log, error }) => {
  const client = new Client();
  client
    .setEndpoint("https://fra.cloud.appwrite.io/v1")
    .setProject("69583540003a5151db86")
    .setKey(
      "standard_a002d3461db36e01878442889155d73f93117af56a89806990bd8fe23a4a8f897eb54db55ac24c1017154e037862d2fc372fc4e765c20127fe8c26403f9d076939f532476f631add4f375befa84833fd38d1b0db02d0f1d48cd72d35bf0f84c77242bbdefa08ce5fc0a00afde021aeebec192ab59e8be31bfb5f8ff7f6bfcb9b",
    );

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
      databases.listDocuments("695835c0002144f7a605", "users_prefs", [
        Query.equal("user_id", userId),
      ]),
      databases.listDocuments("695835c0002144f7a605", "shifts_history", [
        Query.equal("user_id", userId),
      ]),
    ]);

    // now after fetching we delete all the records if existed

    // Delete user Pref records
    const deleteTasks = [
      ...userPref.documents.map((doc) =>
        databases.deleteDocument(
          "695835c0002144f7a605",
          "users_prefs",
          doc.$id,
        ),
      ),
      ...userShifts.documents.map((doc) =>
        databases.deleteDocument(
          "695835c0002144f7a605",
          "shifts_history",
          doc.$id,
        ),
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

import { ID, Query } from "node-appwrite";

// salaryLogic prices by LOCAL wall-clock (getHours/getDay). Identical to the
// phone app only when this process runs in Israel time. Set defensively here;
// the console env var TZ=Asia/Jerusalem is the primary mechanism.
process.env.TZ ??= "Asia/Jerusalem";

const DB_ID = process.env.APPWRITE_DB_ID ?? "695835c0002144f7a605";
const SHIFTS_HISTORY = "shifts_history";
const USERS_PREFS = "users_prefs";
const IMPORT_KEY_RE = /^mishmeret:\d{4}-\d{2}-\d{2}$/;
const MAX_SHIFTS = 20;
const MAX_SPAN_MS = 24 * 60 * 60 * 1000;

/** Refuse to price under a wrong timezone — a UTC process would silently
 *  mis-bucket Shabbat/night hours. Probes both DST sides of Israel time. */
export function tzGuardOk() {
  const winter = new Date("2026-01-15T00:00:00Z").getTimezoneOffset();
  const summer = new Date("2026-07-15T00:00:00Z").getTimezoneOffset();
  return winter === -120 && summer === -180;
}

/** Returns null when valid, or a short reason string. */
export function validateImportPayload(payload) {
  if (!payload || typeof payload.userId !== "string" || !payload.userId) return "userId";
  if (typeof payload.importKey !== "string" || !IMPORT_KEY_RE.test(payload.importKey)) return "importKey";
  if (!Array.isArray(payload.shifts) || payload.shifts.length > MAX_SHIFTS) return "shifts";
  for (const s of payload.shifts) {
    const start = new Date(s?.start ?? "");
    const end = new Date(s?.end ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "shift dates";
    if (end <= start || end - start > MAX_SPAN_MS) return "shift span";
  }
  return null;
}

/** Full-week sync: replace ONLY docs this integration created for this week
 *  (matched by user_id + import_key). Manually-added shifts are never touched. */
export async function importWeek({ databases, calculateShiftPay }, payload) {
  if (!tzGuardOk()) {
    return { status: 500, body: { ok: false, code: "BAD_TZ", message: "function TZ must be Asia/Jerusalem" } };
  }
  const invalid = validateImportPayload(payload);
  if (invalid) return { status: 400, body: { ok: false, code: "BAD_PAYLOAD", message: invalid } };

  const prefsRes = await databases.listDocuments(DB_ID, USERS_PREFS, [
    Query.equal("user_id", payload.userId),
    Query.limit(1),
  ]);
  const prefs = prefsRes.documents?.[0];
  if (!prefs) return { status: 404, body: { ok: false, code: "NO_PREFS" } };
  const baseRate = Number(prefs.price_per_hour);
  const travelRate = Number(prefs.price_per_ride || 0);

  const existing = await databases.listDocuments(DB_ID, SHIFTS_HISTORY, [
    Query.equal("user_id", payload.userId),
    Query.equal("import_key", payload.importKey),
    Query.limit(100),
  ]);
  for (const doc of existing.documents) {
    await databases.deleteDocument(DB_ID, SHIFTS_HISTORY, doc.$id);
  }

  let totalAmount = 0;
  for (const s of payload.shifts) {
    // Same doc shape add-shift.jsx writes for a regular shift, plus the 2 tags.
    const doc = calculateShiftPay(s.start, s.end, baseRate, travelRate, !!s.isHoliday);
    doc.is_training = false;
    doc.is_vacation = false;
    doc.start_time = s.start;
    doc.end_time = s.end;
    doc.base_rate = baseRate;
    doc.is_holiday = !!s.isHoliday;
    doc.user_id = payload.userId;
    doc.comment = String(s.comment ?? "").slice(0, 200);
    doc.import_source = "mishmeret";
    doc.import_key = payload.importKey;
    await databases.createDocument(DB_ID, SHIFTS_HISTORY, ID.unique(), doc);
    totalAmount += doc.total_amount;
  }

  return {
    status: 200,
    body: { ok: true, deleted: existing.documents.length, created: payload.shifts.length, totalAmount: Number(totalAmount.toFixed(2)) },
  };
}

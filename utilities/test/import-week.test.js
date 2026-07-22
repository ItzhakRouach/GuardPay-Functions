import test from "node:test";
import assert from "node:assert/strict";
import { tzGuardOk, validateImportPayload, importWeek } from "../src/import-week.js";

// A tiny stand-in for main.js's calculateShiftPay — importWeek only relies on
// its return being the pay-bucket object (it adds identity fields itself).
function fakeCalc() {
  return {
    total_amount: 500, reg_hours: 8, extra_hours: 0,
    reg_pay_amount: 500, extra_pay_amount: 0, travel_pay_amount: 0,
    h100_hours: 8, h125_extra_hours: 0, h150_extra_hours: 0,
    h175_extra_hours: 0, h200_extra_hours: 0, h150_shabat: 0,
    h150_holiday: 0, h175_holiday: 0, h200_holiday: 0,
  };
}

function mockDb({ prefs = [{ price_per_hour: 45, price_per_ride: 20 }], existing = [] } = {}) {
  const calls = { created: [], deleted: [] };
  const db = {
    listDocuments: async (_d, col) =>
      col === "users_prefs"
        ? { total: prefs.length, documents: prefs }
        : { total: existing.length, documents: existing },
    deleteDocument: async (_d, _c, id) => { calls.deleted.push(id); },
    createDocument: async (_d, _c, _id, doc) => { calls.created.push(doc); },
  };
  return { db, calls };
}

const VALID = {
  userId: "u1",
  importKey: "mishmeret:2026-07-19",
  shifts: [
    { start: "2026-07-19T04:00:00.000Z", end: "2026-07-19T12:00:00.000Z", isHoliday: false, comment: "יובא ממשמרת · בוקר" },
  ],
};

test("tzGuardOk true under Asia/Jerusalem, false under UTC", () => {
  const prev = process.env.TZ;
  process.env.TZ = "Asia/Jerusalem";
  assert.equal(tzGuardOk(), true);
  process.env.TZ = "UTC";
  assert.equal(tzGuardOk(), false);
  process.env.TZ = prev ?? "Asia/Jerusalem";
});

test("validateImportPayload rejects bad shapes", () => {
  assert.equal(validateImportPayload(VALID), null);
  assert.notEqual(validateImportPayload({ ...VALID, userId: "" }), null);
  assert.notEqual(validateImportPayload({ ...VALID, importKey: "week-1" }), null);
  assert.notEqual(validateImportPayload({ ...VALID, shifts: new Array(21).fill(VALID.shifts[0]) }), null);
  // end before start
  assert.notEqual(
    validateImportPayload({ ...VALID, shifts: [{ ...VALID.shifts[0], end: "2026-07-19T03:00:00.000Z" }] }),
    null,
  );
  // span > 24h
  assert.notEqual(
    validateImportPayload({ ...VALID, shifts: [{ ...VALID.shifts[0], end: "2026-07-20T05:00:00.000Z" }] }),
    null,
  );
  // empty array is VALID — it means "remove this week's import"
  assert.equal(validateImportPayload({ ...VALID, shifts: [] }), null);
});

test("importWeek: missing prefs → NO_PREFS", async () => {
  const { db } = mockDb({ prefs: [] });
  const out = await importWeek({ databases: db, calculateShiftPay: fakeCalc }, VALID);
  assert.equal(out.status, 404);
  assert.equal(out.body.code, "NO_PREFS");
});

test("importWeek: deletes existing tagged docs then creates new ones with tags", async () => {
  const { db, calls } = mockDb({ existing: [{ $id: "old1" }, { $id: "old2" }] });
  const out = await importWeek({ databases: db, calculateShiftPay: fakeCalc }, VALID);
  assert.equal(out.status, 200);
  assert.deepEqual(calls.deleted, ["old1", "old2"]);
  assert.equal(calls.created.length, 1);
  const doc = calls.created[0];
  // Exact regular-shift field set add-shift.jsx writes + the two tags:
  assert.equal(doc.user_id, "u1");
  assert.equal(doc.start_time, VALID.shifts[0].start);
  assert.equal(doc.end_time, VALID.shifts[0].end);
  assert.equal(doc.base_rate, 45);
  assert.equal(doc.is_training, false);
  assert.equal(doc.is_vacation, false);
  assert.equal(doc.is_holiday, false);
  assert.equal(doc.comment, "יובא ממשמרת · בוקר");
  assert.equal(doc.import_source, "mishmeret");
  assert.equal(doc.import_key, "mishmeret:2026-07-19");
  for (const k of ["total_amount","reg_hours","extra_hours","reg_pay_amount","extra_pay_amount","travel_pay_amount","h100_hours","h125_extra_hours","h150_extra_hours","h175_extra_hours","h200_extra_hours","h150_shabat","h150_holiday","h175_holiday","h200_holiday"]) {
    assert.ok(k in doc, `missing pay bucket ${k}`);
  }
  assert.deepEqual(out.body, { ok: true, deleted: 2, created: 1, totalAmount: 500 });
});

test("importWeek: empty shifts array removes the week's import", async () => {
  const { db, calls } = mockDb({ existing: [{ $id: "old1" }] });
  const out = await importWeek({ databases: db, calculateShiftPay: fakeCalc }, { ...VALID, shifts: [] });
  assert.equal(out.status, 200);
  assert.deepEqual(calls.deleted, ["old1"]);
  assert.equal(calls.created.length, 0);
  assert.equal(out.body.created, 0);
});

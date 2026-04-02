import { Client, Databases, Query, Users } from "node-appwrite";

export default async ({ req, res, log, error }) => {
  const client = new Client();
  client
    .setEndpoint("https://fra.cloud.appwrite.io/v1")
    .setProject("69583540003a5151db86")
    .setKey("YOUR_SECRET_KEY"); // וודא שהמפתח כאן תקין

  const databases = new Databases(client);
  const users = new Users(client);

  if (!req.body) return res.json({ error: "No Data Provided" }, 400);

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.json({ error: "Invalid JSON format" }, 400);
  }

  const { action, payload } = body;

  try {
    switch (action) {
      case "DELETE_ACCOUNT": {
        const targetUserId = req.headers["x-appwrite-user-id"];
        if (!targetUserId) return res.json({ error: "Unauthorized" }, 401);

        const [userPref, userShifts] = await Promise.all([
          databases.listDocuments("695835c0002144f7a605", "users_prefs", [
            Query.equal("user_id", targetUserId),
          ]),
          databases.listDocuments("695835c0002144f7a605", "shifts_history", [
            Query.equal("user_id", targetUserId),
          ]),
        ]);

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
        await users.delete(targetUserId);
        return res.json({ message: "Deleted successfully" });
      }

      case "CALCULATE_SALARY": {
        const {
          regularPay,
          extraPay,
          travelPay,
          training_pay,
          vacation_pay,
          user_id,
        } = payload;

        // שליפת נתוני יישוב מהפרופיל לצורך חישוב הזיכוי
        const profileRes = await databases.listDocuments(
          "695835c0002144f7a605",
          "users_prefs",
          [Query.equal("user_id", user_id)],
        );
        const profile = profileRes.documents[0] || {};

        const result = calculateSalary(
          regularPay,
          extraPay,
          travelPay,
          training_pay,
          vacation_pay,
          profile.credit_points || 2.25,
          profile.settlement_percent || 0,
          profile.settlement_annual_cap || 0,
        );
        return res.json(result);
      }

      case "CALCULATE_SHIFT": {
        const {
          startTime,
          endTime,
          baseRate,
          travelRate,
          type,
          user_id,
          isHoliday,
        } = payload;

        let result;
        if (type === "training" || type === "vacation") {
          result = {
            total_amount: Number(baseRate * 8),
            reg_hours: 0,
            extra_hours: 0,
            reg_pay_amount: 0,
            extra_pay_amount: 0,
            travel_pay_amount: type === "training" ? Number(travelRate) : 0,
            h100_hours: 0,
            h125_extra_hours: 0,
            h150_extra_hours: 0,
            h175_extra_hours: 0,
            h200_extra_hours: 0,
            h150_shabat: 0,
            base_rate: baseRate,
            is_training: type === "training",
            is_vacation: type === "vacation",
            start_time: startTime,
            end_time: endTime,
          };
        } else {
          // העברת פרמטר החג לפונקציה
          result = calculateShiftPay(
            startTime,
            endTime,
            baseRate,
            travelRate,
            isHoliday,
          );
          result.is_training = false;
          result.is_vacation = false;
          result.start_time = startTime;
          result.end_time = endTime;
          result.base_rate = Number(baseRate);
          result.is_holiday = !!isHoliday;
        }
        return res.json(result);
      }

      default:
        return res.json({ error: "Invalid Action" }, 400);
    }
  } catch (err) {
    error(err.message);
    return res.json({ error: "Internal Error", details: err.message }, 500);
  }
};

// --- פונקציות עזר מעודכנות 2026 ---

const calculateSalary = (
  reg = 0,
  extra = 0,
  travel = 0,
  training = 0,
  vacation = 0,
  points = 2.25,
  sPercent = 0,
  sAnnualCap = 0,
) => {
  const bruto =
    Number(reg) +
    Number(extra) +
    Number(travel) +
    Number(training) +
    Number(vacation);
  const pensia =
    Number(reg) * 0.07 + Number(extra) * 0.07 + Number(travel) * 0.05;

  const thresholdBL = 7522;
  const bituahLeumiAndHealth =
    bruto <= thresholdBL
      ? bruto * 0.035
      : thresholdBL * 0.035 + (bruto - thresholdBL) * 0.12;

  // מדרגות מס 2026
  let grossTax = 0;
  if (bruto <= 7010) grossTax = bruto * 0.1;
  else if (bruto <= 10060) grossTax = 701 + (bruto - 7010) * 0.14;
  else if (bruto <= 16150) grossTax = 701 + 427 + (bruto - 10060) * 0.2;
  else grossTax = 701 + 427 + 1218 + (bruto - 16150) * 0.31;

  // זיכויים (נקודות זיכוי + הטבת יישוב מה-PDF)
  const creditValue = points * 242;

  let settlementBenefit = 0;
  if (sPercent > 0 && sAnnualCap > 0) {
    const monthlyCap = sAnnualCap / 12;
    settlementBenefit = Math.min(bruto, monthlyCap) * (sPercent / 100);
  }

  const finalIncomeTax = Math.max(
    0,
    grossTax - creditValue - settlementBenefit,
  );
  const neto = bruto - (pensia + bituahLeumiAndHealth + finalIncomeTax);

  return {
    bruto,
    pensia,
    bituahLeumiAndHealth,
    incomeTax: finalIncomeTax,
    settlementBenefit,
    neto,
  };
};

const calculateShiftPay = (
  startTime,
  endTime,
  baseRate,
  travelRate,
  isHoliday,
) => {
  const start = new Date(startTime);
  let end = new Date(endTime);
  if (end < start) end.setDate(end.getDate() + 1);
  const base = Number(baseRate);

  // בדיקת משמרת לילה (7 שעות במקום 8)
  const checkNightShift = () => {
    let nightHours = 0;
    let current = new Date(start);
    while (current < end) {
      if (current.getHours() >= 22 || current.getHours() < 6)
        nightHours += 0.25;
      current.setMinutes(current.getMinutes() + 15);
    }
    return nightHours >= 2;
  };

  const regLimit = checkNightShift() ? 7 : 8;

  const calculateHours = (segStart, segEnd, forceWeekday = false) => {
    let res = {
      h100: 0,
      h125e: 0,
      h150e: 0,
      h150s: 0,
      h175s: 0,
      h200s: 0,
      rPay: 0,
      ePay: 0,
      rHours: 0,
      eHours: 0,
    };
    const duration = (segEnd - segStart) / (1000 * 60 * 60);
    const globalOffset = (segStart - start) / (1000 * 60 * 60);

    for (let i = 0; i < duration; i += 0.25) {
      const currentH = globalOffset + i;
      const blockTime = new Date(segStart.getTime() + i * 3600000);

      // הגדרת סופ"ש או חג
      const isWeekendOrHoliday =
        !forceWeekday &&
        (isHoliday ||
          (blockTime.getDay() === 5 && blockTime.getHours() >= 16) ||
          blockTime.getDay() === 6 ||
          (blockTime.getDay() === 0 && blockTime.getHours() < 4));

      if (currentH < regLimit) {
        if (isWeekendOrHoliday) {
          res.h150s += 0.25;
          res.rPay += 0.25 * base * 1.5;
        } else {
          res.h100 += 0.25;
          res.rPay += 0.25 * base;
        }
        res.rHours += 0.25;
      } else if (currentH < regLimit + 2) {
        if (isWeekendOrHoliday) {
          res.h175s += 0.25;
          res.ePay += 0.25 * base * 1.75;
        } else {
          res.h125e += 0.25;
          res.ePay += 0.25 * base * 1.25;
        }
        res.eHours += 0.25;
      } else {
        if (isWeekendOrHoliday) {
          res.h200s += 0.25;
          res.ePay += 0.25 * base * 2;
        } else {
          res.h150e += 0.25;
          res.ePay += 0.25 * base * 1.5;
        }
        res.eHours += 0.25;
      }
    }
    return res;
  };

  const sundayCutoff = new Date(start);
  sundayCutoff.setDate(sundayCutoff.getDate() - sundayCutoff.getDay() + 7);
  sundayCutoff.setHours(4, 0, 0, 0);

  let final;
  if (start < sundayCutoff && end > sundayCutoff) {
    const p1 = calculateHours(start, sundayCutoff);
    const p2 = calculateHours(sundayCutoff, end, true);
    final = {
      p: p1.rPay + p1.ePay + p2.rPay + p2.ePay,
      h100: p1.h100 + p2.h100,
      h125e: p1.h125e + p2.h125e,
      h150e: p1.h150e + p2.h150e,
      h150s: p1.h150s + p2.h150s,
      h175s: p1.h175s + p2.h175s,
      h200s: p1.h200s + p2.h200s,
      rh: p1.rHours + p2.rHours,
      eh: p1.eHours + p2.eHours,
      rp: p1.rPay + p2.rPay,
      ep: p1.ePay + p2.ePay,
    };
  } else {
    const r = calculateHours(start, end);
    final = {
      p: r.rPay + r.ePay,
      h100: r.h100,
      h125e: r.h125e,
      h150e: r.h150e,
      h150s: r.h150s,
      h175s: r.h175s,
      h200s: r.h200s,
      rh: r.rHours,
      eh: r.eHours,
      rp: r.rPay,
      ep: r.ePay,
    };
  }

  const travel = Number(travelRate || 0);
  return {
    total_amount: Number((final.p + travel).toFixed(2)),
    reg_hours: Number(final.rh.toFixed(2)),
    extra_hours: Number(final.eh.toFixed(2)),
    reg_pay_amount: Number(final.rp.toFixed(2)),
    extra_pay_amount: Number(final.ep.toFixed(2)),
    travel_pay_amount: Number(travel.toFixed(2)),
    h100_hours: Number(final.h100.toFixed(2)),
    h125_extra_hours: Number(final.h125e.toFixed(2)),
    h150_extra_hours: Number(final.h150e.toFixed(2)),
    h175_extra_hours: Number(final.h175s.toFixed(2)),
    h200_extra_hours: Number(final.h200s.toFixed(2)),
    h150_shabat: Number(final.h150s.toFixed(2)),
  };
};

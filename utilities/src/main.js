import { Client, Databases, Query, Users } from "node-appwrite";

export default async ({ req, res, log, error }) => {
  // 1. Initialize Client
  const client = new Client();
  client
    .setEndpoint("https://fra.cloud.appwrite.io/v1")
    .setProject("69583540003a5151db86")
    .setKey(
      "standard_a002d3461db36e01878442889155d73f93117af56a89806990bd8fe23a4a8f897eb54db55ac24c1017154e037862d2fc372fc4e765c20127fe8c26403f9d076939f532476f631add4f375befa84833fd38d1b0db02d0f1d48cd72d35bf0f84c77242bbdefa08ce5fc0a00afde021aeebec192ab59e8be31bfb5f8ff7f6bfcb9b",
    );

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
        return res.json({ message: "All data deleted successfully" });
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

        // שליפת נתוני יישוב ונקודות זיכוי מהפרופיל
        const profileRes = await databases.listDocuments(
          "695835c0002144f7a605",
          "users_prefs",
          [Query.equal("user_id", user_id), Query.limit(1)],
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
            h150_holiday: 0,
            h175_holiday: 0,
            h200_holiday: 0,
            base_rate: baseRate,
            is_training: type === "training",
            is_vacation: type === "vacation",
            start_time: startTime,
            end_time: endTime,
          };
        } else {
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
    error("Error: " + err.message);
    return res.json(
      { error: "Internal Server Error", details: err.message },
      500,
    );
  }
};

// --- Helper Functions 2026 ---

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

  // מדרגות מס הכנסה 2026
  let grossTax = 0;
  if (bruto <= 7010) grossTax = bruto * 0.1;
  else if (bruto <= 10060) grossTax = 701 + (bruto - 7010) * 0.14;
  else if (bruto <= 16150) grossTax = 701 + 427 + (bruto - 10060) * 0.2;
  else if (bruto <= 22440) grossTax = 701 + 427 + 1218 + (bruto - 16150) * 0.31;
  else grossTax = 701 + 427 + 1218 + 1950 + (bruto - 22440) * 0.35;

  const creditValue = points * 242; // שווי נקודה 2026

  // חישוב הטבת יישוב (מה-PDF של 2026)
  let settlementBenefit = 0;
  if (sPercent > 0 && sAnnualCap > 0) {
    const monthlyCap = sAnnualCap / 12;
    settlementBenefit = Math.min(bruto, monthlyCap) * (sPercent / 100);
  }

  const finalIncomeTax = Math.max(
    0,
    grossTax - creditValue - settlementBenefit,
  );
  const totalDeductions = pensia + bituahLeumiAndHealth + finalIncomeTax;

  return {
    bruto: Number(bruto.toFixed(2)),
    pensia: Number(pensia.toFixed(2)),
    bituahLeumiAndHealth: Number(bituahLeumiAndHealth.toFixed(2)),
    incomeTax: Number(finalIncomeTax.toFixed(2)),
    settlementBenefit: Number(settlementBenefit.toFixed(2)),
    neto: Number((bruto - totalDeductions).toFixed(2)),
    totalDeductions: Number(totalDeductions.toFixed(2)),
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
    let rPay = 0,
      ePay = 0,
      rHours = 0,
      eHours = 0;
    let h100 = 0,
      h125e = 0,
      h150e = 0,
      h150s = 0,
      h175s = 0,
      h200s = 0;

    const duration = (segEnd - segStart) / 3600000;
    const globalOffset = (segStart - start) / 3600000;

    for (let i = 0; i < duration; i += 0.25) {
      const currentH = globalOffset + i;
      const blockTime = new Date(segStart.getTime() + i * 3600000);

      const isWeekendOrHoliday =
        !forceWeekday &&
        (isHoliday ||
          (blockTime.getDay() === 5 && blockTime.getHours() >= 16) ||
          blockTime.getDay() === 6 ||
          (blockTime.getDay() === 0 && blockTime.getHours() < 4));

      if (currentH < regLimit) {
        if (isWeekendOrHoliday) {
          h150s += 0.25;
          rPay += 0.25 * base * 1.5;
        } else {
          h100 += 0.25;
          rPay += 0.25 * base;
        }
        rHours += 0.25;
      } else if (currentH < regLimit + 2) {
        if (isWeekendOrHoliday) {
          h175s += 0.25;
          ePay += 0.25 * base * 1.75;
        } else {
          h125e += 0.25;
          ePay += 0.25 * base * 1.25;
        }
        eHours += 0.25;
      } else {
        if (isWeekendOrHoliday) {
          h200s += 0.25;
          ePay += 0.25 * base * 2;
        } else {
          h150e += 0.25;
          ePay += 0.25 * base * 1.5;
        }
        eHours += 0.25;
      }
    }
    return {
      rPay,
      ePay,
      rHours,
      eHours,
      h100,
      h125e,
      h150e,
      h150s,
      h175s,
      h200s,
    };
  };

  const sundayCutoff = new Date(start);
  sundayCutoff.setDate(sundayCutoff.getDate() - sundayCutoff.getDay() + 7);
  sundayCutoff.setHours(4, 0, 0, 0);

  let res;
  if (start < sundayCutoff && end > sundayCutoff) {
    const p1 = calculateHours(start, sundayCutoff);
    const p2 = calculateHours(sundayCutoff, end, true);
    res = {
      p: p1.rPay + p1.ePay + p2.rPay + p2.ePay,
      rh: p1.rHours + p2.rHours,
      eh: p1.eHours + p2.eHours,
      rp: p1.rPay + p2.rPay,
      ep: p1.ePay + p2.ePay,
      h100: p1.h100 + p2.h100,
      h125e: p1.h125e + p2.h125e,
      h150e: p1.h150e + p2.h150e,
      h150s: p1.h150s + p2.h150s,
      h175s: p1.h175s + p2.h175s, // נוסף כדי למנוע NaN
      h200s: p1.h200s + p2.h200s, // נוסף כדי למנוע NaN
    };
  } else {
    res = calculateHours(start, end);
    // התאמת שמות המשתנים למבנה האחיד
    res = {
      p: res.rPay + res.ePay,
      rh: res.rHours,
      eh: res.eHours,
      rp: res.rPay,
      ep: res.ePay,
      h100: res.h100,
      h125e: res.h125e,
      h150e: res.h150e,
      h150s: res.h150s,
      h175s: res.h175s,
      h200s: res.h200s,
    };
  }

  const travel = Number(travelRate || 0);

  return {
    total_amount: Number((res.p + travel).toFixed(2)),
    reg_hours: Number(res.rh.toFixed(2)),
    extra_hours: Number(res.eh.toFixed(2)),
    reg_pay_amount: Number(res.rp.toFixed(2)),
    extra_pay_amount: Number(res.ep.toFixed(2)),
    travel_pay_amount: Number(travel.toFixed(2)),
    h100_hours: Number(res.h100.toFixed(2)),

    h125_extra_hours: Number(res.h125e.toFixed(2)),
    h150_extra_hours: Number(res.h150e.toFixed(2)),

    h175_extra_hours: isHoliday ? 0 : Number(res.h175s.toFixed(2)),
    h200_extra_hours: isHoliday ? 0 : Number(res.h200s.toFixed(2)),

    h150_shabat: isHoliday ? 0 : Number(res.h150s.toFixed(2)),

    h150_holiday: isHoliday ? Number(res.h150s.toFixed(2)) : 0,
    h175_holiday: isHoliday ? Number(res.h175s.toFixed(2)) : 0,
    h200_holiday: isHoliday ? Number(res.h200s.toFixed(2)) : 0,
  };
};

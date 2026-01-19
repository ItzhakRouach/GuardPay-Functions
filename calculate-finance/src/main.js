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

  const { action, payload } = body;
  try {
    if (action === "CALCULATE_SALARY") {
      const {
        regularPay,
        extraPay,
        travelPay,
        training_pay = 0,
        vacation_pay = 0,
      } = payload;

      const result = calculateSalary(
        regularPay,
        extraPay,
        travelPay,
        training_pay,
        vacation_pay,
      );
      log("Salary calculate successfully");
      return res.json(result);
    }

    if (action === "CALCULATE_SHIFT") {
      const { startTime, endTime, baseRate, travelRate, type, user_id } =
        payload;
      log(`Calculating shift for user: ${user_id || "annonymous"}`);

      // initilize result var to hold the calculation of the shift
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
        result = calculateShiftPay(startTime, endTime, baseRate, travelRate);
        result.is_training = false;
        result.is_vacation = false;
        result.start_time = startTime;
        result.end_time = endTime;
        result.base_rate = Number(baseRate);
      }
      log("Shift calculate successfully");
      // return the result to the user
      return res.json(result);
    }
  } catch (e) {
    error("Calculation error: " + err.message);
    return res.json(
      { error: "Internal Server Error", details: err.message },
      500,
    );
  }
};

// Calculate Monthly Salary of User
const calculateSalary = (
  regularPay,
  extraPay,
  travelPay,
  training_pay = 0,
  vacation_pay = 0,
) => {
  const bruto = regularPay + extraPay + travelPay + training_pay + vacation_pay;

  // --- 1. Pensia calculation 7% regulat hours , 7% extra hours 5% travel  ---
  const pensia = regularPay * 0.07 + extraPay * 0.07 + travelPay * 0.05;

  // --- 2. Bituah Leumi & Health (Split Rate) ---
  const thresholdBL = 7522;
  let bituahLeumiAndHealth = 0;

  if (bruto <= thresholdBL) {
    bituahLeumiAndHealth = bruto * 0.035;
  } else {
    bituahLeumiAndHealth = thresholdBL * 0.035 + (bruto - thresholdBL) * 0.12;
  }

  // --- 3. Income Tax ---
  let grossTax = 0;
  if (bruto <= 7010) {
    grossTax = bruto * 0.1;
  } else if (bruto <= 10060) {
    grossTax = 710 + (bruto - 7010) * 0.14;
  } else if (bruto <= 16150) {
    grossTax = 710 + 427 + (bruto - 10060) * 0.2;
  } else {
    grossTax = 710 + 427 + 1218 + (bruto - 16150) * 0.31;
  }

  // --- 4. Tax Credit Points (Nekudot Zichuy) ---
  const points = 2.25;
  const creditValue = points * 242;
  const finalIncomeTax = Math.max(0, grossTax - creditValue);

  // --- 5. Final Neto ---
  const totalDeductions = pensia + bituahLeumiAndHealth + finalIncomeTax;
  const neto = bruto - totalDeductions;

  return {
    bruto,
    pensia,
    bituahLeumiAndHealth,
    incomeTax: finalIncomeTax,
    neto,
    totalDeductions,
  };
};

// Calculate User shift
const calculateShiftPay = (startTime, endTime, baseRate, travelRate) => {
  const start = new Date(startTime);
  let end = new Date(endTime);
  if (end < start) end.setDate(end.getDate() + 1);

  const base = Number(baseRate);

  const isNightShift = () => {
    let nightHours = 0;
    let current = new Date(start);
    while (current < end) {
      const hour = current.getHours();
      if (hour >= 22 || hour < 6) nightHours += 0.25;
      current.setMinutes(current.getMinutes() + 15);
    }
    return nightHours >= 2;
  };

  const regLimit = isNightShift() ? 7 : 8;

  const getSundayCutoff = (d) => {
    const cutoff = new Date(d);
    const day = cutoff.getDay();
    const diff = cutoff.getDate() - day + (day === 0 ? 0 : 7);
    cutoff.setDate(diff);
    cutoff.setHours(4, 0, 0, 0);
    return cutoff;
  };
  const sundayCutoff = getSundayCutoff(start);

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

    const duration = (segEnd - segStart) / (1000 * 60 * 60);
    const globalStartHour = (segStart - start) / (1000 * 60 * 60);

    for (let i = 0; i < duration; i += 0.25) {
      const currentHour = globalStartHour + i;
      const step = 0.25;
      const blockTime = new Date(segStart.getTime() + i * 60 * 60 * 1000);

      const isWeekendBlock =
        !forceWeekday &&
        ((blockTime.getDay() === 5 && blockTime.getHours() >= 16) ||
          blockTime.getDay() === 6 ||
          (blockTime.getDay() === 0 && blockTime.getHours() < 4));

      if (currentHour < regLimit) {
        // Regulars Hours
        if (isWeekendBlock) {
          h150s += step;
          rPay += step * (base * 1.5);
        } else {
          h100 += step;
          rPay += step * base;
        }
        rHours += step;
      } else if (currentHour < regLimit + 2) {
        // First Two extra hours
        if (isWeekendBlock) {
          h175s += step;
          ePay += step * (base * 1.75);
        } else {
          h125e += step;
          ePay += step * (base * 1.25);
        }
        eHours += step;
      } else {
        // Third extra hours and so on
        if (isWeekendBlock) {
          h200s += step;
          ePay += step * (base * 2.0);
        } else {
          h150e += step;
          ePay += step * (base * 1.5);
        }
        eHours += step;
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
      h175s: p1.h175s + p2.h175s,
      h200s: p1.h200s + p2.h200s,
    };
  } else {
    const r = calculateHours(start, end);
    res = {
      p: r.rPay + r.ePay,
      rh: r.rHours,
      eh: r.eHours,
      rp: r.rPay,
      ep: r.ePay,
      h100: r.h100,
      h125e: r.h125e,
      h150e: r.h150e,
      h150s: r.h150s,
      h175s: r.h175s,
      h200s: r.h200s,
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
    h175_extra_hours: Number(res.h175s.toFixed(2)),
    h200_extra_hours: Number(res.h200s.toFixed(2)),
    h150_shabat: Number(res.h150s.toFixed(2)),
  };
};

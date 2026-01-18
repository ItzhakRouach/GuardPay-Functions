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
    const {
      regularPay,
      extraPay,
      travelPay,
      training_pay = 0,
      vacation_pay = 0,
    } = body;

    const result = calculateSalary(
      regularPay,
      extraPay,
      travelPay,
      training_pay,
      vacation_pay,
    );
    log("Salary calculate successfully");
    return res.json(result);
  } catch (e) {
    error("Calculation error: " + err.message);
    return res.json(
      { error: "Internal Server Error", details: err.message },
      500,
    );
  }
};

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

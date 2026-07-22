# utilities (calculate-finance) — Appwrite Function

Action-dispatched function (`{ action, payload }`). Actions:
- `CALCULATE_SALARY`, `CALCULATE_SHIFT` — legacy salary math (app computes locally now).
- `DELETE_ACCOUNT` — user-session gated account wipe.
- `FIND_ACCOUNT`, `IMPORT_WEEK` — מִשְׁמֶרֶת (AutoShiftSchedule) integration, gated by
  the `MISHMERET_SECRET` env var. Never callable from a user session.

## One-time console setup for the מִשְׁמֶרֶת integration

1. **shifts_history attributes** (Databases → shifts_history → Attributes):
   - `import_source` — String, size 32, optional (no default)
   - `import_key`   — String, size 64, optional (no default)
   Then add a **key index** on `[user_id, import_key]` (Indexes tab) — queries
   on these attributes fail without it. Wait for both attributes + index to be
   "available" before deploying.
2. **Function env vars** (Functions → utilities → Settings → Variables):
   - `TZ` = `Asia/Jerusalem`   (salary math is local-time based — REQUIRED)
   - `MISHMERET_SECRET` = a long random string, e.g. `openssl rand -hex 32`
   - `APPWRITE_DB_ID` = `695835c0002144f7a605`
3. **Redeploy** this function (console upload of `utilities/`, or Git integration).
4. **Executor API key for מִשְׁמֶרֶת** (Overview → Integrations → API keys):
   name `mishmeret-executor`, scope **executions.write only**.
5. Hand מִשְׁמֶרֶת (Vercel + .env.local): endpoint, project id, this function's id,
   the executor key, and `MISHMERET_SECRET`.

## Smoke test (after deploy)

```bash
# FIND_ACCOUNT (expect ok:true with your name)
curl -s -X POST "https://fra.cloud.appwrite.io/v1/functions/697d0f3c001bba7f03d2/executions" \
  -H "X-Appwrite-Project: 69583540003a5151db86" \
  -H "X-Appwrite-Key: <EXECUTOR_KEY>" -H "content-type: application/json" \
  -d '{"body":"{\"action\":\"FIND_ACCOUNT\",\"payload\":{\"secret\":\"<MISHMERET_SECRET>\",\"email\":\"<your-guardpay-email>\"}}","async":false,"method":"POST","path":"/"}'
# IMPORT_WEEK with one Friday-night shift (expect ok:true, created:1), then
# compare total_amount + buckets against the SAME shift added by hand in the app.
# Wrong secret (expect 401 UNAUTHORIZED in responseBody):
# ...same call with "secret":"nope"
# Existing actions still alive: CALCULATE_SHIFT with a weekday morning payload.
```

Note: the hard-coded server API key in `src/main.js` predates this work and is
committed to Git — rotate it and move it to an env var when possible.

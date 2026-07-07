# Billing hard-cap breaker

A GCP **Budget is alert-only** — it emails you while the meter keeps running.
This function is the actual circuit breaker: when spend passes `CAP_USD`
(default **$50**, set higher once real usage is known), it **detaches billing
from the project**, which stops all paid usage (and takes the app offline —
that's the point; recovery is manually re-linking billing after fixing the
root cause).

Deployed **standalone** — never alongside the app — so a bad app deploy can't
take the breaker with it (a lesson learned).

## One-time setup (console, ~5 minutes, needs the billing-account owner = you)

1. **Create the budget with a Pub/Sub topic**
   [console.cloud.google.com/billing](https://console.cloud.google.com/billing)
   → Budgets & alerts → Create budget → scope: project `degree-planner-app`,
   amount: $50/month → under "Manage notifications" check **"Connect a
   Pub/Sub topic"** → create topic `billing-alerts` in `degree-planner-app`.
   (Also keep the default email alerts at 50/90/100%.)

2. **Deploy the function** (from this folder):
   ```
   gcloud functions deploy capBilling --gen2 --runtime=nodejs20 \
     --project=degree-planner-app --region=us-east4 \
     --trigger-topic=billing-alerts --entry-point=capBilling \
     --set-env-vars CAP_USD=50
   ```
   (Or via console: Cloud Functions → Create → trigger: Pub/Sub `billing-alerts`,
   paste `index.js` + `package.json`.)

3. **Grant the brake permission** (the step everyone forgets — without it the
   function runs and silently does nothing):
   Billing account → **Permissions** → add the function's runtime service
   account (`degree-planner-app@appspot.gserviceaccount.com`, or the SA shown
   on the function's Details tab) with role **Billing Account Administrator**.
   Also enable the **Cloud Billing API** on the project.

4. **Test the wiring** (safe — cost below cap): publish a test message to
   `billing-alerts` with body `{"costAmount": 1, "budgetAmount": 50}` and
   check the function logs show `Budget event: cost=$1 cap=$50`.

## Verify it would fire
Publish `{"costAmount": 999, "budgetAmount": 50}` **only if you're prepared
for billing to actually detach** (it will). Otherwise trust the unit path:
the log line + the IAM grant are the two things that matter.

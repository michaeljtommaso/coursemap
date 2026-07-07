// Billing hard-cap breaker (docs/specs/002 §8c, house-standard capBilling pattern).
// A GCP Budget is ALERT-ONLY — this function is the actual circuit breaker:
// when the budget's Pub/Sub message reports spend over CAP_USD, it DETACHES
// BILLING, taking the project offline. Emergency brake semantics:
//   - CAP_USD is a generous ceiling — it should only ever fire on a true runaway.
//   - Recovery is MANUAL (re-link the billing account in the console) — fix the
//     root cause first.
//   - Deployed STANDALONE (this folder has its own firebase config) so an app
//     deploy can never break the breaker.
const functions = require("@google-cloud/functions-framework");
const { CloudBillingClient } = require("@google-cloud/billing");

const PROJECT_ID = "degree-planner-app";
const CAP_USD = Number(process.env.CAP_USD ?? 50);

const billing = new CloudBillingClient();

functions.cloudEvent("capBilling", async (cloudEvent) => {
  const data = JSON.parse(
    Buffer.from(cloudEvent.data.message.data, "base64").toString()
  );
  const cost = Number(data.costAmount);
  console.log(`Budget event: cost=$${cost} cap=$${CAP_USD}`);
  if (!(cost > CAP_USD)) return;

  const name = `projects/${PROJECT_ID}`;
  const [info] = await billing.getProjectBillingInfo({ name });
  if (!info.billingEnabled) {
    console.log("Billing already disabled — nothing to do.");
    return;
  }
  // THE BRAKE: detach billing → project reverts toward free-tier limits and
  // paid services stop. This WILL take the app offline. That is the point.
  await billing.updateProjectBillingInfo({
    name,
    projectBillingInfo: { billingAccountName: "" },
  });
  console.log(`BILLING DETACHED at $${cost} (cap $${CAP_USD}).`);
});

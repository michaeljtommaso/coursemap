// Enable Firestore PITR (7-day continuous recovery) + daily managed backups
// (14-day retention) — the Blaze-day checklist from docs/specs/002 §8d.
// Runbook reminder: "a backup you've never restored isn't a backup" — do one
// tested restore into a throwaway database and time it (RTO) before launch.
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=<key> npx tsx enable-backups.ts
import { GoogleAuth } from "google-auth-library";

const PROJECT = "degree-planner-app";
const BASE = "https://firestore.googleapis.com/v1";

async function main() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // 1. PITR
  const dbName = `projects/${PROJECT}/databases/(default)`;
  const pitrRes = await fetch(
    `${BASE}/${dbName}?updateMask=pointInTimeRecoveryEnablement`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_ENABLED",
      }),
    }
  );
  console.log("PITR:", pitrRes.status, pitrRes.ok ? "enabled (7-day window)" : await pitrRes.text());

  // 2. Daily backup schedule, 14-day retention (idempotent-ish: list first)
  const listRes = await fetch(`${BASE}/${dbName}/backupSchedules`, { headers });
  const existing = (await listRes.json()) as { backupSchedules?: { name: string }[] };
  if (existing.backupSchedules?.length) {
    console.log("Backup schedule already exists:", existing.backupSchedules.map((b) => b.name));
  } else {
    const schedRes = await fetch(`${BASE}/${dbName}/backupSchedules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        retention: `${14 * 24 * 3600}s`,
        dailyRecurrence: {},
      }),
    });
    console.log(
      "Daily backups:",
      schedRes.status,
      schedRes.ok ? "scheduled (14-day retention)" : await schedRes.text()
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

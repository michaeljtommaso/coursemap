// scripts/classagent.tsx
// One-time setup: cd scripts && npm install
// Run:           cd scripts && npx tsx classagent.tsx
// Override semester: ROSTER=SP26 npx tsx classagent.tsx

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local from the app directory (no dotenv dependency needed)
function loadEnvFile(filePath: string): void {
  try {
    const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // env file absent — fall back to whatever is already in process.env
  }
}

loadEnvFile(resolve(__dirname, '../cornell-degree-planner/.env.local'));

const ROSTER = process.env.ROSTER ?? 'FA25';
const SUBJECTS = [
  'CS', 'ECE', 'MAE', 'ORIE', 'ENGRD', 'ENGRI', 'ENGRG',
  'MATH', 'PHYS', 'CHEM', 'CHEME', 'CEE', 'MSE',
];
const BASE = 'https://classes.cornell.edu/api/2.0';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  const missing = [!supabaseUrl && 'VITE_SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  console.error(`Missing env vars: ${missing.join(', ')}`);
  console.error('Add them to cornell-degree-planner/.env.local');
  console.error('  SUPABASE_SERVICE_ROLE_KEY — Supabase dashboard → Project Settings → API');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function fetchSubject(roster: string, subject: string): Promise<any[]> {
  const url = `${BASE}/search/classes.json?roster=${roster}&subject=${subject}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  HTTP ${res.status} fetching ${subject}`);
    return [];
  }
  const json = await res.json() as { data?: { classes?: any[] } };
  return json.data?.classes ?? [];
}

function parseOffered(lastTermsOffered: string | null): string[] {
  if (!lastTermsOffered) return [];
  const seen = new Set<string>();
  for (const term of lastTermsOffered.split(',')) {
    const t = term.trim();
    if (t.endsWith('FA')) seen.add('FA');
    else if (t.endsWith('SP')) seen.add('SP');
    else if (t.endsWith('SU')) seen.add('SU');
    else if (t.endsWith('WI')) seen.add('WI');
  }
  return [...seen];
}

async function main() {
  console.log(`Syncing roster ${ROSTER} — subjects: ${SUBJECTS.join(', ')}\n`);
  const now = new Date().toISOString();

  for (const subject of SUBJECTS) {
    const classes = await fetchSubject(ROSTER, subject);

    if (classes.length === 0) {
      console.log(`${subject}: no courses returned`);
    } else {
      const rows = classes.map((c: any) => ({
        id:          `${c.subject}-${c.catalogNbr}`,
        subject:     c.subject,
        number:      c.catalogNbr,
        title:       c.titleLong,
        credits_min: c.enrollGroups?.[0]?.unitsMinimum ?? null,
        credits_max: c.enrollGroups?.[0]?.unitsMaximum ?? null,
        description: c.description ?? null,
        offered:     parseOffered(c.lastTermsOffered ?? null),
        roster_id:   String(c.crseId),
        updated_at:  now,
      }));

      const { error } = await supabase
        .from('courses')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: false });

      if (error) {
        if (error.message.includes('row-level security')) {
          console.error(`${subject}: RLS blocked — SUPABASE_SERVICE_ROLE_KEY is wrong or missing (check Supabase → Project Settings → API)`);
        } else {
          console.error(`${subject}: ${error.message}`);
        }
      } else {
        console.log(`${subject}: upserted ${rows.length} courses`);
      }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\nDone.');
}

main();

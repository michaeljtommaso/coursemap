/**
 * Engineering liberal studies (spec 037): the seven groups and the group rules
 * for both current entering-class policies, and Engineering's approved petitions
 * list.
 *
 * GENERATED DATA: 2026-11-07.json is written by scripts/build-liberal-studies.ts
 * from committed sources (scripts/seed-data/sources/liberal-studies-*.json). Don't
 * edit the JSON by hand; re-run the script (`npx tsx build-liberal-studies.ts`,
 * `--check` to verify) from scripts/.
 *
 * Counting rule shared by both cohorts (spec 037 D2): a roster tag
 * (`<CATEGORY>-<COLLEGE>`) counts in a group when its base (split at the LAST
 * hyphen) is in the group's `bases`, or the full tag is in the group's `exact`.
 * `D-HE` and `D-HA` count nowhere.
 */
import data from "./2026-11-07.json";

export type GroupDef = {
  id: "g1" | "g2" | "g3" | "g4" | "g5" | "g6" | "g7";
  /** Short chip label: "Arts & Culture", "History", "Ethics & Mind",
   *  "Social Science", "Language", "Communications", "Race & Equity". */
  label: string;
  /** Cornell's group name. */
  name: string;
  /** Tag bases that count in this group for ANY college suffix ("CA", "LA", "LAD", "ALC"). */
  bases: string[];
  /** Full tags that count only as written ("SCD-HA"; "SCD-AS", "D-AG"). */
  exact: string[];
};

export type Cohort = {
  id: "fa2024" | "fa2020";
  /** Roster slug of the first entry term the policy covers ("FA24", "FA20").
   *  fa2020 applies to FA20..SP24 and, with a note, to earlier entrants. */
  enteredFrom: string;
  /** The seven groups, in order. */
  groups: GroupDef[];
  rules: {
    requiredCourses: 6;
    requiredCredits: 18;
    minGroups: 3;
    /** { g6: 2 } */
    groupMax: Record<string, number>;
    /** fa2024: { g7: 3 }; fa2020: {} */
    groupMinCredits: Record<string, number>;
    minCoursesAtOrAbove: { number: 2000; count: 2 };
  };
  source: { url: string; quote: string[] };
};

export type PetitionEntry = {
  /** Base codes as Engineering printed them ("SBA", "SSC"); "SCD" has no suffix. */
  categories: string[];
  /** As printed ("1.5", "2-3"). */
  credits: string;
  /** As printed ("A&S", "Hotel", …). */
  college: string;
  /** "SU24" when the approval covers only placements through Summer 2024. */
  takenThrough?: string;
};

export type LiberalStudiesData = {
  version: string;
  sources: { petitionsUrl: string; petitionsRevised: string; policyUrls: string[] };
  /** [fa2024, fa2020] */
  cohorts: Cohort[];
  /** Course id in dash form ("AEM-2710") → its petition rows. */
  petitions: Record<string, PetitionEntry[]>;
};

export const LIBERAL_STUDIES: LiberalStudiesData = data as LiberalStudiesData;
export default LIBERAL_STUDIES;

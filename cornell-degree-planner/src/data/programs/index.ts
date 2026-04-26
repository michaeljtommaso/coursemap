import { cornellMe2026 } from "./cornell-me-2026";
import { cornellCs2026 } from "./cornell-cs-2026";
import type { ProgramMap } from "@/types/curriculum";

export const programRegistry: Record<string, ProgramMap> = {
  "cornell-me-2026": cornellMe2026,
  "cornell-cs-2026": cornellCs2026,
};

export const programOptions = [
  {
    id: "cornell-me-2026",
    institution: "Cornell University",
    college: "College of Engineering",
    program: "Mechanical Engineering, B.S.",
    catalogYear: "2026–2027",
  },
  {
    id: "cornell-cs-2026",
    institution: "Cornell University",
    college: "College of Engineering",
    program: "Computer Science, B.S.",
    catalogYear: "2026–2027",
  },
];

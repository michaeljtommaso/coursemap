/**
 * Official Cornell pages for each major, keyed by the program's short name
 * (programs/{id}.shortName — stable across catalog years, unlike the id).
 *
 *   majorPage  the department's page for the undergraduate major
 *   flowchart  the college's official major flowchart image for the newest
 *              entering class (Duffield publishes one set per class; the 2026
 *              set is linked from FLOWCHART_INDEX). CALS majors have none.
 *
 * Collected and checked (HTTP 200) on 2026-10-17 from
 * https://www.duffield.cornell.edu/majors-minors/ and FLOWCHART_INDEX. When a
 * new flowchart set posts (about August each year), update the paths below.
 */

export const FLOWCHART_INDEX =
  "https://www.duffield.cornell.edu/advising/choose-your-academic-pathway/engineering-major-flowcharts/";

/** Entering class the flowchart links below belong to. */
export const FLOWCHART_YEAR = 2026;

const FLOWCHART_BASE = "https://www.duffield.cornell.edu/wp-content/uploads/flowcharts/2026/";

export type ProgramLinks = {
  majorPage: string;
  flowchart: string | null;
};

const LINKS: Record<string, ProgramLinks> = {
  BE: {
    majorPage: "https://cals.cornell.edu/education/degrees-programs/biological-engineering-major",
    flowchart: `${FLOWCHART_BASE}Bio-Eng-BE.jpg`,
  },
  BME: {
    majorPage: "https://www.duffield.cornell.edu/bme/major/",
    flowchart: `${FLOWCHART_BASE}BioMed-Eng-BME.jpg`,
  },
  CE: {
    majorPage: "https://www.duffield.cornell.edu/cee/civil-engineering-major/",
    flowchart: `${FLOWCHART_BASE}Civil-Eng-CE.jpg`,
  },
  ChemE: {
    majorPage: "https://www.duffield.cornell.edu/cbe/major/",
    flowchart: `${FLOWCHART_BASE}Chem-Eng-ChemE.jpg`,
  },
  Comm: {
    majorPage: "https://cals.cornell.edu/communication/undergraduate",
    flowchart: null,
  },
  CS: {
    majorPage: "https://www.cs.cornell.edu/bachelor-science-computer-science",
    flowchart: `${FLOWCHART_BASE}Comp-Sci-CS.jpg`,
  },
  // Earth and Atmospheric Sciences is now Earth and Climate Sciences.
  EAS: {
    majorPage: "https://www.duffield.cornell.edu/eas/degree/earth-climate-sciences-bs-requirements/",
    flowchart: `${FLOWCHART_BASE}Earth-Cli-Sci-ECS.jpg`,
  },
  ECE: {
    majorPage: "https://www.duffield.cornell.edu/ece/major/",
    flowchart: `${FLOWCHART_BASE}Elec-Comp-Eng-ECE.jpg`,
  },
  ENVE: {
    majorPage: "https://www.duffield.cornell.edu/cee/environmental-engineering-major/",
    flowchart: `${FLOWCHART_BASE}Env-Eng-ENVE.jpg`,
  },
  EP: {
    majorPage: "https://www.duffield.cornell.edu/aep/major-engineering-physics/",
    flowchart: `${FLOWCHART_BASE}Eng-Phys-EP.jpg`,
  },
  InfoSci: {
    majorPage: "https://infosci.cornell.edu/bachelor-science-information-science",
    flowchart: null,
  },
  ISST: {
    majorPage: "https://infosci.cornell.edu/bachelor-science-information-science-systems-and-technology",
    flowchart: `${FLOWCHART_BASE}Inform-Sys-Tech-ISST.jpg`,
  },
  ME: {
    majorPage: "https://www.duffield.cornell.edu/mae/major/",
    flowchart: `${FLOWCHART_BASE}Mech-Eng-ME.jpg`,
  },
  MSE: {
    majorPage: "https://www.duffield.cornell.edu/mse/major/",
    flowchart: `${FLOWCHART_BASE}Mat-Sci-Eng-MSE.jpg`,
  },
  ORE: {
    majorPage: "https://www.duffield.cornell.edu/orie/major/",
    flowchart: `${FLOWCHART_BASE}Oper-Res-Eng-ORE.jpg`,
  },
};

/** The official links for a program, or null for one we have none for. */
export function programLinks(shortName: string | null | undefined): ProgramLinks | null {
  if (!shortName) return null;
  return LINKS[shortName] ?? null;
}

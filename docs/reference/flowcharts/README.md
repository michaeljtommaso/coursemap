# Official Cornell Engineering Flowcharts

Ground truth for verifying seed/program data (spec 005 beta gate).

Downloaded 2026-07-07 from the official index:
https://www.duffield.cornell.edu/advising/choose-your-academic-pathway/engineering-major-flowcharts/

Files are the **2025 set** (students entering Fall 2025) — the newest published;
a 2026 set will likely appear ~August 2026 (they publish per entering class,
the 2025 set was produced 2025-07-23). Our seed claims "2026–27 catalog"; treat
the 2025 charts as the closest official reference and re-check when 2026 posts.

| File | Major | Source filename |
|---|---|---|
| 2025-CS.jpg | Computer Science | CompSciCS.jpg |
| 2025-ECE.jpg | Electrical & Computer Engineering | ElectCompEngECE.jpg |
| 2025-ME.jpg | Mechanical Engineering | MechEngME.jpg |
| 2025-ORE.jpg | Operations Research & Engineering | OperResEngORE.jpg |

Chart legend (matters for our data model):
- **Solid arrow** = prerequisite → `slot_edges.edge_type = 'prereq'`
- **Double line** = prerequisite OR corequisite → `'coreq'`
- **Dashed arrow** = usually taken concurrently → `'concurrent'`
- Node shapes: circle = major program course, rectangle = common curriculum,
  triangle = engineering distribution, plain box = elective.

Nine more majors (BME, ChemE, CE, EP, ENVE, ISST, MSE, EAS, BE) exist at the
same index, years 2019–2025, if/when programs expand.

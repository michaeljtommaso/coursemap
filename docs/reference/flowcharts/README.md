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
| 2025-BE.jpg | Biological Engineering | BioEngBE.jpg |
| 2025-BME.jpg | Biomedical Engineering | BioMedEngBME.jpg |
| 2025-CHEME.jpg | Chemical Engineering | ChemEng.jpg |
| 2025-CE.jpg | Civil Engineering | CivilEngCE.jpg |
| 2025-EAS.jpg | Earth & Atmospheric Sciences | EarthAtmSciEAS.jpg |
| 2025-EP.jpg | Engineering Physics | EngPhysicsEP.jpg |
| 2025-ENVE.jpg | Environmental Engineering | EnvEngENVE.jpg |
| 2025-ISST.jpg | Information Science, Systems & Technology | InfoSciISST.jpg |
| 2025-MSE.jpg | Materials Science & Engineering | MatSciEngMSE.jpg |

The 9 majors below were downloaded 2026-07-07 (same source index) to digitize
into live program docs (`cornell-<code>-bs-2025`). Their per-program build
confidence notes live in `verification-2026-07.md`.

Chart legend (matters for our data model):
- **Solid arrow** = prerequisite → `slot_edges.edge_type = 'prereq'`
- **Double line** = prerequisite OR corequisite → `'coreq'`
- **Dashed arrow** = usually taken concurrently → `'concurrent'`
- Node shapes: circle = major program course, rectangle = common curriculum,
  triangle = engineering distribution, plain box = elective.

All 13 College of Engineering majors published for the 2025 entering class are
now mirrored here. Older sets (2019–2024) remain at the source index if needed.

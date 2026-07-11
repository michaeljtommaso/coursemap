# Product Thesis — Coursemap
### 2026-07-11 · the founding problem, in Michael's words

> This session started as a bug log and became a thesis. **This doc is the
> "why."** The other doc from today is the "what's broken":
> - `2026-07-11-vision-gap-and-graph-audit.md` — bugs, root causes, sequencing
>
> **Read this one first. It reprioritizes the audit.**

---

## 1. The founding problem — real, personal, unsolved

> *"I am building this tool because of a real problem I am facing as a Cornell
> engineering student, where I am finding it extremely difficult to figure out
> what classes I want to take and — furthermore — what major I want to major
> in.*
>
> *That's the problem I'm trying to solve: how do I, as a student, figure out
> what the hell I'm majoring in when there are so many classes to take and
> such a wide variety of things I'm interested in?"*

**The product's job:**
> **Help a student figure out what to major in, based on the classes they're
> actually interested in taking.**

This is not a scheduling tool that happens to track requirements. It is a
**major-discovery tool** that happens to produce a schedule.

---

## 2. ⚠️ THE INVERSION — the app is currently backwards

**What the app does today:** pick a major → we render its template → you fill
it in.

**What the thesis requires:** *tell us which classes pull at you → we tell you
which major that adds up to.*

This is the single biggest gap between the thesis and the build, and it is
larger than any individual bug in the audit doc.

**It also distinguishes Coursemap from a typical requirement tracker:**

| | Flow | Question it answers |
|---|---|---|
| **Typical tracker** | pick major → track requirements | *"Am I on track?"* |
| **Coursemap** | explore classes → **discover the major** | *"What should I even be doing?"* |

A tracker serves the student who **already knows.** We serve the student who
**doesn't** — which is the larger, more anxious, and completely unserved
population. It is also, not coincidentally, the population the north star was
always about.

### Consequences for the existing codebase
1. **The major-match engine is THE core feature, not a sidebar panel.**
   `useMajorMatch.ts` — 190 lines, no tests, greedy first-fit, no
   assignment/consumption — is currently the weakest code in the app and the
   most important. That inversion has to be fixed. (Audit doc #9: **promote to
   Tier 0/1.**)

2. **🔥 Audit item C6 is now FATAL, not minor.** The engine gives the
   *currently selected* program credit for completed/waived slots that other
   programs don't get (`useMajorMatch.ts:122`), so it **systematically ranks
   the major you already picked above the alternatives.**
   > A product whose entire purpose is helping you discover a major you have
   > *not* chosen has a discovery engine biased toward the one you already
   > chose. It actively defeats its own reason for existing.

3. **"Start from scratch / blank canvas" is the PRIMARY flow, not an escape
   hatch.** Forcing a major selection during onboarding contradicts the thesis
   on the very first screen. The student who most needs this product is the
   one who *cannot answer that question yet.*

4. **The graph (#3) is how you explore a field.** "What does CS 2110 lead to?"
   → 14 courses → *oh, that's what a CS major actually looks like from the
   inside.* The graph is not decoration on the plan; **it is the exploration
   mechanism for the major-discovery question.** This is why #3 stays Tier 0.

---

## 3. 🕐 THE TIME-HORIZON MODEL — the sharpest idea in this session

> *"Classes change a lot. Someone teaching a class I picked for senior year
> might not be teaching it freshman year. So the RateMyProfessor stuff is a
> big point for the next semester, but it's not valuable at all for four
> semesters down the line. What IS valuable four semesters out is course evals
> and course descriptions — figuring out what you like and what you don't."*

**Data has a shelf life. Nobody models this. We should.**

| Horizon | The question | Durable data | Worthless data |
|---|---|---|---|
| **Next semester** (enrollment week) | *"Should I take this, right now?"* | **Who's teaching** · meeting times · `openStatus` · schedule conflicts · **RMP** | — |
| **2–8 semesters out** (planning) | *"Do I even like this field?"* | **Course description** · **course evals** · prereq graph · what it unlocks | **The instructor — unknowable, and RMP is actively misleading** |

### The product implication
**A course card should show different information depending on how far out it
sits.**
- A **Fall 2026** card shows the professor, the time slot, and whether it's
  open.
- A **Spring 2029** card shows the description, the evals, and what it unlocks
  — and has the **honesty not to pretend it knows who's teaching.**

Showing a professor's RMP rating on a course four years out isn't just
useless — it's **a lie with a number attached**, and it will make students
plan around a person who won't be there.

### This resolves the course-evals contradiction
Michael dismissed course evals earlier this session (*"no one actually does
them, and if they do, they do them very quickly"*) and is now calling them
valuable. **Both are correct — they answer different questions:**
- Evals are **bad** at *"is this professor good right now?"* → that's RMP's job.
- Evals are **fine** at *"is this class worth my time, in general?"* → and
  that is exactly the long-horizon, major-discovery question.

**So course evals are back on the table — for the planning horizon only.**
(This is the `OfficialEvalsAdapter`, and it now has a
real job.)

---

## 4. Reconciling with the "enrollment week" reframe (correcting an earlier over-rotation)

Earlier today I argued: *"You're not building a degree planner, you're building
the enrollment-week tool."* **That was too clever and it's wrong as stated.**

The synthesis:

> **Enrollment week is the door. Major discovery is the room.**
>
> Students **show up** when they have to pick classes — that's the recurring,
> high-intent moment, and it's why the near-term features (schedule fit,
> who's teaching, is it open) matter and why they drive adoption.
>
> Students **stay** because we answered the bigger question they were too busy
> to ask: *what am I actually doing here?*

Do not confuse the entry point with the point. Build the door well — but the
room is the product.

---

## 5. What this reprioritizes across all three docs

| Item | Was | Now | Why |
|---|---|---|---|
| **#3 — derive the prereq graph** | Tier 0 (differentiator) | **Tier 0 (unchanged)** | It's the *exploration mechanism* for major discovery, not just a pretty map. |
| **#9 — major match engine** | Tier 3 (polish) | **🔥 Tier 0/1 — THE CORE FEATURE** | The entire thesis runs through it. It has no tests and a greedy matcher. |
| **C6 — match ranks your current major highest** | med bug | **🔥 FATAL** | Defeats the product's stated purpose. |
| **#12 — AP credit** | blocker | **blocker (unchanged)** | Still falsely blocks the exact freshman we serve. |
| **Onboarding: must pick a major** | not logged | **NEW — contradicts the thesis** | The student who needs us most can't answer it. Blank canvas must be primary. |
| **Time-horizon-aware cards** | not logged | **NEW — genuinely novel** | Nobody builds this. RMP near, evals/description far. |
| **RMP** | "parked, nice-to-have" | **near-horizon only, by design** | On a senior-year card it's a lie with a number attached. |
| **Course evals** | "low signal, dismissed" | **REINSTATED for the planning horizon** | Wrong tool for "is the prof good," right tool for "do I like this field." |

---

## 6. The one-sentence version

> **Coursemap helps you find your major by showing you where classes lead —
> and it tells you the truth about what it can and can't know, depending on
> how far out you're looking.**

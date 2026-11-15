import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExamTables } from "@/lib/credit/types";
import { ExamRow } from "./ExamRow";

const UNSET = "Engineering hasn't set which requirement this fills.";
const BIO_LIMIT = "Biological Sciences majors: elective credit only.";
const BIO_NOTE = "Other majors: places you out of 8 credits of introductory biology.";

const TABLES: ExamTables = {
  year: "2026-27",
  exams: [{ id: "ap-biology", family: "ap", name: "Biology", scale: ["1", "2", "3", "4", "5"] }],
  university: {
    awards: [{ exam: "ap-biology", scores: ["5"], courses: [], credits: 8, limits: [BIO_LIMIT], note: BIO_NOTE }],
  },
  overrides: {},
  engineering: {
    awards: [
      { exam: "ap-biology", scores: ["4", "5"], courses: ["BIOG-1101F"], credits: 4, limits: [UNSET] },
    ],
  },
} as unknown as ExamTables;

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const row = (props: Partial<Parameters<typeof ExamRow>[0]>) =>
  text(
    renderToStaticMarkup(
      <ExamRow
        def={TABLES.exams[0]}
        picked="5"
        onToggle={() => {}}
        tables={TABLES}
        college="cals"
        newPicksBlocked={false}
        showFamily={false}
        {...props}
      />
    )
  );

describe("ExamRow — lines worded for the student's major and board", () => {
  it("leaves out another major's line and drops the 'Other majors:' lead-in", () => {
    const t = row({ major: { name: "Animal Science (BS)" } });
    expect(t).not.toContain("Biological Sciences majors");
    expect(t).toContain("Places you out of 8 credits of introductory biology.");
  });

  it("shows everything as written before a major is known", () => {
    const t = row({ major: null });
    expect(t).toContain(BIO_LIMIT);
    expect(t).toContain(BIO_NOTE);
  });

  it("hides 'hasn't set' when the saved score fills a requirement, not for a different pick", () => {
    const fills = { score: "5", requirements: ["Biology Elective"] };
    expect(row({ college: "engineering", fills })).not.toContain("hasn't set");
    expect(row({ college: "engineering", fills, picked: "4" })).toContain("hasn't set");
    expect(row({ college: "engineering" })).toContain("hasn't set");
  });

  it("shows what the picked score earns inline, and drops the college's own limits the host shows once", () => {
    const t = row({ major: null, collegeLimits: [BIO_LIMIT] });
    expect(t).toContain("8 cr (no specific course)");
    expect(t).not.toContain(BIO_LIMIT);
    expect(t).toContain(BIO_NOTE);
  });

  it("an unpicked row has no result", () => {
    const html = renderToStaticMarkup(
      <ExamRow
        def={TABLES.exams[0]}
        picked={undefined}
        onToggle={() => {}}
        tables={TABLES}
        college="cals"
        newPicksBlocked={false}
        showFamily={false}
      />
    );
    expect(html).not.toContain("data-exam-result");
  });
});

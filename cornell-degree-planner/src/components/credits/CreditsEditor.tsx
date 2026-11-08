import { BookOpenCheck } from "lucide-react";
import { EXAM_TABLES } from "@/data/credit-tables";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { MAX_CREDIT_ENTRIES, type ExamTables } from "@/lib/credit/types";
import type { CreditEntry } from "@/lib/schemas";
import { collegeShortName } from "@/lib/planner/colleges";
import { ExamPicker } from "./ExamPicker";
import { TransferSection } from "./TransferSection";
import {
  addTransfer,
  atCap,
  removeTransfer,
  toggleScore,
  type CreditDraft,
} from "./creditDraft";

/**
 * CreditsEditor (spec 028 D4–D6, D2) — the one credits editor, shared by the
 * "My credits" dialog and first-run's credit step. Controlled: the host owns
 * the draft (draftFromProfile on open) and saves draftToEntries(draft)
 * through setCreditProfile with its own saving / error idiom.
 *
 * Exams: one row per exam with a button per score; one click picks.
 * Transfer: search the catalog for the Cornell equivalent, or no equivalent.
 * Entries the editor doesn't understand ride along untouched (draft.kept).
 */
export function CreditsEditor({
  draft,
  onChange,
  tables = EXAM_TABLES,
  listClassName = "max-h-[40vh]",
}: {
  draft: CreditDraft;
  onChange: (next: CreditDraft) => void;
  /** Injected by tests; the app uses the bundled tables. */
  tables?: ExamTables | null;
  listClassName?: string;
}) {
  const { college, major } = useCreditProfile();
  const capped = atCap(draft);

  const onToggle = (exam: string, score: string) => onChange(toggleScore(draft, exam, score));

  const examCount = Object.keys(draft.picks).length;
  const takenIds = [...draft.transfers, ...draft.kept].map((e) => e.id);

  return (
    <div className="flex min-h-0 flex-col gap-5" data-credits-editor>
      <div className="flex flex-col gap-1">
        <p className="t-body text-ink-2">
          Click the score you got on each exam you took
          {college ? (
            <>
              {" "}— we&apos;ll show what it earns in{" "}
              <span className="font-semibold text-ink">{collegeShortName(college)}</span>.
            </>
          ) : (
            " — we'll show what it earns at Cornell."
          )}
        </p>
        <p className="num t-meta text-ink-3" aria-live="polite">
          {summary(examCount, draft.transfers.length)}
          {capped && (
            <span className="ml-1.5 font-semibold text-available-text">
              · You&apos;ve reached {MAX_CREDIT_ENTRIES} credits — remove one to add another.
            </span>
          )}
        </p>
      </div>

      {tables ? (
        <ExamPicker
          tables={tables}
          picks={draft.picks}
          onToggle={onToggle}
          college={college}
          major={major}
          newPicksBlocked={capped}
          listClassName={listClassName}
        />
      ) : (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface-2/50 px-4 py-3"
        >
          <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <p className="t-body font-semibold text-ink-2">Exam list unavailable</p>
            <p className="t-meta text-ink-3">
              Cornell&apos;s exam credit tables aren&apos;t loaded right now. Exams you saved before
              are kept as they are, and you can still add transfer courses below.
            </p>
          </div>
        </div>
      )}

      <TransferSection
        transfers={draft.transfers}
        onAdd={(entry) => onChange(addTransfer(draft, entry))}
        onRemove={(id) => onChange(removeTransfer(draft, id))}
        blocked={capped}
        takenIds={takenIds}
      />

      {draft.kept.length > 0 && <KeptNote entries={draft.kept} />}
    </div>
  );
}

function summary(exams: number, transfers: number): string {
  if (exams === 0 && transfers === 0) return "Nothing added yet.";
  const parts: string[] = [];
  if (exams > 0) parts.push(`${exams} exam${exams === 1 ? "" : "s"}`);
  if (transfers > 0) parts.push(`${transfers} transfer course${transfers === 1 ? "" : "s"}`);
  return `Added: ${parts.join(" · ")}`;
}

/** Saved entries the editor can't show as rows: listed, kept as they are. */
function KeptNote({ entries }: { entries: CreditEntry[] }) {
  return (
    <div className="flex flex-col gap-1" data-credits-kept>
      <p className="t-label">Also saved</p>
      <p className="t-meta text-ink-3">
        {entries.map((e) => e.label).join(" · ")} — kept as saved.
      </p>
    </div>
  );
}

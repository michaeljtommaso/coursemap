import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { CreditEntry } from "@/lib/schemas";
import { courseCode, formatCredits } from "./examDisplay";
import { TransferForm } from "./TransferForm";

/**
 * Transfer courses (spec 028 D2, spec 045 D4): a course taken elsewhere,
 * entered as the Cornell course it was credited as, or with no Cornell
 * equivalent (a label and credits that count toward totals only). Fills the
 * editor's right pane: the courses added so far with Remove, then the add form.
 */
export function TransferSection({
  transfers,
  onAdd,
  onRemove,
  blocked,
  takenIds,
}: {
  transfers: CreditEntry[];
  onAdd: (entry: CreditEntry) => void;
  onRemove: (id: string) => void;
  /** At the 60-entry cap. */
  blocked: boolean;
  takenIds: string[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="credits-transfer-title" className="flex flex-col gap-4 px-6 py-4">
      <h3 id="credits-transfer-title" className="sr-only">
        Transfer courses
      </h3>
      <p className="t-body text-ink-2">
        Classes you took at another college. Add each one as the Cornell course it was credited as.
      </p>

      {transfers.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Your transfer courses">
          {transfers.map((t) => (
            <li
              key={t.id}
              data-transfer={t.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate t-body font-semibold text-ink">{t.label}</p>
                <p className="num t-meta text-ink-3">
                  {t.satisfiesCourseIds.length > 0
                    ? `Counts as ${t.satisfiesCourseIds.map(courseCode).join(" + ")}`
                    : "No Cornell equivalent · counts toward total credits"}
                  {t.credits != null && ` · ${formatCredits(t.credits)} cr`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(t.id)}
                aria-label={`Remove ${t.label}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 t-meta text-ink-3 transition-colors hover:bg-destructive-tint hover:text-destructive-text"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <TransferForm
          takenIds={takenIds}
          onCancel={() => setAdding(false)}
          onAdd={(entry) => {
            onAdd(entry);
            setAdding(false);
          }}
        />
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={blocked}
            className="inline-flex items-center gap-1.5 self-start rounded-md border border-dashed border-line-strong px-3 py-1.5 t-body font-semibold text-ink-2 transition-colors hover:border-drop hover:bg-drop-tint hover:text-drop-text disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong disabled:hover:bg-transparent disabled:hover:text-ink-2"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add a transfer course
          </button>
        </div>
      )}
    </section>
  );
}

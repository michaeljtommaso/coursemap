import { cn } from "@/lib/utils";
import { CARD_W } from "@/lib/graph/buildRoadmapGrid";

type SemHeaderData = { label: string; semNum: number; season: "fall" | "spring" };

export function SemHeaderNode({ data }: { data: SemHeaderData }) {
  const { label, semNum, season } = data;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border-2 shadow-sm",
        season === "spring"
          ? "border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/60"
          : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/60"
      )}
      style={{ width: CARD_W, height: 48 }}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Sem {semNum}
      </span>
      <span className="text-xs font-semibold text-foreground">{label}</span>
    </div>
  );
}

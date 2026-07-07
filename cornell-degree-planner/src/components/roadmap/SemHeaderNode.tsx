import { CARD_W } from "@/lib/graph/buildRoadmapGrid";

type SemHeaderData = { label: string; semNum: number; season: "fall" | "spring" };

export function SemHeaderNode({ data }: { data: SemHeaderData }) {
  const { label, semNum } = data;

  // Neutralized per spec 003 §5.1 + the Chart Signal / Flat-by-Default rules:
  // no season color fill, no shadow. Season/year reads as text; the semester
  // number carries the numeric signature. A single ink-4 dot is the only mark.
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-surface/60"
      style={{ width: CARD_W, height: 48 }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-4" aria-hidden="true" />
        <span className="t-label">{label}</span>
      </div>
      <span className="t-meta text-ink-2">
        Sem <span className="num">{semNum}</span>
      </span>
    </div>
  );
}

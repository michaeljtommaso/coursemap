import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const items = [
  { label: "Completed", style: "bg-emerald-400" },
  { label: "Planned", style: "bg-blue-400" },
  { label: "Available", style: "bg-amber-400" },
  { label: "Locked", style: "bg-slate-300" },
  { label: "Waived", style: "bg-violet-400" },
];

export function RoadmapLegend() {
  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Legend</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <div className={`h-3 w-3 rounded-full ${item.style}`} />
            <span>{item.label}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

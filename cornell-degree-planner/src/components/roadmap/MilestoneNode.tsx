import { Handle, Position } from "@xyflow/react";

export function MilestoneNode({ data }: { data: any }) {
  return (
    <div className="w-[190px] rounded-2xl border-2 border-dashed border-border bg-card p-4 text-center shadow-sm">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Milestone</p>
      <h3 className="mt-1 text-sm font-semibold text-foreground">{data.title}</h3>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

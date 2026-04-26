import { Handle, Position } from "@xyflow/react";

export function BucketNode({ data }: { data: any }) {
  return (
    <div className="flex h-36 w-36 items-center justify-center rounded-full border-2 border-border bg-card p-4 text-center shadow-sm">
      <Handle type="target" position={Position.Left} />
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Bucket</p>
        <h3 className="mt-1 text-sm font-semibold text-foreground">{data.title}</h3>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

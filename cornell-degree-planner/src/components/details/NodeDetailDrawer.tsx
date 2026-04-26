import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProgramMap } from "@/hooks/useProgramMap";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { getNodeById } from "@/store/selectors";

export function NodeDetailDrawer() {
  const program = useProgramMap();
  const selectedNodeId = useProgramStore((state) => state.selectedNodeId);
  const node = getNodeById(program?.nodes ?? [], selectedNodeId);
  const toggleCompleted = usePlannerStore((state) => state.toggleCompleted);
  const toggleWaived = usePlannerStore((state) => state.toggleWaived);

  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Node details</CardTitle>
      </CardHeader>
      <CardContent>
        {!node ? (
          <p className="text-sm text-slate-500">Select a node in the roadmap to inspect it.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">{node.code ?? node.type}</p>
              <h3 className="text-lg font-semibold text-slate-900">{node.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{node.description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {node.categories.map((category) => (
                <Badge key={category} variant="secondary">{category}</Badge>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
              <div>
                <p className="font-medium text-slate-900">Credits</p>
                <p>{node.credits ?? "—"}</p>
              </div>
              <div>
                <p className="font-medium text-slate-900">Offered</p>
                <p>{node.offered ?? "Varies"}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => toggleCompleted(node.id)}>Toggle completed</Button>
              <Button variant="secondary" onClick={() => toggleWaived(node.id)}>
                Toggle waived
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

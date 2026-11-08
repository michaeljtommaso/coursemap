import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import { retryCatalogLoad } from "./catalogRetry";

/** Shown in the top bar when the program list failed to load. Retry reloads
 *  the page (see retryCatalogLoad). */
export function CatalogRetryButton() {
  return (
    <Tooltip content="We couldn't reach the catalog — your plan is safe. Retrying reloads the page." placement="bottom">
    <Button
      variant="outline"
      size="sm"
      onClick={() => retryCatalogLoad()}
      className="gap-1.5 border-destructive/40 bg-destructive-tint text-destructive-text hover:bg-destructive/10"
    >
      <RotateCw className="h-3 w-3" />
      Couldn&rsquo;t load — Retry
    </Button>
    </Tooltip>
  );
}

import { useMemo } from "react";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { makeLeafDescriber, type LeafDescriber } from "@/lib/planner/leafWording";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * useLeafDescriber — leafWording's describer over the catalog index the client
 * already holds, so a pattern leaf reads as its concrete alternatives ("CS 1110
 * or CS 1112") wherever unmet leaves are shown. One describer per loaded index
 * (shared by every card), never a fetch.
 */
const byIndex = new WeakMap<CatalogIndexRecord[], LeafDescriber>();

export function useLeafDescriber(): LeafDescriber {
  const { index } = useCatalogContext();
  return useMemo(() => {
    let describe = byIndex.get(index);
    if (!describe) {
      describe = makeLeafDescriber(index.map((r) => `${r.subject} ${r.number}`));
      byIndex.set(index, describe);
    }
    return describe;
  }, [index]);
}

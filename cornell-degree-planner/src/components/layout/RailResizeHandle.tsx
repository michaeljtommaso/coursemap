import { ResizeHandle } from "@/components/ui/ResizeHandle";
import {
  LEFT_RAIL_DEFAULT,
  LEFT_RAIL_MAX,
  LEFT_RAIL_MIN,
  usePlannerStore,
} from "@/store/usePlannerStore";

/**
 * RailResizeHandle — the left rail's right edge, draggable to widen the rail
 * (the Still-needed checklist wraps long CAS/CALS requirement names onto many
 * lines at the old fixed 224 px). The width persists in usePlannerStore with
 * the other view preferences.
 */
export function RailResizeHandle() {
  const width = usePlannerStore((s) => s.leftRailWidth);
  const setWidth = usePlannerStore((s) => s.setLeftRailWidth);
  return (
    <ResizeHandle
      edge="right"
      width={width}
      min={LEFT_RAIL_MIN}
      max={LEFT_RAIL_MAX}
      onChange={setWidth}
      onReset={() => setWidth(LEFT_RAIL_DEFAULT)}
      label="Resize the sidebar"
      data-rail-resize
    />
  );
}

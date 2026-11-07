import { LibraryBig, ListChecks, Map as MapIcon } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/** The rail's navigation (spec 006 §E1; spec 028 D8 adds Requirements under
 *  Classes). */
const ITEMS = [
  { to: "/", label: "Planner", Icon: MapIcon, end: true },
  { to: "/classes", label: "Classes", Icon: LibraryBig, end: false },
  { to: "/requirements", label: "Requirements", Icon: ListChecks, end: false },
] as const;

export function RailNav() {
  return (
    <nav data-tour="nav" className="flex flex-col gap-0.5">
      {ITEMS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 t-body font-medium transition-colors",
              isActive ? "bg-surface-2 text-ink" : "text-ink-3 hover:bg-surface-2/60 hover:text-ink"
            )
          }
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

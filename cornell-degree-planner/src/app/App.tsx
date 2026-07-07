import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { AppShell } from "@/components/layout/AppShell";
import { SmallScreenNotice } from "@/components/layout/SmallScreenNotice";
import { AuthProvider } from "@/contexts/AuthProvider";
import { CatalogProvider } from "@/contexts/CatalogProvider";
import { ProgramProvider } from "@/contexts/ProgramProvider";
import { PlanProvider } from "@/contexts/PlanProvider";

export default function App() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Provider stack (docs/specs/002 §5/§6/§7). AuthProvider mounts ABOVE the data
  // providers (there's always a uid before plans load). PlanProvider sits below
  // Program/Catalog because it reads the program list (for auto-create naming)
  // and program slot IDs (sanitize-on-load), and below Auth because it needs the
  // uid + active plan id.
  return (
    <AuthProvider>
      <CatalogProvider>
        <ProgramProvider>
          <PlanProvider>
            <AppShell />
            <SmallScreenNotice />
          </PlanProvider>
        </ProgramProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}

import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { AppShell } from "@/components/layout/AppShell";
import { SmallScreenNotice } from "@/components/layout/SmallScreenNotice";
import { ShareView } from "@/components/share/ShareView";
import { AuthProvider } from "@/contexts/AuthProvider";
import { CatalogProvider } from "@/contexts/CatalogProvider";
import { ProgramProvider } from "@/contexts/ProgramProvider";
import { PlanProvider } from "@/contexts/PlanProvider";

export default function App() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // /s/{shareId} — the read-only share surface (spec 005 §5). A single static
  // route doesn't justify a router dependency: shares are public reads with no
  // auth/plan context, so they render OUTSIDE the provider stack entirely.
  const shareMatch = window.location.pathname.match(/^\/s\/([A-Za-z0-9-]{8,64})\/?$/);
  if (shareMatch) {
    return <ShareView shareId={shareMatch[1]} />;
  }

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

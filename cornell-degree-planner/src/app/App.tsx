import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { AppShell } from "@/components/layout/AppShell";
import { CatalogProvider } from "@/contexts/CatalogProvider";
import { ProgramProvider } from "@/contexts/ProgramProvider";

export default function App() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Session-owned data providers mount once above the shell (docs/specs/002 §5).
  // CatalogProvider: fetch-once catalog index + in-memory search.
  // ProgramProvider: program list + cache-by-id program data.
  return (
    <CatalogProvider>
      <ProgramProvider>
        <AppShell />
      </ProgramProvider>
    </CatalogProvider>
  );
}

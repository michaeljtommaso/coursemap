import { useEffect } from "react";
import { useProgramStore } from "@/store/useProgramStore";
import { useThemeStore } from "@/store/useThemeStore";
import { AppShell } from "@/components/layout/AppShell";
import { ProgramSelector } from "@/components/selector/ProgramSelector";

export default function App() {
  const selectedProgramId = useProgramStore((state) => state.selectedProgramId);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return selectedProgramId ? <AppShell /> : <ProgramSelector />;
}

import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";
import { AppShell } from "@/components/layout/AppShell";

export default function App() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return <AppShell />;
}

import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from "react-router-dom";
import { useThemeStore } from "@/store/useThemeStore";
import { AppShell } from "@/components/layout/AppShell";
import { ClassesPage } from "@/components/classes/ClassesPage";
import { SmallScreenNotice } from "@/components/layout/SmallScreenNotice";
import { ShareView } from "@/components/share/ShareView";
import { AuthProvider } from "@/contexts/AuthProvider";
import { CatalogProvider } from "@/contexts/CatalogProvider";
import { ProgramProvider } from "@/contexts/ProgramProvider";
import { PlanProvider } from "@/contexts/PlanProvider";
import { ReviewsProviderContext } from "@/contexts/ReviewsProvider";
import { useDocumentTitle, pageTitle } from "@/hooks/useDocumentTitle";

/**
 * App (spec 006 §E1) — react-router replaces the hand-rolled /s/ regex.
 *
 * Routes:
 *   /s/:shareId  — the read-only public share surface. Rendered OUTSIDE the
 *                  provider stack (public reads, no auth/plan/catalog context),
 *                  exactly as before router adoption.
 *   /            — the planner shell.
 *   /classes     — the course directory (spec 006 §E2).
 *   *            — unknown paths redirect to /.
 *
 * `/` and `/classes` share the same provider stack via a layout route, so
 * switching between the planner and the directory never re-mounts auth / plan /
 * catalog subscriptions.
 *
 * Each route sets its own document title (useDocumentTitle) in the thin route
 * components below, so the tab reads "Coursemap — My roadmap" / "— Classes" /
 * "— Shared plan" instead of index.html's static title everywhere.
 */

function PlannerRoute() {
  useDocumentTitle(pageTitle("My roadmap"));
  return <AppShell />;
}

function ClassesRoute() {
  useDocumentTitle(pageTitle("Classes"));
  return <ClassesPage />;
}

function ShareRoute() {
  const { shareId } = useParams<{ shareId: string }>();
  useDocumentTitle(pageTitle("Shared plan"));
  // Preserve the old id shape guard (8–64 url-safe chars) — a malformed id
  // falls through to the planner rather than a doomed share fetch.
  if (!shareId || !/^[A-Za-z0-9-]{8,64}$/.test(shareId)) {
    return <Navigate to="/" replace />;
  }
  return <ShareView shareId={shareId} />;
}

/** Provider stack + shared chrome for the authenticated app surfaces. */
function PlannerLayout() {
  return (
    <AuthProvider>
      <CatalogProvider>
        <ReviewsProviderContext>
          <ProgramProvider>
            <PlanProvider>
              <Outlet />
              <SmallScreenNotice />
            </PlanProvider>
          </ProgramProvider>
        </ReviewsProviderContext>
      </CatalogProvider>
    </AuthProvider>
  );
}

export default function App() {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:shareId" element={<ShareRoute />} />
        <Route element={<PlannerLayout />}>
          <Route path="/" element={<PlannerRoute />} />
          <Route path="/classes" element={<ClassesRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

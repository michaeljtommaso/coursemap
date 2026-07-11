import React from "react";
import ReactDOM from "react-dom/client";
import { captureLocalPlanSnapshot } from "@/lib/importLocalPlan";
import App from "@/app/App";

// Capture the pre-Firebase localStorage plan payload BEFORE any Zustand store
// rehydrates and strips it (spec 002 §7 import — see importLocalPlan.ts). Must be
// the first thing that runs.
captureLocalPlanSnapshot();

// Self-hosted fonts via Vite — no Google Fonts request, no third-party FOUT.
// Manrope: all UI text. IBM Plex Mono: numeric signature (see .num in tokens.css).
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

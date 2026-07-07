import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/app/App";
// Self-hosted fonts via Vite — no Google Fonts request, no third-party FOUT.
// DM Sans: all UI text. DM Mono: numeric signature (see .num in tokens.css).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import path from "path";
// vitest/config re-exports vite's defineConfig with the `test` key typed.
import { configDefaults, defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** One id per build: baked into the bundle as __BUILD_ID__ and written to
 *  dist/version.json, so an open tab can tell when a newer build is live
 *  (src/lib/version/buildVersion.ts). */
const BUILD_ID = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;

function versionFile(): Plugin {
  return {
    name: "coursemap-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ build: BUILD_ID }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // e2e/ is the Playwright suite (npm run test:e2e) — vitest must not
    // collect its *.spec.ts files.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});

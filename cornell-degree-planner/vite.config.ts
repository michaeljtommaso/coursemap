import path from "path";
// vitest/config re-exports vite's defineConfig with the `test` key typed.
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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

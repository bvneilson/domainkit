import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
  },
  // Route handlers pull in `server-only`, which resolves to a module that throws
  // unless the `react-server` export condition is set. Vitest runs test files
  // through its SSR pipeline, so the condition has to be set there — without it
  // any test importing a route fails at import time rather than running.
  ssr: {
    resolve: {
      conditions: ["react-server", "node", "import"],
      externalConditions: ["react-server", "node", "import"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});

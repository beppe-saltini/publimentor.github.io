import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"],
    exclude: ["node_modules", ".next", "dist"],
    // Use jsdom for React component tests (.tsx)
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
      ["src/**/*.spec.tsx", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**/*.ts", "src/domain/**/*.ts", "src/components/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx", "src/types/**"],
    },
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

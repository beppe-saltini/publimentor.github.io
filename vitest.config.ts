import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const root = __dirname;
const srcAlias = { "@": path.resolve(root, "./src") };
const sharedResolve = {
  alias: {
    ...srcAlias,
    ioredis: path.resolve(root, "./src/test/mocks/ioredis.ts"),
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: sharedResolve,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          exclude: ["node_modules", ".next", "dist"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: sharedResolve,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "src/**/*.spec.tsx"],
          exclude: ["node_modules", ".next", "dist"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**/*.ts", "src/domain/**/*.ts", "src/components/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx", "src/types/**"],
    },
  },
});

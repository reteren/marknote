import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

export default defineConfig({
  // Svelte's package exports otherwise resolve to index-server in Vitest.
  // Keep cleanup local to tests/ui so node-only unit tests remain untouched.
  plugins: [svelte(), svelteTesting({ autoCleanup: false })],
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/ui/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.ts"],
        },
      },
    ],
  },
});

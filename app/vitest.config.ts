import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The DB integration tests share one local Postgres; run files one at a
    // time so their TRUNCATE setup does not clobber each other.
    fileParallelism: false,
  },
});

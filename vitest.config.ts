import { defineConfig } from "vitest/config";

/**
 * The tests. The render function is tested as the pure function it is, and the
 * server module as the bundle that ships.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Packing the tarball and building a NestJS module both take a moment on
    // a cold runner.
    testTimeout: 30_000,
  },
});

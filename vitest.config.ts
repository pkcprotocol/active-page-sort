import { defineConfig } from "vitest/config";

// Two projects so `npm test` stays a pure unit run (no network, no daemon) while `npm run test:e2e` starts
// a throwaway kubo daemon and a real pkc-js community. CI runs both; the e2e has a long budget because it
// waits on real IPNS publish cycles.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/unit/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "e2e",
          environment: "node",
          include: ["test/e2e/**/*.test.ts"],
          testTimeout: 180_000,
          hookTimeout: 180_000,
          fileParallelism: false,
          allowOnly: false
        }
      }
    ]
  }
});

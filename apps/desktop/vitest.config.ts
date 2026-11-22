// The desktop test run. Two groups, one after the other:
// - "unit": everything else, in parallel (one worker per core);
// - "processes": the few files that start many real processes (git, pwsh, node builds). On Windows, starting a
//   process under the full parallel run took 1–3 s instead of ~20 ms (updaterChannel starts ~230 git processes),
//   so these crossed even their own 30–60 s budgets and left children holding their temp folders. They run after
//   the parallel group, a few at a time, where they take about as long as alone.
import { configDefaults, defineConfig } from "vitest/config";

const PROCESSES = [
  "test/updaterChannel.test.ts",
  "test/ownerProvenance.test.ts",
  "test/moduleAuthorEndToEnd.test.ts",
  "test/migrateStatusPrefs.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", exclude: [...configDefaults.exclude, ...PROCESSES] } },
      { extends: true, test: { name: "processes", include: PROCESSES, sequence: { groupOrder: 1 }, maxWorkers: 4 } },
    ],
  },
});

// Test options for static source scans: tests that read (or parse) every renderer source file and check what the
// code says, never how fast it runs. Their duration is the machine's load — under the full parallel run on Windows a
// whole-tree read took over the default 5 s, and over a 30 s budget too — so a wall-clock limit only measured the
// load and failed at random (TODO 2026-11-16). They are synchronous and bounded by the source tree, so they cannot
// hang; no time limit applies (vitest: 0 = none). Use only for such scans; anything with timers, processes or I/O
// it waits on keeps a budget.
export const STATIC_SCAN = { timeout: 0 } as const;

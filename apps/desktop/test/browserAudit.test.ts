import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browserAuditRecord, createBrowserAudit, type BrowserAuditEvent } from "../src/main/browser/audit";

it("writes only bounded metadata even with hostile extra fields and values", () => {
  const record = browserAuditRecord({ event: "rejected", requestId: "r", code: "busy", cause: "ledger_capacity", inflight: 16, ledgerSize: 256,
    url: "https://user:SECRET@example.com", title: "SECRET", page: "SECRET", token: "SECRET" } as BrowserAuditEvent);
  expect(record).toMatchObject({ requestId: "r", cause: "ledger_capacity", inflight: 16 });
  expect(JSON.stringify(record)).not.toContain("SECRET");
  expect(browserAuditRecord({ event: "state", requestId: "https://user:SECRET@example.com", code: "SECRET", abortCause: "SECRET", cause: "SECRET", stage: "SECRET" } as any))
    .toEqual({ time: expect.any(String), event: "state" });
});

it("rotates bounded audit files and records queue drops", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-audit-")), path = join(root, "audit.jsonl");
  try {
    const sink = createBrowserAudit(path, 400);
    for (let i = 0; i < 300; i++) sink.write({ event: "stage", requestId: "r", stage: "activate_http", elapsedMs: i });
    await sink.flush();
    expect((await stat(path)).size).toBeLessThanOrEqual(400);
    expect((await stat(path + ".1")).size).toBeLessThanOrEqual(400);
    const line = JSON.parse((await readFile(path, "utf8")).trim().split("\n").at(-1)!);
    expect(line.stage).toBe("activate_http");
    expect(line.elapsedMs).toBe(255);
    const drops = createBrowserAudit(join(root, "drops.jsonl"));
    for (let i = 0; i < 300; i++) drops.write({ event: "state", requestId: "r" });
    await drops.flush();
    const records = (await readFile(join(root, "drops.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(records).toHaveLength(256);
    expect(records[0].dropped).toBe(44);
  } finally { await rm(root, { recursive: true, force: true }); }
});

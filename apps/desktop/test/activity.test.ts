import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { commandHead, nextPreview, shortToolLine, type ActivityPreview } from "../src/renderer/src/lib/activity";

function ev(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "2026-10-06T00:00:00Z",
    cutexSessionId: "a", hostId: "h", source: "app_server", sensitivity: "owner", correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

describe("activity preview", () => {
  it("shows the concrete tool action, then the start of the next output", () => {
    let p: ActivityPreview | undefined = nextPreview(undefined, ev("item/started", { item: { type: "commandExecution", id: "1", command: "pnpm test" } }));
    expect(p).toMatchObject({ kind: "tool", text: "$ pnpm test" });
    for (const delta of ["All ", "tests\n", "passed."]) p = nextPreview(p, ev("item/agentMessage/delta", { itemId: "m1", delta })) ?? p;
    expect(p).toMatchObject({ kind: "output", text: "All tests passed." });
  });

  it("ignores events that do not change the preview", () => {
    expect(nextPreview(undefined, ev("thread/tokenUsage/updated", {}))).toBeUndefined();
    expect(nextPreview(undefined, ev("thread/prediction/updated", { threadId: "t", requestId: "p" }))).toBeUndefined();
    expect(nextPreview(undefined, ev("item/started", { item: { type: "agentMessage", id: "x" } }))).toBeUndefined();
  });
});

describe("commandHead (design 060 §6: a running row shows only the command's first word)", () => {
  it("plain commands: the first word, without directory or .exe", () => {
    expect(commandHead("cargo build --release")).toBe("cargo");
    expect(commandHead("export PATH=/x:$PATH")).toBe("export");
    expect(commandHead(String.raw`"C:\Program Files\Git\bin\git.exe" status`)).toBe("git");
    expect(commandHead("/usr/bin/rg -n foo")).toBe("rg");
    expect(commandHead("RUST_LOG=debug CARGO_HOME=/c cargo test")).toBe("cargo");
    expect(commandHead("   ")).toBeNull();
  });
  it("through shell wrappers", () => {
    expect(commandHead('bash -lc "cargo build --release"')).toBe("cargo");
    expect(commandHead("/bin/zsh -c 'pnpm exec vitest run'")).toBe("pnpm");
    expect(commandHead(String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "& 'D:\x\node.exe' build.mjs"`)).toBe("node");
    expect(commandHead("pwsh -Command Get-ChildItem")).toBe("Get-ChildItem");
    expect(commandHead("cmd /c npm test")).toBe("npm");
    expect(commandHead("bash")).toBe("bash");
  });
  it("shortToolLine: only commands are shortened", () => {
    expect(shortToolLine('$ bash -lc "cargo build"')).toBe("$ cargo");
    expect(shortToolLine("✎ a.ts, b.ts")).toBe("✎ a.ts, b.ts");
    expect(shortToolLine("$ ")).toBe("$ ");
  });
});

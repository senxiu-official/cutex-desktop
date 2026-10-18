// cutex approval-decided-by (r243 acceptance 7: a denial nobody remembered making): the desktop says
// where and how the owner decided; the client sends those facts only with a valid origin.
import { describe, expect, it, vi } from "vitest";
import { approvalClientFacts } from "../src/shared/approvalOrigin";
import { approvalDecisionTrace, decisionInput } from "../src/renderer/src/lib/approvals";
import { CutexClient } from "@cutex-desktop/cutex-client";

describe("approval decision origin", () => {
  it("tells keyboard activation from pointer and touch clicks", () => {
    expect(decisionInput({ detail: 0 })).toBe("keyboard");
    expect(decisionInput({ detail: 0, nativeEvent: { pointerType: "" } })).toBe("keyboard");
    expect(decisionInput({ detail: 1, nativeEvent: { pointerType: "mouse" } })).toBe("pointer");
    expect(decisionInput({ detail: 1, nativeEvent: { pointerType: "touch" } })).toBe("touch");
    expect(decisionInput({ detail: 2 })).toBe("pointer");
    expect(decisionInput({ detail: -1 })).toBe("unknown");
  });

  it("builds client facts only for a valid origin", () => {
    expect(approvalClientFacts({ surface: "inline", input: "keyboard" }, "0.1.3", "laptop-01")).toEqual({ app: "cutex-desktop", version: "0.1.3", device: "laptop-01", surface: "inline", input: "keyboard" });
    expect(approvalClientFacts(undefined, "1", "d")).toBeUndefined();
    expect(approvalClientFacts({ surface: "toast", input: "keyboard" }, "1", "d")).toBeUndefined();
    expect(approvalClientFacts({ surface: "page", input: 1 }, "1", "d")).toBeUndefined();
  });

  it("traces a decision without its note", () => {
    const line = JSON.parse(approvalDecisionTrace({ approvalId: "apr-1", kind: "service_lifetime", requesterCutexSessionId: "cutex.a" }, "deny", { surface: "inline", input: "pointer" }, "local"));
    expect(line).toEqual({ source: "approval-decision", approvalId: "apr-1", kind: "service_lifetime", requester: "cutex.a", hostId: "local", decision: "deny", surface: "inline", input: "pointer" });
  });

  it("sends client only when given, one line and bounded", async () => {
    const client = new CutexClient({ baseUrl: "http://127.0.0.1:1", token: "t" } as never);
    const request = vi.spyOn(client, "request").mockResolvedValue({ approval: { approvalId: "apr-1" } } as never);
    await client.decideApproval("apr-1", "deny");
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/approvals/apr-1/deny", { body: {} });
    await client.decideApproval("apr-1", "deny", " no ", { app: "cutex-desktop", device: "eva\n02", surface: "x".repeat(100), other: "dropped" });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/approvals/apr-1/deny", { body: { note: "no", client: { app: "cutex-desktop", device: "eva 02", surface: "x".repeat(80) } } });
  });
});

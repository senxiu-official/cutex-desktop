import { describe, expect, it } from "vitest";
import { delegationRowLabel } from "./delegationRowLabel";
import { taskToolRow } from "./taskRows";
import type { RawItem } from "./timeline";

const ref = (over: Partial<{ id: string; title: string | null; target: string | null }> = {}) => ({ id: "delegation-536a74", title: null, target: null, label: true, ...over });
const call = (tool: string, args: Record<string, unknown>, result?: Record<string, unknown>): RawItem =>
  ({ type: "mcpToolCall", id: `i-${tool}-${Math.random()}`, server: "cutex", tool, status: "completed", arguments: args, ...(result ? { result: { structuredContent: result } } : {}) }) as RawItem;

describe("delegation tool rows name the delegation (owner 2026-11-18)", () => {
  it("store record wins: title → handler, id only in the tooltip", () => {
    const out = delegationRowLabel(ref(), { title: "profile-a 额度调查", targetName: "profile-a-quota-audit" }, null);
    expect(out.text).toBe("profile-a 额度调查 → profile-a-quota-audit");
    expect(out.title).toBe("profile-a 额度调查 → profile-a-quota-audit\ndelegation-536a74");
  });

  it("falls back to what the transcript said, a session name, then the id", () => {
    expect(delegationRowLabel(ref({ title: "Parser review", target: "Kimi" }), null, null).text).toBe("Parser review → Kimi");
    expect(delegationRowLabel(ref({ title: "Parser review", target: "cutex.…3f9a1c" }), null, "Kai").text).toBe("Parser review → Kai");
    expect(delegationRowLabel(ref({ title: "Parser review", target: "cutex.…3f9a1c" }), null, null).text).toBe("Parser review");
    expect(delegationRowLabel(ref(), null, null)).toEqual({ text: "delegation-536a74", title: "delegation-536a74" });
  });

  it("covers every delegation tool, with the note as the row text", () => {
    expect(taskToolRow(call("delegation_close", { delegation: "delegation-1a2b3c", outcome: "changes_requested", note: "add tests" }))).toMatchObject({ verb: "delegationChanges", text: "add tests", delegation: { id: "delegation-1a2b3c", label: true } });
    expect(taskToolRow(call("delegation_reopen", { delegation: "delegation-1a2b3c", note: "again" }))).toMatchObject({ verb: "delegationReopen", text: "again", delegation: { id: "delegation-1a2b3c" } });
    expect(taskToolRow(call("delegation_resume", { delegation: "delegation-1a2b3c" }))).toMatchObject({ verb: "delegationResume", delegation: { id: "delegation-1a2b3c" } });
    expect(taskToolRow(call("delegation_await", { delegation: "delegation-1a2b3c", note: "jobs run" }))).toMatchObject({ verb: "delegationAwait", text: "jobs run" });
    expect(taskToolRow(call("agent_tell", { delegation: "delegation-1a2b3c", text: "revision" }))).toMatchObject({ verb: "tell", delegation: { id: "delegation-1a2b3c", label: true } });
    expect(taskToolRow(call("agent_tell", { to: "Kai", text: "note" }))?.delegation).toBeNull();
  });

  it("a result's own title/target is used; agent_delegate links without repeating its title", () => {
    expect(taskToolRow(call("delegation_close", { delegation: "delegation-9f9f9f", outcome: "abandoned" }, { ok: true, title: "Audit", target_name: "auditor" }))?.delegation).toMatchObject({ title: "Audit", target: "auditor" });
    const delegate = taskToolRow(call("agent_delegate", { target: "Kimi", title: "Port" }, { ok: true, delegation: "delegation-777777", target: "Kimi" }));
    expect(delegate?.delegation).toMatchObject({ id: "delegation-777777", label: false });
  });
});

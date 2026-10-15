// New agent → 「添加 Profile…」 / 「管理 Profile」 (review UI-04): the draft kept for the way back.
import { describe, expect, it } from "vitest";
import { draftFits, dropNewAgentDraft, keepNewAgentDraft, keptNewAgentDraft, noteNewAgentProfile } from "../src/renderer/src/lib/newAgentReturn";

describe("lib/newAgentReturn", () => {
  it("keeps one draft, notes a profile created on its host only, drops it", () => {
    keepNewAgentDraft({ hostId: "host-a", params: {}, form: { name: "x" } });
    noteNewAgentProfile("host-b", "p-other");
    expect(keptNewAgentDraft()?.createdProfile).toBeUndefined();
    noteNewAgentProfile("host-a", "p-new");
    expect(keptNewAgentDraft()).toMatchObject({ hostId: "host-a", form: { name: "x" }, createdProfile: "p-new" });
    dropNewAgentDraft();
    expect(keptNewAgentDraft()).toBeNull();
  });

  it("a draft fits a plain new-agent page, or one preset to its own project / host", () => {
    const kept = { hostId: "host-a", params: { project: "proj-1", host: "host-a" }, form: null };
    expect(draftFits(kept, {})).toBe(true);
    expect(draftFits(kept, { project: "proj-1", host: "host-a" })).toBe(true);
    expect(draftFits(kept, { project: "proj-2" })).toBe(false);
    expect(draftFits(kept, { host: "host-b" })).toBe(false);
  });
});

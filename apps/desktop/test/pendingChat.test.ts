import { describe, expect, it } from "vitest";
import { draftOffersGoal, draftSlashCommands, draftSubmit, emptyPendingChat, hasDraftContent, pendingChatSteps, pendingSettingLocked, type PendingDraft } from "../src/renderer/src/lib/pendingChat";

const draft = (text: string, over: Partial<PendingDraft> = {}): PendingDraft => ({ text, images: [], skills: [], ...over });

describe("pending chat drafts", () => {
  it("builds the submit payload like the composer: images, then skills still named in the text", () => {
    const d = draft("use $review please", {
      images: [
        { id: "1", name: "a.png", preview: null, source: { kind: "data", url: "data:image/png;base64,AA==" } },
        { id: "2", name: "b.png", preview: null, source: { kind: "path", path: "C:/b.png" } },
      ],
      skills: [
        { name: "review", path: "/s/review" },
        { name: "gone", path: "/s/gone" },
      ],
    });
    expect(draftSubmit(d)).toEqual({
      text: "use $review please",
      extra: [
        { type: "image", url: "data:image/png;base64,AA==" },
        { type: "localImage", path: "C:/b.png" },
        { type: "skill", name: "review", path: "/s/review" },
      ],
    });
  });

  it("image-only drafts count as content", () => {
    expect(hasDraftContent({ text: "  ", images: [] })).toBe(false);
    expect(hasDraftContent({ text: "", images: [{ id: "1", name: "x", preview: null, source: { kind: "path", path: "x" } }] })).toBe(true);
  });
});

describe("pendingChatSteps", () => {
  it("does nothing before the first message", () => {
    expect(pendingChatSteps({ ...emptyPendingChat(null), plan: true, goal: "ship it" })).toEqual([]);
  });

  it("orders create → plan → goal → drafts", () => {
    const steps = pendingChatSteps({ ...emptyPendingChat(null), plan: true, goal: "  ship it ", drafts: [draft("one"), draft("two")] });
    expect(steps.map((s) => s.kind)).toEqual(["create", "plan", "goal", "submit", "submit"]);
    expect(steps[2]).toEqual({ kind: "goal", objective: "ship it" });
    expect(steps.slice(3).map((s) => (s.kind === "submit" ? s.text : ""))).toEqual(["one", "two"]);
  });

  it("skips unset plan / blank goal", () => {
    expect(pendingChatSteps({ ...emptyPendingChat(null), goal: "  ", drafts: [draft("hi")] }).map((s) => s.kind)).toEqual(["create", "submit"]);
  });

  it("a retry continues with the created session and skips applied steps", () => {
    const p = { ...emptyPendingChat("p"), plan: true, goal: "g", drafts: [draft("hi")], sessionId: "s1", applied: { plan: true, goal: false } };
    expect(pendingChatSteps(p).map((s) => s.kind)).toEqual(["goal", "submit"]);
    expect(pendingChatSteps({ ...p, applied: { plan: true, goal: true }, drafts: [] })).toEqual([]);
  });

  it("plan / goal lock while creating or once applied", () => {
    const p = emptyPendingChat(null);
    expect(pendingSettingLocked(p, "plan", false)).toBe(false);
    expect(pendingSettingLocked(p, "plan", true)).toBe(true);
    expect(pendingSettingLocked({ applied: { plan: false, goal: true } }, "goal", false)).toBe(true);
  });
});

describe("draftOffersGoal", () => {
  it("hides the goal entry for a resolved Claude profile (cliKind or authKind)", () => {
    expect(draftOffersGoal({ cliKind: "claude", authKind: "claude", providerFamily: null })).toBe(false);
    expect(draftOffersGoal({ cliKind: "", authKind: "claude", providerFamily: null })).toBe(false);
  });

  it("offers the goal for ChatGPT / API-key profiles and while the profile is unknown", () => {
    expect(draftOffersGoal({ cliKind: "codex", authKind: "chatgpt", providerFamily: "openai-chatgpt" })).toBe(true);
    expect(draftOffersGoal({ cliKind: "", authKind: "none", providerFamily: "deepseek" })).toBe(true);
    expect(draftOffersGoal(null)).toBe(true);
    expect(draftOffersGoal(undefined)).toBe(true);
  });
});

describe("draftSlashCommands", () => {
  it("keeps /goal in the palette only when the goal entries are offered", () => {
    expect(draftSlashCommands(true)).toEqual(["plan", "goal"]);
    expect(draftSlashCommands(false)).toEqual(["plan"]);
  });
});

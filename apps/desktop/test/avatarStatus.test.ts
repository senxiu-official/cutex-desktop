// Design 040 §3.1: what an agent's avatar shows about it (lib/avatarStatus) — the corner badge per signal, presence,
// and the badge geometry by avatar size.
import { describe, expect, it } from "vitest";
import { avatarBadge, avatarPresence, badgeBox } from "../src/renderer/src/lib/avatarStatus";

describe("avatarBadge", () => {
  it("needs-you: the count when more than one, else ? for a question and ! for anything else", () => {
    expect(avatarBadge("needsYou", { count: 2, reasons: ["question", "approval"] })).toEqual({ tone: "attention", text: "2" });
    expect(avatarBadge("needsYou", { count: 1, reasons: ["question"] })).toEqual({ tone: "attention", text: "?" });
    expect(avatarBadge("needsYou", { count: 1, reasons: ["ownerReply"] })).toEqual({ tone: "attention", text: "?" });
    for (const r of ["approval", "confirm", "review", "check", "acceptance", "safetyBlock", "ownerMessage"] as const) expect(avatarBadge("needsYou", { count: 1, reasons: [r] })?.text, r).toBe("!");
    expect(avatarBadge("needsYou", 1)).toEqual({ tone: "attention", text: "!" });
    expect(avatarBadge("needsYou", 4)).toEqual({ tone: "attention", text: "4" });
    expect(avatarBadge("needsYou", undefined)).toEqual({ tone: "attention", text: "!" });
    expect(avatarBadge("needsYou", 250)?.text).toBe("99+");
  });

  it("error = red !, done = blue unread count (a dot when unknown), the rest none", () => {
    expect(avatarBadge("error")).toEqual({ tone: "danger", text: "!" });
    expect(avatarBadge("done", null, 3)).toEqual({ tone: "accent", text: "3" });
    expect(avatarBadge("done", null, 0)).toEqual({ tone: "accent", text: "1" });
    expect(avatarBadge("done")).toEqual({ tone: "accent", text: null });
    for (const s of ["running", "idle", "offline", "unknown", undefined] as const) expect(avatarBadge(s, 3, 3), String(s)).toBeNull();
  });
});

describe("avatarPresence", () => {
  it("offline grey, unknown hollow; online only when the site asks", () => {
    expect(avatarPresence("offline")).toBe("offline");
    expect(avatarPresence("unknown")).toBe("unknown");
    expect(avatarPresence("idle")).toBeNull();
    expect(avatarPresence("idle", true)).toBe("online");
    expect(avatarPresence("running", true)).toBe("online");
    expect(avatarPresence(undefined, true)).toBeNull();
  });
});

describe("badgeBox", () => {
  it("the count from 20 px (14 / 16 / 18 px tall), a dot on 16 px", () => {
    expect(badgeBox(40)).toEqual({ height: 18, text: true });
    expect(badgeBox(32)).toEqual({ height: 16, text: true });
    expect(badgeBox(28)).toEqual({ height: 16, text: true });
    expect(badgeBox(20)).toEqual({ height: 14, text: true });
    expect(badgeBox(16)).toEqual({ height: 7, text: false });
  });
});

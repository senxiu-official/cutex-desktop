import { describe, expect, it } from "vitest";
import { agentInfoPatch, avatarColor, cleanAvatar } from "../src/renderer/src/lib/avatar";

describe("agentInfoPatch", () => {
  const before = { avatar: { kind: "emoji" as const, value: "🦊" }, note: "desk" };

  it("sends nothing when nothing changed", () => {
    expect(agentInfoPatch(before, { avatar: { kind: "emoji", value: " 🦊 " }, note: "desk  " })).toEqual({});
  });

  it("sends only the changed field", () => {
    expect(agentInfoPatch(before, { avatar: { kind: "color", value: "#40c057" }, note: "desk" })).toEqual({ avatar: { kind: "color", value: "#40c057" } });
    expect(agentInfoPatch(before, { avatar: before.avatar, note: "  " })).toEqual({ note: null });
  });

  it("clears the avatar back to the default", () => {
    expect(agentInfoPatch(before, { avatar: null, note: "desk" })).toEqual({ avatar: null });
    expect(agentInfoPatch({ avatar: null, note: null }, { avatar: { kind: "emoji", value: "   " }, note: null })).toEqual({});
  });
});

describe("cleanAvatar", () => {
  it("keeps to what cutex accepts", () => {
    expect(cleanAvatar({ kind: "emoji", value: "x".repeat(65) })).toBeNull();
    expect(cleanAvatar({ kind: "emoji", value: "a\nb" })).toBeNull();
    expect(cleanAvatar({ kind: "emoji", value: "🐼" })).toEqual({ kind: "emoji", value: "🐼" });
  });
});

describe("avatar colour (agent-avatar-color)", () => {
  it("keeps a #rrggbb colour on emoji / icon avatars only, lowercased", () => {
    expect(cleanAvatar({ kind: "emoji", value: "🦊", color: "#E8590C" })).toEqual({ kind: "emoji", value: "🦊", color: "#e8590c" });
    expect(cleanAvatar({ kind: "icon", value: "pic-1", color: "#40c057" })).toEqual({ kind: "icon", value: "pic-1", color: "#40c057" });
    expect(cleanAvatar({ kind: "emoji", value: "🦊", color: "red" })).toEqual({ kind: "emoji", value: "🦊" });
    expect(cleanAvatar({ kind: "color", value: "#40c057", color: "#e8590c" })).toEqual({ kind: "color", value: "#40c057" });
  });

  it("resolves the circle colour the avatar sets itself", () => {
    expect(avatarColor({ kind: "color", value: "#40c057" })).toBe("#40c057");
    expect(avatarColor({ kind: "emoji", value: "🦊", color: "#e8590c" })).toBe("#e8590c");
    expect(avatarColor({ kind: "emoji", value: "🦊" })).toBeNull();
    expect(avatarColor(null)).toBeNull();
  });

  it("sends the avatar when only its colour changed", () => {
    const before = { avatar: { kind: "emoji" as const, value: "🦊" }, note: null };
    expect(agentInfoPatch(before, { avatar: { kind: "emoji", value: "🦊", color: "#e8590c" }, note: null })).toEqual({ avatar: { kind: "emoji", value: "🦊", color: "#e8590c" } });
    expect(agentInfoPatch({ avatar: { kind: "emoji", value: "🦊", color: "#e8590c" }, note: null }, { avatar: { kind: "emoji", value: "🦊", color: "#E8590C" }, note: null })).toEqual({});
  });
});

describe("agentInfoPatch display name", () => {
  const before = { avatar: null, note: null, displayName: null };
  it("sends a trimmed alias, null to clear, nothing when unchanged or not edited", () => {
    expect(agentInfoPatch(before, { avatar: null, note: null, displayName: "  小侦探 " })).toEqual({ displayName: "小侦探" });
    expect(agentInfoPatch({ ...before, displayName: "小侦探" }, { avatar: null, note: null, displayName: "  " })).toEqual({ displayName: null });
    expect(agentInfoPatch({ ...before, displayName: "小侦探" }, { avatar: null, note: null, displayName: "小侦探" })).toEqual({});
    expect(agentInfoPatch({ avatar: null, note: null }, { avatar: null, note: null })).toEqual({});
  });
});

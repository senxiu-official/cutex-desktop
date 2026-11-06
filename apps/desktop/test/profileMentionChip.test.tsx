// @vitest-environment jsdom
// Profile chips (components/ProfileMentionChip, lib/profileMentionLabel): the name and avatar from the conversation's
// host, a calm short fallback when unresolved (never a whole UUID), one list read per chip (no render loop).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import { profileMentionText, profileMentionTokens } from "../src/renderer/src/lib/profileMentions";
import { resetMentionProfileReadsForTest, shortProfileRef } from "../src/renderer/src/lib/profileMentionLabel";

const fx = vi.hoisted(() => ({ lists: new Map<string, { defaultProfile: null; profiles: ProfileItem[] } | null>(), load: vi.fn(), avatarHosts: [] as (string | undefined)[] }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfileList: (host?: string) => fx.lists.get(host ?? "focus") ?? null,
  loadProfileList: (host?: string) => fx.load(host),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => vars?.name ? `${key}:${vars.name}` : key }) }));
vi.mock("../src/renderer/src/components/ProfileAvatar", () => ({
  ProfileAvatar: ({ profile, host }: { profile: ProfileItem; host?: string }) => { fx.avatarHosts.push(host); return h("span", { "data-avatar": profile.id }); },
}));
import { ProfileMentionChip } from "../src/renderer/src/components/ProfileMentionChip";
import { MentionText } from "../src/renderer/src/components/MentionText";
vi.mock("../src/renderer/src/lib/mentionWire", () => ({ useMentionRichText: (_h: unknown, _s: unknown, text: string) => text }));
vi.mock("../src/renderer/src/components/AgentMentionChip", () => ({ AgentMentionChip: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UUID = "54138256-6444-4908-8106-c6e96d7f9ee0";
const ada = { id: UUID, name: "Ada", cliKind: "codex" } as ProfileItem;
const chip = (raw: string) => profileMentionTokens(raw)[0]!;
let root: Root, element: HTMLDivElement;
beforeEach(() => {
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  fx.lists.clear(); fx.avatarHosts = []; resetMentionProfileReadsForTest();
  fx.load.mockReset().mockImplementation(async (host?: string) => fx.lists.get(host ?? "focus") ?? null);
});
afterEach(() => { act(() => root.unmount()); element.remove(); });
const shown = () => element.querySelector("[data-profile-mention-chip]")!;

it("names the profile and shows its avatar from the conversation's host, also in the hover text", async () => {
  fx.lists.set("remote", { defaultProfile: null, profiles: [ada] });
  await act(async () => root.render(h(ProfileMentionChip, { token: chip(profileMentionText(UUID, "claude-opus-5-5")), hostId: "remote" })));
  expect(shown().textContent).toBe("Ada · claude-opus-5-5");
  expect(shown().getAttribute("title")).toBe("mention.profileChip:Ada · claude-opus-5-5");
  expect(shown().getAttribute("data-profile-mention-state")).toBe("resolved");
  expect(fx.avatarHosts).toContain("remote");
  // Already cached: no read at all.
  expect(fx.load).not.toHaveBeenCalled();
});

it("reads the host's list once when the profile is not cached, then shows the name", async () => {
  fx.load.mockImplementation(async (host?: string) => { fx.lists.set(host!, { defaultProfile: null, profiles: [ada] }); return fx.lists.get(host!); });
  await act(async () => root.render(h(ProfileMentionChip, { token: chip(profileMentionText(UUID)), hostId: "remote" })));
  expect(fx.load).toHaveBeenCalledTimes(1);
  expect(fx.load).toHaveBeenCalledWith("remote");
  expect(shown().textContent).toBe("Ada");
});

it("unresolved (deleted profile, host offline): a short form and 「unknown profile」, never the whole UUID; no loop", async () => {
  fx.load.mockRejectedValue(new Error("offline"));
  await act(async () => root.render(h(ProfileMentionChip, { token: chip(profileMentionText(UUID, "claude-opus-5-5")), hostId: "gone" })));
  expect(shown().textContent).toBe(`${shortProfileRef(UUID)} · claude-opus-5-5mention.unknownProfile`);
  expect(shown().textContent).not.toContain(UUID);
  expect(shown().getAttribute("title")).not.toContain(UUID);
  expect(shown().getAttribute("data-profile-mention-state")).toBe("unknown");
  await act(async () => root.render(h(ProfileMentionChip, { token: chip(profileMentionText(UUID, "claude-opus-5-5")), hostId: "gone" })));
  expect(fx.load).toHaveBeenCalledTimes(1);
});

it("a short name stays as written; a model-only reference has no profile part", async () => {
  expect(shortProfileRef(UUID)).toBe("54138256…");
  expect(shortProfileRef("Ada")).toBe("Ada");
  await act(async () => root.render(h(ProfileMentionChip, { token: chip(profileMentionText(null, "gpt-6-astra", "high")), hostId: "x" })));
  expect(shown().textContent).toBe("gpt-6-astra · high");
  expect(fx.load).not.toHaveBeenCalled();
});

it("a sent message shows the same chip, resolved on the message's host", async () => {
  fx.lists.set("remote", { defaultProfile: null, profiles: [ada] });
  await act(async () => root.render(h(MentionText, { text: `用 ${profileMentionText(UUID)} 开一个`, hostId: "remote", sessionId: "s" })));
  expect(element.textContent).toBe("用 Ada 开一个");
  expect(shown().getAttribute("data-profile-mention-state")).toBe("resolved");
});

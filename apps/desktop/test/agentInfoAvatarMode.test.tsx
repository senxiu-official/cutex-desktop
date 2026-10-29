// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentInfo } from "../src/renderer/src/lib/avatar";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: () => ({ hostId: "local", style: { kind: "letter" }, isDirector: false, family: "claude" }) }));
vi.mock("../src/renderer/src/lib/avatarStyleAssign", () => ({ shownStyleAvatar: () => null }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ portraitPacks: [] }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ closeDialog: () => {} }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: ({ avatarMode }: { avatarMode?: string }) => h("span", { "data-preview-mode": avatarMode ?? "legacy" }) }));
vi.mock("../src/renderer/src/components/EmojiGrid", () => ({ EmojiGrid: ({ onPick }: { onPick(value: string): void }) => h("button", { onClick: () => onPick("E") }, "pick-emoji") }));
vi.mock("../src/renderer/src/components/DirectorAvatarGrid", () => ({ DirectorAvatarGrid: () => null }));
vi.mock("../src/renderer/src/components/PortraitPackGrid", () => ({ PortraitPackGrid: () => null }));
vi.mock("../src/renderer/src/components/settings/ProfilePictureCrop", () => ({ ProfilePictureCrop: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Segmented: ({ options, onChange }: { options: { value: string; label: string }[]; onChange(value: string): void }) => h("div", null, ...options.map(option => h("button", { key: option.value, onClick: () => onChange(option.value) }, option.label))) }));
import { AgentInfoDialog } from "../src/renderer/src/components/AgentInfoDialog";
import { agentInfoPatch } from "../src/renderer/src/lib/avatar";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const resolved = vi.fn();
beforeEach(() => { resolved.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = (initial: AgentInfo, capable = true) => act(() => root.render(h(AgentInfoDialog, { name: "Agent", seed: "agent", color: null, initial, options: { editName: false, realName: "Agent", combineColor: false, editAvatarMode: capable }, resolve: resolved })));
function click(label: string) { const button = [...host.querySelectorAll("button")].find(node => node.textContent === label); expect(button, label).toBeTruthy(); act(() => button!.click()); }
it("the picker follows Profile changes and clears a fixed picture atomically", () => {
  draw({ avatar: { kind: "emoji", value: "OLD" }, avatarMode: "fixed", note: null });
  click("avatarStyle.followProfile");
  expect(host.querySelector("[data-preview-mode='inherit']")).not.toBeNull();
  click("dialog.ok");
  expect(resolved).toHaveBeenCalledWith({ avatar: null, avatarMode: "inherit", note: "" });
});
it("reset from inherit pins letter even when both stored avatars are empty", () => {
  const initial: AgentInfo = { avatar: null, avatarMode: "inherit", note: null };
  draw(initial); click("avatarStyle.reset"); click("dialog.ok");
  expect(agentInfoPatch(initial, resolved.mock.calls[0]![0])).toEqual({ avatar: null, avatarMode: "fixed" });
});
it("an explicit emoji pick leaves follow mode", () => {
  draw({ avatar: null, avatarMode: "inherit", note: null });
  click("info.avatar.emoji"); click("pick-emoji"); click("dialog.ok");
  expect(resolved).toHaveBeenCalledWith({ avatar: { kind: "emoji", value: "E" }, avatarMode: "fixed", note: "" });
});
it("old hosts keep the old picker and omit unsupported intent", () => {
  draw({ avatar: null, note: null }, false);
  expect([...host.querySelectorAll("button")].some(node => node.textContent === "avatarStyle.followProfile")).toBe(false);
  click("dialog.ok"); expect(resolved.mock.calls[0]![0]).not.toHaveProperty("avatarMode");
});

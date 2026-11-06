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
vi.mock("../src/renderer/src/components/settings/Form", () => ({ InfoTip: () => null, Segmented: ({ options, onChange }: { options: { value: string; label: string }[]; onChange(value: string): void }) => h("div", null, ...options.map(option => h("button", { key: option.value, onClick: () => onChange(option.value) }, option.label))) }));
vi.mock("../src/renderer/src/components/AgentOwnName", () => ({ AgentOwnName: ({ ownName, onRenamed }: { ownName: string; onRenamed(name: string): void }) => h("button", { "data-testid": "own-name", onClick: () => onRenamed("Nova") }, ownName) }));
import { AgentInfoDialog } from "../src/renderer/src/components/AgentInfoDialog";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// 自己的名字 sits right under 显示名称 only when the host offers formal-agent-name-rename-v1 to the owner.
let host: HTMLDivElement, root: Root;
const resolved = vi.fn();
beforeEach(() => { resolved.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const initial: AgentInfo = { avatar: null, note: null, displayName: null };
const draw = (rename: { host: string; sessionId: string; revision: number } | null) => act(() => root.render(h(AgentInfoDialog, { name: "Mira", seed: "mira", color: null, initial, options: { editName: true, realName: "Mira", ownName: "Mira", combineColor: false, rename }, resolve: resolved })));
it("a host without the capability shows the dialog exactly as before", () => {
  draw(null);
  expect(host.querySelector("[data-testid=own-name]")).toBeNull();
  expect(host.querySelector("#agent-info-alias")).not.toBeNull();
});
it("offers the own name next to the display name; a rename updates the display-name placeholder, not the alias", () => {
  draw({ host: "local", sessionId: "cutex.mira", revision: 3 });
  const own = host.querySelector<HTMLButtonElement>("[data-testid=own-name]")!;
  const alias = host.querySelector<HTMLInputElement>("#agent-info-alias")!;
  expect(alias.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(alias.placeholder).toBe("Mira");
  act(() => own.click());
  expect(alias.placeholder).toBe("Nova");
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "dialog.ok")!.click());
  expect(resolved.mock.calls[0]![0]).toMatchObject({ displayName: "" });
});

// @vitest-environment jsdom
// 编辑信息: the 使用项目记忆 switch (cutex agent-memory-injection) shows only when the caller passes the agent's
// value, says 下次启动生效 once changed, and comes back with the result; the metadata patch ignores it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentInfo } from "../src/renderer/src/lib/avatar";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: () => ({ hostId: "local", style: { kind: "letter" }, isDirector: false, family: "codex" }) }));
vi.mock("../src/renderer/src/lib/avatarStyleAssign", () => ({ shownStyleAvatar: () => null }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ portraitPacks: [] }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ closeDialog: () => {} }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: () => h("span") }));
vi.mock("../src/renderer/src/components/EmojiGrid", () => ({ EmojiGrid: () => null }));
vi.mock("../src/renderer/src/components/DirectorAvatarGrid", () => ({ DirectorAvatarGrid: () => null }));
vi.mock("../src/renderer/src/components/PortraitPackGrid", () => ({ PortraitPackGrid: () => null }));
vi.mock("../src/renderer/src/components/settings/ProfilePictureCrop", () => ({ ProfilePictureCrop: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Segmented: () => null, InfoTip: () => null }));
import { AgentInfoDialog } from "../src/renderer/src/components/AgentInfoDialog";
import { agentInfoPatch } from "../src/renderer/src/lib/avatar";
import { zhCN } from "../src/renderer/src/modules/agent-config/i18n";
import { en } from "../src/renderer/src/modules/agent-config/i18n.en";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const resolved = vi.fn();
beforeEach(() => { resolved.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = (initial: AgentInfo) => act(() => root.render(h(AgentInfoDialog, { name: "Agent", seed: "agent", color: null, initial, options: { editName: false, realName: "Agent", combineColor: false }, resolve: resolved })));
const box = () => host.querySelector("[data-testid=agent-info-memory]") as HTMLInputElement | null;
const ok = () => act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "dialog.ok")!.click());

it("hidden when the host has no agent-memory-injection (no value passed)", () => {
  draw({ avatar: null, note: null });
  expect(box()).toBeNull();
  ok();
  expect(resolved.mock.calls[0]![0]).not.toHaveProperty("memoryInjection");
});

it("turning it off says 下次启动生效 and returns the new value; the metadata patch stays empty", () => {
  const initial: AgentInfo = { avatar: null, note: null, memoryInjection: true };
  draw(initial);
  expect(box()!.checked).toBe(true);
  expect(host.querySelector("[data-testid=agent-info-memory-pending]")).toBeNull();
  act(() => box()!.click());
  expect(host.querySelector("[data-testid=agent-info-memory-pending]")!.textContent).toBe("agent-config.memoryInjection.nextLaunch");
  ok();
  const after = resolved.mock.calls[0]![0] as AgentInfo;
  expect(after.memoryInjection).toBe(false);
  expect(agentInfoPatch(initial, after)).toEqual({});
});

it("strings exist in zh-CN and en", () => {
  for (const k of ["label", "newHint", "infoHint", "nextLaunch"]) {
    const key = `agent-config.memoryInjection.${k}` as keyof typeof zhCN;
    expect(zhCN[key]).toBeTruthy();
    expect(en[key]).toBeTruthy();
  }
  expect(zhCN["agent-config.memoryInjection.label"]).toBe("使用项目记忆");
});

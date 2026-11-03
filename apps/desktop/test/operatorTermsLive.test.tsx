// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: () => ({ color: "#3366cc", family: "openai", themes: null, isDirector: false, isOperator: true, project: null, pinned: false }), useMinorDot: () => false, useProjectStyleWorn: () => new Set() }));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({ portraitFor: () => null, portraitRefOf: () => null, usePortraitImage: () => null, usePortraitPacks: () => ({ index: {} }) }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
import { Avatar } from "../src/renderer/src/components/Avatar";
import { I18nProvider, useI18n } from "../src/renderer/src/i18n";
import { resetTerm, setTerm } from "../src/renderer/src/lib/terms";
import { applyTermPreset } from "../src/renderer/src/lib/termPresets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("updates an already mounted role label when terms change; the avatar carries no Operator marker", async () => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  function Sample() { const { t } = useI18n(); return h("div", null, h(Avatar, { name: "Deputy", seed: "s", size: 28 }), h("span", { "data-role": true }, t("sidebar.operator"))); }
  try {
    await act(async () => root.render(h(I18nProvider, null, h(Sample))));
    const label = () => div.querySelector("[data-role]")!.textContent;
    expect(label()).toBe("副主管"); expect(div.querySelector("[data-operator-mark]")).toBeNull();
    act(() => setTerm("zh-CN", "operator", "one", "副管家"));
    expect(label()).toBe("副管家");
    act(() => applyTermPreset("zh-CN", "maid"));
    expect(label()).toBe("Deputy Maid");
  } finally {
    act(() => root.unmount()); div.remove(); applyTermPreset("zh-CN", "default"); resetTerm("zh-CN", "operator");
  }
});

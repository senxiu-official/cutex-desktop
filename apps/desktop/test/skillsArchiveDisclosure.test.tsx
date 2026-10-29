// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SkillArchiveRecord } from "../src/shared/skillsArchive";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({useSettingsRowDecoration: () => undefined, SettingsGroup: ({ children }: any) => children, SettingsEffectCard: ({ children }: any) => children,
  Button: ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick(): void }) => h("button", { disabled, onClick }, children),
  Card: ({ children }: { children: React.ReactNode }) => h("div", null, children),
  ListRow: ({ title, actions }: { title: string; actions: React.ReactNode }) => h("div", { "data-archive-row": "" }, title, actions),
  IconButton: () => null,
}));
import { ArchivedSkills } from "../src/renderer/src/components/settings/SkillsArchive";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("uses the shared disclosure and preserves the mounted archive row and restore action", () => {
  const archive = { id: "archived-skill", name: "Review", archivedAt: "2026-10-24T00:00:00Z", originalPath: "/test/review" } as SkillArchiveRecord;
  const restore = vi.fn(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    act(() => root.render(h(ArchivedSkills, { archives: [archive], busy: null, onRestore: restore })));
    const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const row = host.querySelector("[data-archive-row]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle.click()); act(() => toggle.click()); act(() => toggle.click());
    expect(host.querySelector("[data-archive-row]")).toBe(row);
    act(() => row.querySelector<HTMLButtonElement>("button")!.click());
    expect(restore).toHaveBeenCalledExactlyOnceWith(archive);
  } finally { act(() => root.unmount()); host.remove(); }
});

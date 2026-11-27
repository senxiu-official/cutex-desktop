// @vitest-environment jsdom
// Settings → 新功能 (onboarding v3, owner 2026-11-26): per version from the bundled changelog, 0.2.x on (no 0.1.x),
// the installed version open, no internal build names, 「还有 N 条」 in a long version.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangelogRelease } from "../src/shared/changelog";
const fx = vi.hoisted(() => ({ installed: "0.2.5" as string | null }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key), locale: "zh-CN" }) }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => (fx.installed ? { current: { version: fx.installed, commit: "x" } } : null) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ title, actions, children }: { title: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) => h("section", null, h("h2", null, title), actions, children),
}));
const { provideReleases } = await import("../src/renderer/src/lib/onboarding");
const { featureReleases } = await import("../src/renderer/src/lib/releaseNotes");
const { NewFeaturesPage, FIRST_ITEMS } = await import("../src/renderer/src/modules/onboarding/NewFeaturesPage");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (text: string, zh?: string) => ({ kind: "item" as const, text, ...(zh ? { zh } : {}) });
const RELEASES: ChangelogRelease[] = [
  { version: "0.3.0", title: "Next", blocks: [item("Three")] },
  { version: "0.2.5", blocks: Array.from({ length: FIRST_ITEMS + 3 }, (_, i) => item(`Item ${i}`, `条目 ${i}`)) },
  { version: "0.2.4", blocks: [{ kind: "heading", text: "Fixes" }, item("Works with r266 hosts.", "搭配 r266 主机使用。")] },
  { version: "0.2.0-rc.1", blocks: [item("Beta")] },
  { version: "0.1.9", blocks: [item("Old")] },
];

afterEach(() => {
  fx.installed = "0.2.5";
});

function mount() {
  const node = document.createElement("div");
  const root = createRoot(node);
  act(() => root.render(h(NewFeaturesPage)));
  return { node, root, release: (v: string) => node.querySelector<HTMLElement>(`[data-release="${v}"]`) };
}

describe("featureReleases", () => {
  it("keeps 0.2.0 and later (pre-releases included) and drops 0.1.x, in changelog order", () => {
    expect(featureReleases(RELEASES).map((r) => r.version)).toEqual(["0.3.0", "0.2.5", "0.2.4", "0.2.0-rc.1"]);
  });
});

describe("NewFeaturesPage", () => {
  it("lists each version, opens the installed one, and has no 0.1.x", () => {
    provideReleases(RELEASES);
    const { release, root } = mount();
    expect(release("0.1.9")).toBeNull();
    expect(release("0.2.5")?.dataset.open).toBe("true");
    expect(release("0.3.0")?.dataset.open).toBe("false");
    expect(release("0.2.5")?.textContent).toContain("start.whatsNew.current");
    act(() => root.unmount());
  });

  it("shows the first items with 「还有 N 条」, then all of them", () => {
    provideReleases(RELEASES);
    const { release, root } = mount();
    const items = () => release("0.2.5")!.querySelectorAll("li:not(.list-none)").length;
    expect(items()).toBe(FIRST_ITEMS);
    const more = [...release("0.2.5")!.querySelectorAll("button")].find((b) => b.textContent?.startsWith("start.whatsNew.more"))!;
    expect(more.textContent).toContain('"n":3');
    act(() => more.click());
    expect(items()).toBe(FIRST_ITEMS + 3);
    act(() => root.unmount());
  });

  it("opens a folded version on 展开 and leaves internal build names out", () => {
    provideReleases(RELEASES);
    const { release, root } = mount();
    const toggle = [...release("0.2.4")!.querySelectorAll("button")].find((b) => b.textContent === "start.whatsNew.expand")!;
    act(() => toggle.click());
    expect(release("0.2.4")?.dataset.open).toBe("true");
    expect(release("0.2.4")?.textContent).not.toMatch(/r266/);
    expect(release("0.2.4")?.textContent).toContain("新版主机");
    act(() => root.unmount());
  });

  it("without a known version opens the newest", () => {
    fx.installed = null;
    provideReleases(RELEASES);
    const { release, root } = mount();
    expect(release("0.3.0")?.dataset.open).toBe("true");
    act(() => root.unmount());
  });
});

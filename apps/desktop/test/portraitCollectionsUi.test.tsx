// @vitest-environment jsdom
// 完整头像主题 in the UI (owner 2026-11-27, docs/desktop-optional-collections.md): the library's states, download /
// progress / error + 重试 on Settings → 外观; the quiet 「下载完整主题」 where a portrait is chosen; Claude Science's
// migration line on Settings → 模块. The bridge is a fake of main's service (state / install / retry + its event).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortraitCollectionsView } from "../src/shared/portraitCollections";

const fx = vi.hoisted(() => ({
  openSettings: vi.fn(),
  emit: null as null | ((p: { view: unknown; packsChanged: boolean }) => void),
}));

vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ openSettings: fx.openSettings }) }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {} }));
vi.mock("../src/renderer/src/i18n", () => ({
  useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key}${JSON.stringify(v)}` : key), locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/lib/portraitThemes", () => {
  const theme = (id: string) => ({ key: `kit-20261029/${id}`, pack: "kit-20261029", packName: "kit", bundled: true, theme: id, name: id, subtitle: null, cover: { key: id }, count: 6, families: {} });
  return {
    usePortraitThemes: () => ({ themes: ["cloud-woven-silks", "great-ming", "tales-of-frills", "ad-astra", "snowy-owl-post", "kindred-creatures"].map(theme), enabled: [] }),
    useSampleUrl: () => null,
  };
});

import { collectionPercent, collectionStatus, resetPortraitCollectionsForTest } from "../src/renderer/src/lib/portraitCollections";
import { PortraitLibrarySection } from "../src/renderer/src/components/settings/PortraitLibrary";
import { PortraitDownloadHint, PortraitThemesHint } from "../src/renderer/src/components/PortraitDownloadHint";
import { PackBelow } from "../src/renderer/src/modules/shell/ModulePacks";
import type { PackRow } from "../src/renderer/src/modules/packs";

const MB = 1024 * 1024;
const VIEW: PortraitCollectionsView = {
  checked: true,
  themes: [
    { theme: "cloud-woven-silks", available: 2, installed: 2, bytes: 3 * MB },
    { theme: "great-ming", available: 2, installed: 1, bytes: 4 * MB },
    { theme: "tales-of-frills", available: null, installed: 0, bytes: null },
    { theme: "ad-astra", available: 1, installed: null, bytes: 5 * MB },
    { theme: "snowy-owl-post", available: 1, installed: null, bytes: 2 * MB },
  ],
  operation: null,
  error: null,
};

let fake: { state: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; install: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
let root: Root | null = null;
let host: HTMLDivElement;

function install(view: PortraitCollectionsView) {
  fake = { state: vi.fn(async () => view), check: vi.fn(async () => view), install: vi.fn(async () => view), retry: vi.fn(async () => view) };
  (globalThis as { cutex?: unknown }).cutex = {
    portraitCollections: fake,
    on: (event: string, l: (p: { view: unknown; packsChanged: boolean }) => void) => {
      if (event === "portraitCollections") fx.emit = l;
      return () => {};
    },
  };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function mount(node: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  await flush();
}
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const send = (view: PortraitCollectionsView) => act(() => fx.emit!({ view, packsChanged: false }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetPortraitCollectionsForTest();
  fx.openSettings.mockReset();
  fx.emit = null;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  delete (globalThis as { cutex?: unknown }).cutex;
});

describe("collection status", () => {
  it("maps main's rows to the library's states", () => {
    expect(collectionStatus(VIEW, "cloud-woven-silks")).toEqual({ kind: "installed", installed: 2 });
    expect(collectionStatus(VIEW, "great-ming")).toMatchObject({ kind: "update", installed: 1, available: 2 });
    expect(collectionStatus(VIEW, "tales-of-frills")).toEqual({ kind: "installed", installed: 0 });
    expect(collectionStatus(VIEW, "ad-astra")).toMatchObject({ kind: "downloadable", available: 1, bytes: 5 * MB });
    expect(collectionStatus(VIEW, "kindred-creatures")).toEqual({ kind: "starter" });
    const working = collectionStatus({ ...VIEW, operation: { theme: "ad-astra", step: "download", received: MB, total: 4 * MB } }, "ad-astra");
    expect(working.kind).toBe("working");
    expect(collectionPercent(working)).toBe(25);
    expect(collectionPercent(collectionStatus({ ...VIEW, operation: { theme: "ad-astra", step: "verify" } }, "ad-astra"))).toBe(100);
  });
});

describe("Settings → 外观 → 完整头像主题", () => {
  it("shows each theme's state and only the actions the contract has", async () => {
    install(VIEW);
    await mount(h(PortraitLibrarySection));
    const state = (theme: string) => q(`[data-portrait-collection="${theme}"]`)?.dataset.state;
    expect(state("cloud-woven-silks")).toBe("installed");
    expect(state("great-ming")).toBe("update");
    expect(state("tales-of-frills")).toBe("installed");
    expect(state("ad-astra")).toBe("downloadable");
    expect(state("kindred-creatures")).toBe("starter");
    expect(q('[data-portrait-collection="great-ming"]')!.textContent).toContain('portraitLib.update{"version":2}');
    expect(q('[data-portrait-collection="tales-of-frills"]')!.textContent).toContain("portraitLib.legacy");
    // No cancel and no remove: main offers neither.
    expect(host.textContent).not.toMatch(/cancel|remove/i);
  });

  it("downloads by theme, follows main's progress and waits while one runs", async () => {
    install(VIEW);
    await mount(h(PortraitLibrarySection));
    const button = [...q('[data-portrait-collection="ad-astra"]')!.querySelectorAll("button")].find((b) => b.textContent === "portraitLib.download")!;
    await act(async () => button.click());
    expect(fake.install).toHaveBeenCalledWith("ad-astra");
    send({ ...VIEW, operation: { theme: "ad-astra", step: "download", received: 2 * MB, total: 5 * MB } });
    expect(q('[data-portrait-collection="ad-astra"]')?.dataset.state).toBe("working");
    expect(q('[data-portrait-collection="ad-astra"] [role=progressbar]')?.getAttribute("aria-valuenow")).toBe("40");
    const other = [...q('[data-portrait-collection="snowy-owl-post"]')!.querySelectorAll("button")].find((b) => b.textContent === "portraitLib.download")!;
    expect(other.disabled).toBe(true);
  });

  it("says what failed and retries", async () => {
    install({ ...VIEW, error: { code: "verify_failed", theme: "snowy-owl-post" } });
    await mount(h(PortraitLibrarySection));
    const row = q('[data-portrait-collection="snowy-owl-post"]')!;
    expect(row.dataset.error).toBe("verify_failed");
    expect(row.textContent).toContain("portraitLib.error.verify_failed");
    await act(async () => [...row.querySelectorAll("button")].find((b) => b.textContent === "portraitLib.retry")!.click());
    expect(fake.retry).toHaveBeenCalled();
  });

  it("puts a catalogue error at the top, before any check", async () => {
    install({ checked: false, themes: VIEW.themes.filter((r) => r.installed !== null).map((r) => ({ ...r, available: null })), operation: null, error: { code: "index_unavailable", theme: null } });
    await mount(h(PortraitLibrarySection));
    expect(q("[data-portrait-library-status]")?.textContent).toBe("portraitLib.notChecked");
    expect(q("[data-portrait-library-error]")?.dataset.portraitLibraryError).toBe("index_unavailable");
    expect(q('[data-portrait-collection="ad-astra"]')?.dataset.state).toBe("starter");
  });

  it("shows the loading line until main answers", async () => {
    install(VIEW);
    fake.state.mockImplementation(() => new Promise(() => {}));
    await mount(h(PortraitLibrarySection));
    expect(q("[data-portrait-library-loading]")).toBeTruthy();
    expect(q("[data-portrait-library]")).toBeNull();
  });

  it("is absent without the bridge", async () => {
    await mount(h(PortraitLibrarySection));
    expect(q("[data-portrait-library]")).toBeNull();
  });
});

describe("「下载完整主题」 where a portrait is chosen", () => {
  it("says a stand-in shows and downloads the theme", async () => {
    install(VIEW);
    await mount(h(PortraitDownloadHint, { pack: "kit-20261029", theme: "ad-astra", missing: true }));
    const hint = q("[data-portrait-download-hint]")!;
    expect(hint.dataset.missing).toBe("");
    expect(hint.textContent).toContain("portraitHint.missing");
    await act(async () => q("[data-portrait-download]")!.click());
    expect(fake.install).toHaveBeenCalledWith("ad-astra");
    send({ ...VIEW, operation: { theme: "ad-astra", step: "download", received: MB, total: 2 * MB } });
    expect(q("[data-portrait-download-hint]")?.textContent).toContain('portraitHint.working{"percent":50}');
  });

  it("stays quiet for a full theme, an update that is not about the chosen picture, and the owner's own packs", async () => {
    install(VIEW);
    await mount(h("div", null,
      h(PortraitDownloadHint, { pack: "kit-20261029", theme: "cloud-woven-silks" }),
      h(PortraitDownloadHint, { pack: "kit-20261029", theme: "great-ming" }),
      h(PortraitDownloadHint, { pack: "my-pack", theme: "ad-astra", missing: true }),
    ));
    expect(q("[data-portrait-download-hint]")).toBeNull();
  });

  it("counts ticked starter-only themes in a 头像风格 picker and opens the library", async () => {
    install(VIEW);
    await mount(h(PortraitThemesHint, { keys: ["kit-20261029/ad-astra", "kit-20261029/snowy-owl-post", "kit-20261029/cloud-woven-silks", "my-pack/x"] }));
    expect(q("[data-portrait-themes-hint]")?.dataset.portraitThemesHint).toBe("2");
    await act(async () => q("[data-portrait-themes-hint] button")!.click());
    expect(fx.openSettings).toHaveBeenCalledWith("appearance", { anchor: "portrait-library" });
  });
});

describe("Settings → 模块: Claude Science moving to its signed pack", () => {
  const row = (over: Partial<PackRow>): PackRow => ({ id: "claude-science", bundled: true, bundledVersion: "1.0.0", installed: null, activeVersion: null, decision: null, broken: null, offer: null, others: [], operation: null, error: null, available: [], ...over });
  const note = async (over: Partial<PackRow>) => {
    await mount(h(PackBelow, { row: row(over) }));
    const text = q("[data-pack-migration]")?.textContent ?? null;
    act(() => root?.unmount());
    root = null;
    return text;
  };
  it("says done, bundled copy in use, or next start", async () => {
    expect(await note({ migration: "installed", activeVersion: "1.1.0" })).toBe("modules.pack.migration.done");
    expect(await note({ migration: "complete", activeVersion: "1.1.0" })).toBe("modules.pack.migration.done");
    expect(await note({ migration: "seed_missing" })).toBe("modules.pack.migration.bundled");
    expect(await note({ migration: "seed_invalid" })).toBe("modules.pack.migration.bundled");
    expect(await note({ migration: "busy" })).toBe("modules.pack.migration.busy");
    // The owner removed the signed copy later: nothing to say (it is not brought back).
    expect(await note({ migration: "complete" })).toBeNull();
    expect(await note({ migration: null })).toBeNull();
    // kept may be the owner's own copy from a file: not a signed pack.
    expect(await note({ migration: "kept", activeVersion: "1.0.2", installed: { id: "claude-science", version: "1.0.2", moduleApi: "^1.16", compat: "ok", entry: "", styles: [], host: {}, local: true } })).toBeNull();
  });
  it("progress and errors still win", async () => {
    expect(await note({ migration: "seed_missing", operation: { id: "claude-science", action: "install", version: "1.1.0", step: "download" } })).toBeNull();
  });
});

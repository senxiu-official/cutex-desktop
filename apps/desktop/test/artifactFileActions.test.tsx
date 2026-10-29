// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDetail, ArtifactSummary, ArtifactVersion } from "../src/shared/artifactStore";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";

const fixture = vi.hoisted(() => ({ get: vi.fn(), notice: vi.fn(), copy: vi.fn(), shell: vi.fn(), menuAt: vi.fn(), menuFrom: vi.fn(), detail: null as ArtifactDetail | null }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  return { agentHost: () => "local", useApp: create(() => ({ hosts: { active: "local", hosts: [
    { id: "local", kind: "local", label: "This desktop" }, { id: "remote", kind: "ssh", label: "Remote host" },
  ] }, notify: fixture.notice })) };
});
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { platform: "win32", shell: { filePath: fixture.shell } } }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key, useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: {
  daemonFor: (hostId: string) => ({ artifactStoreGet: (id: string) => fixture.get(hostId, id) }),
  ui: { notice: fixture.notice }, refs: { open: vi.fn() },
} }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuAt: fixture.menuAt, openMenuFrom: fixture.menuFrom, confirmDialog: vi.fn(), promptDialog: vi.fn() }));
vi.mock("../src/renderer/src/lib/menus", () => ({ copyText: fixture.copy }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ delegationOn: vi.fn(), loadDelegationDetail: vi.fn(), useDelegations: { getState: () => ({ byKey: {}, details: {} }) } }));
vi.mock("../src/renderer/src/lib/delegations", () => ({ requesterSession: vi.fn() }));
vi.mock("../src/renderer/src/lib/focusRequest", () => ({ focusDelegation: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/pageData", () => ({ clearPageData: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/store", () => ({ useCachedDetail: () => fixture.detail, invalidateArtifact: vi.fn(), loadDetail: vi.fn(), startArtifactSync: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/refTarget", () => ({ artifactThumbnail: vi.fn(), openArtifactRef: vi.fn(), useArtifactLink: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/summary", () => ({ useProjectArtifactsSummary: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/live", () => ({ startAutoOpen: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/Toasts", () => ({ ArtifactToasts: () => null }));
vi.mock("../src/renderer/src/modules/artifacts/tabs", () => ({ useLibraryTab: vi.fn(), useViewTab: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/ToolRow", () => ({ PublishToolRow: () => null }));
vi.mock("../src/renderer/src/lib/workGroups", () => ({ isRunning: vi.fn() }));
vi.mock("../src/renderer/src/lib/lazyPage", () => ({ lazyPage: () => () => null }));
vi.mock("../src/renderer/src/modules/slots", () => ({ defineModule: (value: unknown) => value }));

import { artifactFileVersion, artifactSourceFileEntries, loadArtifactSourceFileEntries, openArtifactSourceFileMenu } from "../src/renderer/src/modules/artifacts/fileActions";
import { artifactMenu } from "../src/renderer/src/modules/artifacts/actions";
import { ViewActions } from "../src/renderer/src/modules/artifacts/ViewActions";
import artifactsModule from "../src/renderer/src/modules/artifacts";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { useApp } from "../src/renderer/src/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ID = "af-0123456789abcdef0123456789abcdef";
const OTHER = "af-1123456789abcdef0123456789abcdef";
const first = { artifactId: ID, version: 1, sourcePath: "D:\\reports\\first.md", storage: "blob", mediaType: "text/markdown" } as ArtifactVersion;
const latest = { ...first, version: 2, sourcePath: "D:\\reports\\second.md" };
function detail(versions: ArtifactVersion[] = [latest, first]): ArtifactDetail {
  return { artifact: { artifactId: ID, name: "report", latestVersion: 2, latest, kind: "report", revision: 1 } as ArtifactSummary, versions };
}
const rows = (entries: MenuEntry[]) => entries.filter((entry): entry is MenuAction => !!entry && entry !== "separator");

let clipboard: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.clearAllMocks(); fixture.detail = detail(); fixture.get.mockResolvedValue(fixture.detail);
  fixture.copy.mockResolvedValue(undefined); fixture.shell.mockResolvedValue(undefined);
  clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: fixture.copy } });
  useApp.setState({ hosts: { active: "local", hosts: [{ id: "local", kind: "local", label: "This desktop" }, { id: "remote", kind: "ssh", label: "Remote host" }] } } as never);
});
afterEach(() => { if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard); else Reflect.deleteProperty(navigator, "clipboard"); });

describe("artifact source paths", () => {
  it("uses the selected pinned version and never falls back from a missing version to latest", () => {
    expect(artifactFileVersion(detail(), `${ID}@1`)).toBe(first);
    expect(artifactFileVersion(detail(), `${ID}@latest`)).toBe(latest);
    expect(artifactFileVersion(detail([latest]), `${ID}@1`)).toBeNull();
    expect(artifactFileVersion(detail(), `${OTHER}@1`)).toBeNull();
    expect(artifactFileVersion(detail([{ ...first, artifactId: OTHER }]), `${ID}@1`)).toBeNull();
  });
  it("copies the exact source path, not an inferred blob location or normalized replacement", async () => {
    const path = "D:\\reports\\source with spaces.md ";
    const entries = rows(artifactSourceFileEntries("local", { ...first, sourcePath: path }));
    await entries.find(entry => entry.label === "artifacts.copyFilePath")!.onSelect();
    expect(fixture.copy).toHaveBeenCalledExactlyOnceWith(path);
    expect(entries.map(entry => entry.label)).toContain("menu.revealExplorer");
    expect(entries.map(entry => entry.label)).toContain("menu.openFile");
  });
  it("remote paths are labelled with their actual host and never gain local open/reveal for a matching Windows path", async () => {
    const entries = rows(artifactSourceFileEntries("remote", first));
    expect(entries.map(entry => entry.label)).toEqual(["artifacts.copyFilePath · Remote host"]);
    await entries[0]!.onSelect(); expect(fixture.copy).toHaveBeenCalledWith(first.sourcePath); expect(fixture.shell).not.toHaveBeenCalled();
    // A host id equal to the usual local id is insufficient without local metadata.
    useApp.setState({ hosts: { active: "local", hosts: [{ id: "local", kind: "ssh", label: "Remote alias" }] } } as never);
    expect(rows(artifactSourceFileEntries("local", first)).map(entry => entry.label)).toEqual(["artifacts.copyFilePath · Remote alias"]);
  });
  it("local reveal/open sends the exact pinned source path through the shell bridge and rechecks locality", async () => {
    const entries = rows(artifactSourceFileEntries("local", first));
    await entries.find(entry => entry.label === "menu.revealExplorer")!.onSelect();
    expect(fixture.shell).toHaveBeenLastCalledWith("local", first.sourcePath, "reveal");
    const open = entries.find(entry => entry.label === "menu.openFile")!;
    await open.onSelect(); expect(fixture.shell).toHaveBeenLastCalledWith("local", first.sourcePath, "open");
    useApp.setState({ hosts: { active: "local", hosts: [{ id: "local", kind: "ssh", label: "Remote alias" }] } } as never);
    await expect(open.onSelect()).rejects.toThrow(); expect(fixture.shell).toHaveBeenCalledTimes(2);
  });
  it("does not synthesize a path or expose shell actions for relative source paths", () => {
    expect(artifactSourceFileEntries("local", { ...first, sourcePath: "" })).toEqual([]);
    expect(artifactSourceFileEntries("local", null)).toEqual([]);
    expect(rows(artifactSourceFileEntries("local", { ...first, sourcePath: "reports/relative.md" })).map(entry => entry.label)).toEqual(["artifacts.copyFilePath"]);
  });
  it("library menus use latest while an explicit pinned header uses its own source version", async () => {
    await rows(artifactMenu("local", detail().artifact, null)).find(entry => entry.label === "artifacts.copyFilePath")!.onSelect();
    expect(fixture.copy).toHaveBeenLastCalledWith(latest.sourcePath);
    await rows(artifactMenu("local", detail().artifact, null, first)).find(entry => entry.label === "artifacts.copyFilePath")!.onSelect();
    expect(fixture.copy).toHaveBeenLastCalledWith(first.sourcePath);
    expect(rows(artifactMenu("local", detail().artifact, null, null)).some(entry => entry.label === "artifacts.copyFilePath")).toBe(false);
  });
  it("only asks the clicked chip's pinned host for detail, then opens that exact version's menu", async () => {
    await openArtifactSourceFileMenu("remote", `${ID}@1`);
    expect(fixture.get).toHaveBeenCalledExactlyOnceWith("remote", ID);
    const entries = rows(fixture.menuAt.mock.calls[0]![2]);
    await entries[0]!.onSelect(); expect(fixture.copy).toHaveBeenLastCalledWith(first.sourcePath);
    expect(fixture.shell).not.toHaveBeenCalled();
  });
  it("missing pinned version/path and a reset host cannot open a stale or latest-file menu", async () => {
    fixture.get.mockResolvedValueOnce(detail([latest])); await openArtifactSourceFileMenu("local", `${ID}@1`);
    expect(fixture.menuAt).not.toHaveBeenCalled(); expect(fixture.notice).toHaveBeenCalledWith("artifacts.sourceFileUnavailable");
    let complete!: (value: ArtifactDetail) => void;
    fixture.get.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = openArtifactSourceFileMenu("remote", `${ID}@1`); fireHostReset("remote"); complete(detail()); await pending;
    expect(fixture.menuAt).not.toHaveBeenCalled();
  });
  it("registers chip actions without eagerly fetching any artifact details", async () => {
    const action = artifactsModule.contributes?.["ref.action"]?.find(item => item.id === "artifacts.sourceFileActions");
    expect(action).toBeTruthy(); expect(fixture.get).not.toHaveBeenCalled();
    await action!.run({ hostId: "remote", kind: "artifact", key: `${ID}@1`, title: "report", params: {} });
    expect(fixture.get).toHaveBeenCalledExactlyOnceWith("remote", ID);
  });
  it("resolves a chip's source submenu lazily on its pinned host/version without opening another menu", async () => {
    const action = artifactsModule.contributes?.["ref.action"]?.find(item => item.id === "artifacts.sourceFileActions")!;
    expect(action.submenu).toBeTypeOf("function");
    expect(fixture.get).not.toHaveBeenCalled();
    const entries = rows(await action.submenu!({ hostId: "remote", kind: "artifact", key: `${ID}@1`, title: "report", params: {} }));
    expect(fixture.get).toHaveBeenCalledExactlyOnceWith("remote", ID);
    expect(fixture.menuAt).not.toHaveBeenCalled();
    expect(fixture.menuFrom).not.toHaveBeenCalled();
    await entries[0]!.onSelect();
    expect(fixture.copy).toHaveBeenCalledExactlyOnceWith(first.sourcePath);
    expect(fixture.shell).not.toHaveBeenCalled();
  });
  it("does not fall back to latest or open a replacement menu when a lazy source is missing or stale", async () => {
    fixture.get.mockResolvedValueOnce(detail([latest]));
    expect(await loadArtifactSourceFileEntries("local", `${ID}@1`)).toEqual([]);
    expect(fixture.notice).toHaveBeenCalledWith("artifacts.sourceFileUnavailable");
    let finish!: (value: ArtifactDetail) => void;
    fixture.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = loadArtifactSourceFileEntries("remote", `${ID}@1`);
    fireHostReset("remote"); finish(detail());
    expect(await pending).toEqual([]);
    expect(fixture.menuAt).not.toHaveBeenCalled();
  });
  it("registers a direct copy-path ref action that uses the pinned host version exactly", async () => {
    const actions = artifactsModule.contributes?.["ref.action"] ?? [];
    expect(actions.map(action => action.id)).toEqual(expect.arrayContaining(["artifacts.copyLink", "artifacts.copyFilePath", "artifacts.sourceFileActions"]));
    const action = actions.find(item => item.id === "artifacts.copyFilePath");
    expect(fixture.get).not.toHaveBeenCalled();
    expect(action!.useState?.({ hostId: "remote", kind: "artifact", key: `${ID}@1`, title: "report", params: {} })).toEqual({ tooltip: "Remote host" });
    expect(action!.useState?.({ hostId: "local", kind: "artifact", key: `${ID}@1`, title: "report", params: {} })).toBeNull();
    await action!.run({ hostId: "remote", kind: "artifact", key: `${ID}@1`, title: "report", params: {} });
    expect(fixture.get).toHaveBeenCalledExactlyOnceWith("remote", ID);
    expect(fixture.copy).toHaveBeenCalledExactlyOnceWith(first.sourcePath);
    expect(fixture.menuAt).not.toHaveBeenCalled();

    fixture.get.mockResolvedValueOnce(detail([latest]));
    await action!.run({ hostId: "remote", kind: "artifact", key: `${ID}@1`, title: "report", params: {} });
    expect(fixture.notice).toHaveBeenCalledWith("artifacts.sourceFileUnavailable");
    expect(fixture.copy).toHaveBeenCalledTimes(1);
  });
  it("view header exposes source actions for its displayed pinned version without another fetch", () => {
    const element = document.createElement("div"), root = createRoot(element); document.body.append(element);
    try {
      act(() => root.render(h(ViewActions, { instance: { state: { ref: `${ID}@1` } }, hostId: "local" } as never)));
      const button = element.querySelector<HTMLButtonElement>('button[aria-label="artifacts.sourceFileActions"]')!;
      act(() => button.click()); expect(fixture.get).not.toHaveBeenCalled();
      expect(rows(fixture.menuFrom.mock.calls[0]![1]).map(entry => entry.label)).toContain("menu.openFile");
      expect(element.querySelector('button[aria-label="artifacts.copyLink"]')).not.toBeNull();
    } finally { act(() => root.unmount()); element.remove(); }
  });
});

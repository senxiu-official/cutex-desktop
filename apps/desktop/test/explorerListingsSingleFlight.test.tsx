// @vitest-environment jsdom
// 文件 tree listings: a folder whose version changes while its read is slow waits for that read and then
// reads once more, instead of starting a read per change (the same pile-up as git status, 2026-11-08).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonApi, FsEntry, WorkspaceScope } from "../src/shared/ipc";
import { DirVersions } from "../src/renderer/src/lib/workspaceRefresh";
import { useListings, type ListingsView } from "../src/renderer/src/modules/workspace/explorer/useListings";

vi.mock("../src/renderer/src/lib/workspaceView", () => ({ workspaceError: (e: unknown) => String(e) }));

const SCOPE = { kind: "session", id: "s1" } as WorkspaceScope;
const entry = (name: string) => ({ path: name, name, kind: "file", size: 1, modifiedAt: "2026-11-08T00:00:00Z", ignored: false, targetKind: null }) as unknown as FsEntry;

describe("useListings: one read at a time per folder", () => {
  let root: Root;
  let host: HTMLElement;
  let view: ListingsView;
  let pending: ((entries: FsEntry[]) => void)[];
  let inFlight: number;
  let maxInFlight: number;
  let reads: number;
  const api = {
    fsDir: () => {
      reads++;
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      return new Promise((resolve) => pending.push((entries) => { inFlight--; resolve({ entries }); }));
    },
  } as unknown as DaemonApi;
  const wanted = [""];
  const dirs = new DirVersions();
  function Probe() {
    view = useListings(api, SCOPE, dirs, wanted);
    return null;
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    pending = [];
    inFlight = maxInFlight = reads = 0;
    host = document.createElement("div");
    root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("changes during a slow read start no second read, then exactly one more", async () => {
    expect(reads).toBe(1);
    for (let i = 0; i < 20; i++) await act(async () => dirs.invalidate({ all: false, dirs: new Set([""]) }));
    expect(reads).toBe(1);
    await act(async () => pending.shift()!([entry("old")]));
    expect(reads).toBe(2);
    await act(async () => pending.shift()!([entry("new")]));
    expect(reads).toBe(2);
    expect(maxInFlight).toBe(1);
    expect(view.listings.get("")?.entries?.map((e) => e.name)).toEqual(["new"]);
  });
});

describe("useListings: another workspace", () => {
  it("a late answer from the previous workspace is dropped", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const answers: { scope: WorkspaceScope; resolve: (v: { entries: FsEntry[] }) => void }[] = [];
    const api = { fsDir: (scope: WorkspaceScope) => new Promise((resolve) => answers.push({ scope, resolve })) } as unknown as DaemonApi;
    const dirs = new DirVersions();
    const other = { kind: "session", id: "s2" } as WorkspaceScope;
    let view: ListingsView | undefined;
    function Probe({ scope, wanted }: { scope: WorkspaceScope; wanted: string[] }) {
      view = useListings(api, scope, dirs, wanted);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe, { scope: SCOPE, wanted: ["sub"] })));
    await act(async () => root.render(createElement(Probe, { scope: other, wanted: [""] })));
    await act(async () => answers[0]!.resolve({ entries: [entry("from-s1")] }));
    expect(view!.listings.get("sub")).toBeUndefined();
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

// 成果库 follows the focused conversation's project like the file tree / changes (owner 2026-10-23): binding
// `follow`, and a library stored with the old project binding (`workspace`) moves over on load.
import { describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import { rebindFollow } from "../src/renderer/src/lib/convShelves";
import { applyOpen, emptyLayout, place, placeSpec, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import type { ItemId } from "../src/renderer/src/modules/types";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {} }));
// The module graph is big: load it once at the top, not inside a test.
const artifactsModule = (await import("../src/renderer/src/modules/artifacts/index")).default as unknown as { contributes: { "side.component": { id: string; defaultBinding: string }[] } };

const LIBRARY = "artifacts.library";
const TERMINAL = "terminal.workspace";
const workspace = (key: string, hostId = "local"): SideBinding => ({ kind: "workspace", hostId, key });

let clock = 0;
function open(l: SideLayout, kind: string, binding: SideBinding): SideLayout {
  const input = { kind: kind as ItemId, binding, key: null, state: {} as never, v: 1, pinned: true };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "artifacts" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "artifacts" }).layout;
}

describe("成果库 follows the conversation's project", () => {
  it("the library registers with the follow binding", () => {
    expect(artifactsModule.contributes["side.component"].find((c) => c.id === LIBRARY)?.defaultBinding).toBe("follow");
  });

  it("rebindFollow moves a stored project-bound library to follow on the conversation's host; other project-bound kinds stay; idempotent", () => {
    let l = open(emptyLayout(), LIBRARY, workspace("local|proj-a", "remote"));
    l = open(l, TERMINAL, workspace("local|proj-a"));
    const follows = (kind: string) => kind === LIBRARY;
    const once = rebindFollow(l, "local", follows);
    expect(once.count).toBe(1);
    const inst = (kind: string) => Object.values(once.layout.instances).find((i) => i.kind === kind)!;
    expect(inst(LIBRARY).binding).toEqual({ kind: "follow", hostId: "local" });
    expect(inst(TERMINAL).binding).toEqual(workspace("local|proj-a"));
    const twice = rebindFollow(once.layout, "local", follows);
    expect(twice.count).toBe(0);
    expect(twice.layout).toBe(once.layout);
    // Without the predicate (registry not up yet) nothing project-bound changes.
    expect(rebindFollow(l, "local").count).toBe(0);
  });
});

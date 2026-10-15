import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSlotEntry, CutexRef } from "../src/renderer/src/modules/slots";

const data = vi.hoisted(() => ({ entries: [] as AppSlotEntry<"ref.action">[], unsupported: new Set<string>(), gatedHost: null as string | null | undefined }));
// Per-host gating (lib/hostGatingView): modules listed in `unsupported` lack their capabilities on the ref's host.
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ useHostEntryGate: (hostId: string | null | undefined) => { data.gatedHost = hostId; return (e: { moduleId: string }) => !data.unsupported.has(e.moduleId); } }));
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => data.entries }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/refActions", () => ({ refActionEntries: () => [], useHasRefActions: () => false }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ notify: vi.fn() }) } }));
import { RefActionButtons } from "../src/renderer/src/components/RefActions";

const ref: CutexRef = { hostId: "local", kind: "turn", key: "s:t", title: "turn", params: { sessionId: "s", turnId: "t" } };
function action(id: string, kinds?: string[], state?: { active?: boolean; titleKey?: string; disabledReason?: string }, moduleId = "test") {
  return { mode: "show", moduleId, item: { id, titleKey: id, kinds, icon: ({ className }: { className?: string }) => createElement("svg", { className }), useState: () => state, run: vi.fn() } } as unknown as AppSlotEntry<"ref.action">;
}
const render = () => renderToStaticMarkup(createElement(RefActionButtons, { kind: "turn", build: () => ref }));
beforeEach(() => { data.entries = []; data.unsupported = new Set(); data.gatedHost = null; });
describe("inline module reference actions", () => {
  it("renders the same contract directly beside Quote without module-specific branches", () => {
    data.entries = [action("notes.add", ["turn"]), action("bookmarks.toggle"), action("side-chat.fromTurn", ["turn"]), action("other", ["agent"])];
    const html = render();
    for (const id of ["notes.add", "bookmarks.toggle", "side-chat.fromTurn"]) expect(html).toContain(`aria-label="${id}"`);
    expect(html).not.toContain('aria-label="other"');
    expect(html).not.toContain('aria-haspopup="menu"');
  });
  it("shows a pressed filled bookmark and a disabled explanation for unavailable actions", () => {
    data.entries = [action("bookmarks.toggle", undefined, { active: true, titleKey: "bookmarks.active" }), action("side-chat.fromTurn", ["turn"], { disabledReason: "Wake this agent first" })];
    const html = render();
    expect(html).toContain('aria-pressed="true"'); expect(html).toContain("fill-current");
    expect(html).toContain('aria-label="bookmarks.active"'); expect(html).toContain('disabled=""');
    expect(html).toContain("Wake this agent first");
  });
  it("does not render inactive module actions or unresolved references", () => {
    data.entries = [{ ...action("hidden"), mode: "hide" } as unknown as AppSlotEntry<"ref.action">];
    expect(render()).toBe("");
    data.entries = [action("visible")];
    expect(renderToStaticMarkup(createElement(RefActionButtons, { kind: "turn", build: () => null }))).toBe("");
  });
  it("leaves out actions whose module the ref's host lacks (an older cutex)", () => {
    data.entries = [action("notes.add", ["turn"], undefined, "notes"), action("bookmarks.toggle", undefined, undefined, "bookmarks")];
    data.unsupported = new Set(["notes"]);
    const html = render();
    expect(data.gatedHost).toBe("local");
    expect(html).not.toContain('aria-label="notes.add"');
    expect(html).toContain('aria-label="bookmarks.toggle"');
  });
});

// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentMentionMarkdown } from "../src/renderer/src/lib/agentMentions";

const mocks = vi.hoisted(() => ({ state: { entries: new Map() } as { entries: Map<string, any>; openAgent?: (...args: unknown[]) => void }, open: vi.fn(), copy: vi.fn(), menu: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (state: typeof mocks.state) => unknown) => select(mocks.state), { getState: () => mocks.state }) }));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentIndex: (state: typeof mocks.state) => state.entries }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuFrom: mocks.menu }));
vi.mock("../src/renderer/src/lib/menus", () => ({ copyText: mocks.copy }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() }, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/components/CutexLink", () => ({ CutexLink: ({ children }: { children: unknown }) => h("span", null, children as string), CutexImage: () => null }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: (props: { seed: string; name: string; status: { presence: string } }) => h("span", { "data-avatar": props.seed, "data-presence": props.status.presence, "aria-hidden": true }) }));
const { AgentMentionChip } = await import("../src/renderer/src/components/AgentMentionChip");
const { Markdown } = await import("../src/renderer/src/components/Markdown");
const id = "cutex.00000000-0000-4000-8000-000000000001";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.state = { entries: new Map([[id, { hostId: "other-host", session: { displayName: "Current name", formalAgentName: "Original", runtime: { status: "online" }, avatar: { type: "emoji", value: "🦊" } } }]]), openAgent: mocks.open };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); });
const draw = (interactive = true) => act(() => root.render(h(AgentMentionChip, { id, name: "Old name", interactive })));
function copySelection(range: Range, target: HTMLElement = host) {
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const setData = vi.fn();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { setData } });
  target.dispatchEvent(event);
  return { event, setData };
}

describe("AgentMentionChip rendering and gestures", () => {
  it("uses current names, avatar and status, and opens the exact host", () => {
    draw();
    expect(host.textContent).toBe("@Current name");
    expect(host.querySelector("[data-avatar]")?.getAttribute("data-avatar")).toBe(id);
    expect(host.querySelector("[data-presence]")?.getAttribute("data-presence")).toBe("online");
    act(() => (host.querySelector('[role="link"]') as HTMLElement).click());
    expect(mocks.open).toHaveBeenCalledWith(id, "other-host");
    act(() => host.querySelector('[role="link"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(host.querySelector("a[href]")).toBeNull();
  });
  it("rechecks the host on click and does not navigate after removal", () => {
    draw();
    mocks.state.entries = new Map([[id, { ...mocks.state.entries.get(id), hostId: "new-host" }]]);
    act(() => (host.firstChild as HTMLElement).click());
    expect(mocks.open).toHaveBeenCalledWith(id, "new-host");
    mocks.state.entries = new Map();
    act(() => (host.firstChild as HTMLElement).click());
    expect(mocks.open).toHaveBeenCalledTimes(1);
    draw();
    expect(host.textContent).toBe("@Old name");
    expect(host.querySelector('[role="link"]')).toBeNull();
  });
  it("keeps noninteractive composer chips inert, including context menus", () => {
    draw(false);
    act(() => (host.firstChild as HTMLElement).click());
    act(() => host.firstChild!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.menu).not.toHaveBeenCalled();
    expect(host.querySelector("[tabindex]")).toBeNull();
  });
  it("copies a canonical mention via its menu", () => {
    draw();
    act(() => host.firstChild!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const entry = mocks.menu.mock.calls[0]![1][0];
    expect(entry.label).toBe("composer.mention.copy"); entry.onSelect();
    expect(mocks.copy).toHaveBeenCalledWith(agentMentionMarkdown("Current name", id));
  });
  it("preserves selected mention wire links and surrounding formatting", () => {
    act(() => root.render(h("p", null, h("strong", null, "Before "), h(AgentMentionChip, { id, name: "Old" }), " after")));
    const range = document.createRange(); range.selectNodeContents(host);
    const { event, setData } = copySelection(range);
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", `Before ${agentMentionMarkdown("Current name", id)} after`);
    expect(setData.mock.calls.find(call => call[0] === "text/html")![1]).toContain("<strong>Before </strong>");
  });
  it("does not hijack partial labels, normal text or an editor-owned copy", () => {
    draw();
    const label = host.querySelector("[data-agent-mention] > span:last-child")!.lastChild!;
    const partial = document.createRange(); partial.setStart(label, 1); partial.setEnd(label, 4);
    expect(copySelection(partial).event.defaultPrevented).toBe(false);
    host.setAttribute("contenteditable", "true");
    const range = document.createRange(); range.selectNodeContents(host);
    expect(copySelection(range).event.defaultPrevented).toBe(false);
    host.removeAttribute("contenteditable");
    const stop = (event: Event) => event.preventDefault(); host.addEventListener("copy", stop);
    expect(copySelection(range).setData).not.toHaveBeenCalled(); host.removeEventListener("copy", stop);
  });
  it("does not put selected chrome back into mention clipboard serialization", () => {
    act(() => root.render(h("div", null, "Body ", h(AgentMentionChip, { id, name: "Old" }),
      h("button", null, "COLLAPSE_CHROME"),
      h("div", { "data-streamdown": "code-block-header" }, "LANGUAGE_CHROME"), h("code", null, "copy_command"))));
    const range = document.createRange(); range.selectNodeContents(host);
    const { setData } = copySelection(range);
    const plain = setData.mock.calls.find(call => call[0] === "text/plain")![1];
    const html = setData.mock.calls.find(call => call[0] === "text/html")![1];
    expect(plain).toContain(agentMentionMarkdown("Current name", id));
    expect(plain).toContain("copy_command");
    expect(plain + html).not.toContain("CHROME");
  });
  it("copies the complete label without needing its outer wrapper selected", () => {
    draw();
    const range = document.createRange(); range.selectNodeContents(host.querySelector("[data-agent-mention-name]")!);
    expect(copySelection(range).setData).toHaveBeenCalledWith("text/plain", agentMentionMarkdown("Current name", id));
  });
  it("renders real Markdown mention links through the chip, with literal escaped labels", async () => {
    await act(async () => root.render(h(Markdown, { text: `Hello ${agentMentionMarkdown("Old name", id)} and ${agentMentionMarkdown("Unknown ] *literal*", "cutex.ag-missing")}.` })));
    expect(host.querySelector(`[data-agent-mention="${id}"]`)?.textContent).toBe("@Current name");
    expect(host.querySelector('[data-agent-mention="cutex.ag-missing"]')?.textContent).toBe("@Unknown ] *literal*");
    expect(host.querySelector("a[href^='cutex:']")).toBeNull();
  });
  it("does not turn inline code or malformed agent identities into chips", async () => {
    await act(async () => root.render(h(Markdown, { text: `\`${agentMentionMarkdown("Current name", id)}\` and [@short](cutex:agent/short)` })));
    expect(host.querySelector("[data-agent-mention]")).toBeNull();
    expect(host.querySelector("code")?.textContent).toBe(agentMentionMarkdown("Current name", id));
    expect(host.textContent).toContain("@short");
  });
});

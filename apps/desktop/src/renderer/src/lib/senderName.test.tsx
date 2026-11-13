// @vitest-environment jsdom
// The sender of an agent message shows by the sidebar's name (the owner's label wins), for every surface the owner reads.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { BusMessage } from "../components/BusMessage";
import { useApp } from "../store";
import { nextPreview } from "./activity";
import { previewOfKept } from "./revertedPreview";
import { timelineToMarkdown } from "./transcript";
import { useSenderName } from "./viewHost";

vi.mock("../i18n", async (original) => ({ ...await original<object>(), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));

const SENDER = "cutex.00000000-0000-0000-0000-000000000001";
const FORMAL = "formal-sender";
const LABEL = "Owner label";
let root: Root | null = null;
let before: ReturnType<typeof useApp.getState>;

function row(extra: Record<string, unknown>) {
  return { cutexSessionId: SENDER, displayName: LABEL, displayNameOverride: LABEL, formalAgentName: FORMAL, ...extra };
}

function snapshot(session: unknown): never {
  return { active: [session], retired: [], hostRows: {}, projects: null } as never;
}

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  before = useApp.getState();
  useApp.setState({ sidebar: snapshot(row({})) });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  useApp.setState(before, true);
});

it("a local sender shows the label, with the formal name as its tooltip", () => {
  const host = render(h(BusMessage, { direction: "in", name: FORMAL, mode: null, text: "hi", senderId: SENDER, onContextMenu: () => {} }));
  const name = host.querySelector("[data-testid=bus-message-name]")!;
  expect(name.textContent).toBe(LABEL);
  // A clickable sender (a sidebar agent) adds its id on a second tooltip line.
  expect(name.getAttribute("title")?.split("\n")).toEqual([FORMAL, SENDER]);
});

it("the legacy prefix still comes off by the name the host reported", () => {
  const host = render(h(BusMessage, { direction: "in", name: FORMAL, mode: null, text: `[message from ${FORMAL}] hi`, senderId: SENDER, onContextMenu: () => {} }));
  expect(host.querySelector("[data-testid=bus-message-preview]")!.textContent).toContain("hi");
});

it("a sender the sidebar does not hold keeps the reported name; a service keeps its system name", () => {
  const Shown = ({ id }: { id: string | null }) => h("span", null, useSenderName(id, "reported").name);
  expect(render(h(Shown, { id: "peer@other-host" })).textContent).toBe("reported");
  const host = render(h(BusMessage, { direction: "in", name: "cutex-asks", mode: null, text: "x", senderId: "cutex-asks", onContextMenu: () => {} }));
  expect(host.querySelector("[data-testid=bus-message-name]")!.textContent).toBe("system.delegation");
});

it("a rename shows at once: the name is read from the row, never cached", () => {
  const host = render(h(BusMessage, { direction: "in", name: FORMAL, mode: null, text: "hi", senderId: SENDER, onContextMenu: () => {} }));
  act(() => useApp.setState({ sidebar: snapshot(row({ displayName: "renamed", displayNameOverride: null, formalAgentName: "renamed" })) }));
  const name = host.querySelector("[data-testid=bus-message-name]")!;
  expect(name.textContent).toBe("renamed");
  expect(name.getAttribute("title")?.split("\n")[0]).toBe("renamed");
});

it("the sidebar line, the reverted line and the export use the same name", () => {
  const shown = (id: string) => (id === SENDER ? LABEL : undefined);
  const received = { kind: "received", id: "e", message: { senderId: SENDER, senderName: FORMAL, sourceKind: null, text: "hi" } };
  const timeline = { turns: [{ id: "t1", entryIds: ["e"] }, { id: "t2", entryIds: [] }], entries: new Map([["e", received]]) };
  expect(previewOfKept(timeline as never, "t2", 1, undefined, shown).text).toBe(`${LABEL}: hi`);
  expect(previewOfKept(timeline as never, "t2", 1).text).toBe(`${FORMAL}: hi`);
  const item = { type: "functionCallOutput", name: "external_event", id: "i", output: JSON.stringify({ source: { id: SENDER, kind: "agent" }, text: "hi" }) };
  const envelope = { cutexSessionId: "cutex.r", receivedAt: "2026-11-07T00:00:00Z", native: { kind: "notification", message: { method: "item/completed", params: { item } } } };
  expect(nextPreview(undefined, envelope as unknown as EventEnvelope, shown)?.text).toBe(`${LABEL}: hi`);
  const md = timelineToMarkdown("t", [received as never], { user: "u", assistant: "a", from: (n, s) => `from ${s?.id === SENDER ? LABEL : n}`, to: (n) => n, review: "r", reviewTarget: "rt", plan: "p" });
  expect(md).toContain(`from ${LABEL}`);
});

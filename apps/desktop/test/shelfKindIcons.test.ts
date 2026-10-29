// Shelf kind icons (owner-approved 2026-10-24, .claude/previews/preview-shelf-icons.html): the kinds whose icon
// looked like another's get their own. Rail, ＋ launcher, pane header, ⌘K and the empty-page tiles read item.icon.
import { describe, expect, it, vi } from "vitest";
import { Bot, BotMessageSquare, FileBox, Globe, Library, Server, SquareTerminal, Terminal } from "lucide-react";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { MODULES } = await import("../src/renderer/src/modules/registry");

function icon(slot: string, id: string): unknown {
  for (const m of MODULES) {
    const entries = (m.contributes as Record<string, { id: string; icon?: unknown; target?: { page?: string } }[] | undefined>)[slot] ?? [];
    const hit = entries.find((e) => e.id === id || e.target?.page === id);
    if (hit) return hit.icon;
  }
  throw new Error(`${slot} ${id} not found`);
}

describe("Shelf kind icons", () => {
  it("each pair the proposal flagged now differs", () => {
    expect(icon("side.component", "subagents.thread")).toBe(BotMessageSquare);
    expect(icon("conversation.status", "subagents.status")).toBe(Bot);
    expect(icon("conversation.status", "background-terminals.status")).toBe(Terminal);
    expect(icon("conversation.status", "background-terminals.status")).not.toBe(SquareTerminal);
    expect(icon("side.component", "artifacts.view")).toBe(FileBox);
    expect(icon("side.component", "artifacts.library")).toBe(Library);
    expect(icon("nav.primary", "services.page")).toBe(Server);
    expect(icon("nav.primary", "services.page")).not.toBe(Globe);
  });
});

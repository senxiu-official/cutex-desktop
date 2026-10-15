import { describe, expect, it } from "vitest";
import { conversationEscDecision, ESC_CONFIRM_MS, type ConversationEscContext, type ConversationEscEvent } from "../src/renderer/src/lib/escInterrupt";

const ESC: ConversationEscEvent = { key: "Escape", ctrl: false, shift: false, alt: false, meta: false, repeat: false, composing: false, defaultPrevented: false };
const NOW = 1_000_000;
const ctx = (over: Partial<ConversationEscContext> = {}): ConversationEscContext => ({
  preset: "queueFirst",
  turnId: "turn-1",
  blocked: false,
  editableFocus: false,
  textSelection: false,
  pendingSteers: 0,
  delegation: false,
  armed: null,
  now: NOW,
  ...over,
});

describe("conversationEscDecision", () => {
  it("interrupts a running turn with one Esc", () => {
    expect(conversationEscDecision(ESC, ctx())).toEqual({ kind: "act", action: "interrupt", turnId: "turn-1" });
  });

  it("never interrupts from the right side / a gutter, nor while a right-side layer is in front", () => {
    expect(conversationEscDecision(ESC, ctx({ inSide: true }))).toEqual({ kind: "ignore" });
    expect(conversationEscDecision(ESC, ctx({ sideLayers: true }))).toEqual({ kind: "ignore" });
    // not even the selection-clearing branch: the side owns that Esc
    expect(conversationEscDecision(ESC, ctx({ inSide: true, textSelection: true }))).toEqual({ kind: "ignore" });
    expect(conversationEscDecision(ESC, ctx({ inSide: false, sideLayers: false }))).toMatchObject({ kind: "act" });
  });

  it("does nothing when idle", () => {
    expect(conversationEscDecision(ESC, ctx({ turnId: null }))).toEqual({ kind: "ignore" });
  });

  it("leaves Esc to open popups, editable focus, other keys, modifiers, repeats, IME and consumed events", () => {
    for (const c of [ctx({ blocked: true }), ctx({ editableFocus: true })]) expect(conversationEscDecision(ESC, c).kind).toBe("ignore");
    for (const e of [
      { ...ESC, key: "Enter" },
      { ...ESC, ctrl: true },
      { ...ESC, shift: true },
      { ...ESC, alt: true },
      { ...ESC, meta: true },
      { ...ESC, repeat: true },
      { ...ESC, composing: true },
      { ...ESC, defaultPrevented: true },
    ])
      expect(conversationEscDecision(e, ctx()).kind).toBe("ignore");
  });

  it("only clears a text selection", () => {
    expect(conversationEscDecision(ESC, ctx({ textSelection: true }))).toEqual({ kind: "clearSelection" });
    expect(conversationEscDecision(ESC, ctx({ textSelection: true, turnId: null })).kind).toBe("ignore");
  });

  it("cli preset with unread steers interrupts and sends them (like the composer)", () => {
    expect(conversationEscDecision(ESC, ctx({ preset: "cli", pendingSteers: 2 }))).toMatchObject({ action: "interruptSendSteers" });
    expect(conversationEscDecision(ESC, ctx({ preset: "queueFirst", pendingSteers: 2 }))).toMatchObject({ action: "interrupt" });
    expect(conversationEscDecision(ESC, ctx({ preset: "cli", pendingSteers: 0 }))).toMatchObject({ action: "interrupt" });
  });

  it("a delegation turn needs a second Esc on the same turn within the window", () => {
    expect(conversationEscDecision(ESC, ctx({ delegation: true }))).toEqual({ kind: "arm", turnId: "turn-1" });
    expect(conversationEscDecision(ESC, ctx({ delegation: true, armed: { turnId: "turn-1", at: NOW - 500 } }))).toEqual({ kind: "act", action: "interrupt", turnId: "turn-1" });
    expect(conversationEscDecision(ESC, ctx({ delegation: true, armed: { turnId: "turn-1", at: NOW - ESC_CONFIRM_MS } })).kind).toBe("act");
    // Too late, or armed for another turn: arm again.
    expect(conversationEscDecision(ESC, ctx({ delegation: true, armed: { turnId: "turn-1", at: NOW - ESC_CONFIRM_MS - 1 } })).kind).toBe("arm");
    expect(conversationEscDecision(ESC, ctx({ delegation: true, armed: { turnId: "turn-0", at: NOW - 100 } })).kind).toBe("arm");
  });
});

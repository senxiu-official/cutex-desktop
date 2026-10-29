// @vitest-environment jsdom
// 取消发送 (real cancel through cutex's stuck-message discard) and 隐藏 / 清除 (this desktop only, with undo).
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StuckBusMessage } from "../src/shared/ipc";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "zh-CN" }),
  translate: (key: string) => key,
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { cancelableTo, matchCancelable } = await import("../src/renderer/src/lib/cancelSend");
const { hiddenKey, resetHiddenRowsForTest, useHiddenRows, visibleRows } = await import("../src/renderer/src/lib/hiddenRows");
const { CancelSendButton } = await import("../src/renderer/src/components/CancelSendButton");
const { HiddenUndo } = await import("../src/renderer/src/components/HiddenUndo");

const msg = (over: Partial<StuckBusMessage>): StuckBusMessage => ({
  messageId: "m1",
  state: "pending",
  durable: true,
  to: { id: "ui", name: "ui-widgets" },
  from: { id: "chief", name: "chief" },
  ageSecs: 700,
  createdAtEpochSecs: null,
  senderKind: null,
  protectedControl: false,
  nativeSubmissionPresent: false,
  semanticSha256: null,
  errorCode: null,
  errorMessage: null,
  reasons: [],
  contentPreview: "You are ui-widgets, the desktop-widget designer",
  ...over,
});

describe("which stuck messages can be cancelled", () => {
  it("never routes an outcome_unknown settlement through legacy discard, even on a pending/stale-held row", () => {
    const settlement = settlementFixture();
    const ordinary = msg({ messageId: "ordinary" });
    const candidates = cancelableTo([ordinary, msg({ messageId: "unknown-pending", settlement }), msg({ messageId: "unknown-held", state: "stale_held", settlement })], "ui");
    expect(candidates).toEqual([ordinary]);
  });
  it("only pending / stale_held ones to this agent, oldest first; an inbox_accepted one never", () => {
    const list = [msg({ messageId: "a", ageSecs: 100 }), msg({ messageId: "b", ageSecs: 900, state: "stale_held" }), msg({ messageId: "c", state: "inbox_accepted" }), msg({ messageId: "d", to: { id: "other", name: null } })];
    expect(cancelableTo(list, "ui").map((m) => m.messageId)).toEqual(["b", "a"]);
  });
  it("a row is matched by sender, then by its text; ambiguous = no button", () => {
    const a = msg({ messageId: "a", contentPreview: "first task" });
    const b = msg({ messageId: "b", contentPreview: "second task" });
    expect(matchCancelable([a], { from: "chief", text: "whatever" })?.messageId).toBe("a");
    expect(matchCancelable([a, b], { fromId: "chief", text: "second task for you" })?.messageId).toBe("b");
    expect(matchCancelable([a, b], { fromId: "chief", text: "unrelated" })).toBeNull();
    expect(matchCancelable([a], { fromId: "someone-else" })).toBeNull();
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  resetHiddenRowsForTest();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("取消发送 asks twice before it cancels", () => {
  it("the first click arms, the second calls cancel; a refusal is shown", async () => {
    const onCancel = vi.fn().mockResolvedValueOnce({ ok: false, error: "message_protected: x" });
    act(() => root.render(h(CancelSendButton, { onCancel })));
    act(() => host.querySelector<HTMLElement>("[data-testid=cancel-send]")!.click());
    expect(onCancel).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLElement>("[data-testid=cancel-send-confirm]")!.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-testid=cancel-send-error]")?.getAttribute("title")).toContain("message_protected");
  });
});

describe("隐藏 / 清除: this desktop only, one batch undone", () => {
  it("hides rows, never twice, and undo brings the last batch back", () => {
    const rows = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const keyOf = (r: { id: string }) => hiddenKey("ask", "local", r.id);
    act(() => useHiddenRows.getState().hide([keyOf(rows[0]!), keyOf(rows[1]!)], "asks:local"));
    expect(visibleRows(rows, keyOf, useHiddenRows.getState().keys)).toEqual([rows[2]]);
    act(() => useHiddenRows.getState().hide([keyOf(rows[2]!)], "asks:local"));
    act(() => useHiddenRows.getState().undo());
    expect(visibleRows(rows, keyOf, useHiddenRows.getState().keys)).toEqual([rows[2]]);
    expect(JSON.parse(localStorage.getItem("cutex-desktop.hiddenRows")!)).toHaveLength(2);
  });
  it("the undo line offers 撤销", () => {
    act(() => useHiddenRows.getState().hide([hiddenKey("note", "local", "m")], "notes:local"));
    act(() => root.render(h(HiddenUndo, { scope: "notes:local", n: 1 })));
    act(() => host.querySelector<HTMLElement>("[data-testid=hidden-undo-button]")!.click());
    expect(useHiddenRows.getState().keys).toEqual([]);
  });
});

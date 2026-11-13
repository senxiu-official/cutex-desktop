// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { useDebug, captureDebugError, receiveDebugError } from "../src/renderer/src/lib/debugState";
import { queueActionNotice } from "../src/renderer/src/lib/queueSteer";
import { sideErrorText } from "../src/renderer/src/modules/side-chat/errors";
const initial = useDebug.getState();
afterEach(() => useDebug.setState(initial));
it("preserves today's friendly messages while off and exposes the original message while on", () => {
  expect(queueActionNotice(new Error("bad_request: invalid text"), () => "friendly")).toBe("friendly");
  expect(sideErrorText("side_chat_invalid_message: empty", () => "friendly")).toBe("friendly");
  captureDebugError(new Error("invalid text"), "api.send");
  expect(useDebug.getState().errors).toEqual([]);
  useDebug.setState(s => ({ state: { ...s.state, enabled: true } }));
  // A queue action's notice stays plain (owner 2026-11-13); the original goes to the debug error list instead.
  expect(queueActionNotice(new Error("bad_request: invalid text"), () => "friendly")).toBe("friendly");
  expect(useDebug.getState().errors.at(-1)).toMatchObject({ source: "renderer.queueAction" });
  expect(sideErrorText("side_chat_invalid_message: empty", () => "friendly")).toBe("side_chat_invalid_message: empty");
});
it("keeps the richest code/source rather than three copies of the same IPC error", () => {
  useDebug.setState(s => ({ state: { ...s.state, enabled: true } }));
  receiveDebugError({ time: 100, kind: "error", source: "invoke.sideChatSend", code: "invalid_text", message: "invalid text" });
  receiveDebugError({ time: 110, kind: "error", source: "api.sideChatSend", message: "Error invoking remote method 'invoke': Error: invalid text" });
  expect(useDebug.getState().errors).toHaveLength(1);
  expect(useDebug.getState().errors[0]!.code).toBe("invalid_text");
});

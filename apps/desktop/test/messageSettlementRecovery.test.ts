import { afterEach, expect, it, vi } from "vitest";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";

const env = vi.hoisted(() => ({ close: vi.fn(), list: vi.fn(), bootstrap: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: () => ({ closeBusMessage: env.close, stuckBusMessages: env.list, bootstrap: env.bootstrap }), bridge: {} }));
vi.mock("../src/renderer/src/store", () => ({ featuresOf: () => new Set(["agent-bus-message-settlement-v1"]), useApp: { getState: () => ({ refreshAdmission: async () => {} }) } }));
afterEach(() => { vi.unstubAllGlobals(); });

it("restores the immutable intent after renderer restart and requires explicit read before retrying its original key", async () => {
  vi.resetModules();
  const request = { messageId: "message", expectedEvidenceToken: "original-proof", requestId: "original-request", reason: "original owner reason" };
  const stored = new Map([["cutex-desktop.messageSettlementIntents.v1", JSON.stringify({ [JSON.stringify(["host", "message"])]: request })]]);
  vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, value: string) => stored.set(k, value) });
  const current = { ...settlementFixture(), evidenceToken: "newer-proof" };
  env.list.mockResolvedValue({ messages: [{ messageId: "message", settlement: current }] });
  env.bootstrap.mockResolvedValue({ cutexState: { agentBusMessages: [{ messageId: "message", settlement: current }] } });
  env.close.mockResolvedValue({ ok: true, result: { messageId: "message", changed: false, settlement: { ...current, state: "closed", canClose: false, closure: { actor: "owner", closedAt: new Date().toISOString(), reason: request.reason, requestId: request.requestId } } } });
  const writes = await import("../src/renderer/src/lib/messageSettlementWrites");
  expect(env.close).not.toHaveBeenCalled();
  await writes.closeMessageFollowUp("host", "message", current, "changed reason", "recipient");
  expect(env.close).not.toHaveBeenCalled();
  await writes.recheckSettlement("host", "message", "recipient");
  expect(env.close).not.toHaveBeenCalled();
  await writes.closeMessageFollowUp("host", "message", current, "changed reason", "recipient");
  expect(env.close).toHaveBeenCalledExactlyOnceWith(request);
  expect(JSON.parse(stored.get("cutex-desktop.messageSettlementIntents.v1")!)).toEqual({});
});

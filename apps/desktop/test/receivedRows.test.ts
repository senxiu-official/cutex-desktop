import { describe, expect, it } from "vitest";
import { receivedRendererFor } from "../src/renderer/src/lib/receivedRows";
import { parseExternalInput, type ExternalMessage } from "../src/renderer/src/lib/timeline";
import type { AppSlotEntry, ReceivedRenderer } from "../src/renderer/src/modules/slots";

const msg = (schema: string | null): ExternalMessage => ({ senderId: "x", senderName: "Eva", deliveryMode: null, text: "Never drop this message", schema, data: {}, eventType: null, sourceKind: null });
const renderer = (id: `${string}.${string}`, schemas: readonly string[], extra: Partial<ReceivedRenderer> = {}): AppSlotEntry<"timeline.received"> => ({ moduleId: id, item: { id, schemas, Row: () => null, ...extra }, mode: "show", waiting: false, missing: [] });
const entries = [renderer("task.received", ["cutex.task-assignment.v1", "cutex.task-followup.v1"]), renderer("delegations.ask", ["cutex.delegation-ask.v1"]), renderer("delegations.results", ["cutex.delegation-results.v1"])];

describe("receivedRendererFor", () => {
  it("dispatches solely through registered schemas, including more than one schema per renderer", () => {
    expect(receivedRendererFor(msg("cutex.task-assignment.v1"), entries)?.item.id).toBe("task.received");
    expect(receivedRendererFor(msg("cutex.task-followup.v1"), entries)?.item.id).toBe("task.received");
    expect(receivedRendererFor(msg("cutex.delegation-ask.v1"), entries)?.item.id).toBe("delegations.ask");
    expect(receivedRendererFor(msg("cutex.delegation-results.v1"), entries)?.item.id).toBe("delegations.results");
  });

  it("requests core fallback for ordinary, missing, unknown-version and prototype schemas", () => {
    for (const schema of ["cutex.agent-message.v1", null, "", "cutex.delegation-ask.v2", "constructor"]) expect(receivedRendererFor(msg(schema), entries)).toBeUndefined();
    expect(receivedRendererFor(msg("cutex.delegation-ask.v1"), [])).toBeUndefined();
  });

  it("a disabled/noticed item or an agent that explicitly lacks its feature uses core fallback", () => {
    const row = renderer("plan.received", ["future.plan.v1"], { agentFeature: "planMode" });
    expect(receivedRendererFor(msg("future.plan.v1"), [row])?.item.id).toBe(row.item.id);
    expect(receivedRendererFor(msg("future.plan.v1"), [row], { runtime: "claude", map: { planMode: false } })).toBeUndefined();
    expect(receivedRendererFor(msg("future.plan.v1"), [row], { runtime: "claude", map: null })?.item.id).toBe(row.item.id);
    for (const mode of ["disable", "notice"] as const) expect(receivedRendererFor(msg("future.plan.v1"), [{ ...row, mode }])).toBeUndefined();
  });

  it("dispatches parsed external_event items by their view schema, not event type", () => {
    const message = parseExternalInput({ type: "functionCallOutput", id: "x1", name: "external_event", namespace: "external", output: JSON.stringify({ source: { kind: "agent", id: "lead" }, type: "MESSAGE", text: "Payload:\nhi" }), externalInputView: { schema: "cutex.delegation-ask.v1", data: { senderId: "lead", senderName: "Lead" } } })!;
    expect(receivedRendererFor(message, entries)?.item.id).toBe("delegations.ask");
  });
});

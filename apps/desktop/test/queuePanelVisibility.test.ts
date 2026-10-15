// Queue card visibility / compact rules (flicker + reachability, 2026-10-15).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdmissionNextStep, QueueItem } from "@cutex-desktop/protocol";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.n !== undefined ? `${key}(${vars.n})` : key) }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign(() => false, { getState: () => ({}) }), selectedFeatures: () => new Set(), agentHost: () => "local", queueItemText: (item: QueueItem) => (item.input as { text: string }[]).map((p) => p.text).join("") }));
import { QueuePanel } from "../src/renderer/src/components/QueuePanel";
import { newOutboxEntry, failOutbox } from "../src/renderer/src/lib/outbox";

const at = "2026-10-12T00:00:00Z";
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `msg-${queueId}` }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });

type Extra = Partial<Parameters<typeof QueuePanel>[0]>;
function render(extra: Extra) {
  return renderToStaticMarkup(
    createElement(QueuePanel, {
      steers: [],
      outbox: { onRetry() {}, onEdit() {}, onDiscard() {} },
      onInterruptSendSteers() {},
      onDismissSteer() {},
      paused: { steers: [], items: [], count: 0 },
      onResumePaused() {},
      onRestorePaused() {},
      onClearPaused() {},
      items: [],
      canEdit: true,
      onEdit() {},
      onDelete() {},
      ...extra,
    }),
  );
}
const steer = newOutboxEntry(null, { id: "st1", text: "steer me", strategy: "auto", placement: "steer" });

describe("queue card: settling ride-alongs", () => {
  it("an idle agent's ride-along still settling shows no card at all (no empty 「接下来 · 1」 flash)", () => {
    const fresh = [{ id: "fresh", deliveryKind: "alarm", label: "wake up", enqueuedAt: new Date().toISOString(), timing: "afterTurn" }] as AdmissionNextStep[];
    const ordered = { turns: [], nextStep: fresh, running: false, runningSince: null, currentTurn: null, mayPass: true, onMove() {}, sessionId: "agent-x" };
    expect(render({ ordered })).toBe("");
    // While a turn runs it is listed at once.
    expect(render({ ordered: { ...ordered, running: true, currentTurn: { kind: "owner" } } })).toContain("wake up");
  });
});

describe("queue card: auto-compact", () => {
  const twoKinds: Extra = { items: [queued("A")], sendingSteers: [steer], autoCompact: { short: false } };
  it("starts compact for a known agent with more than one kind waiting", () => {
    expect(render({ ...twoKinds, sessionId: "agent-c1" })).toContain('data-compact="true"');
  });
  it("never compact without an agent id (its expand could not be remembered: rows unreachable)", () => {
    const html = render(twoKinds);
    expect(html).not.toContain('data-compact="true"');
    expect(html).toContain("msg-A");
  });
  it("never compact while a send failed: its error and retry / back / discard stay visible", () => {
    const failed = failOutbox([steer], "st1", "boom");
    const html = render({ ...twoKinds, sendingSteers: failed, sessionId: "agent-c2" });
    expect(html).not.toContain('data-compact="true"');
    expect(html).toContain('data-testid="outbox-failed"');
    expect(html).toContain("outbox.retry");
  });
});

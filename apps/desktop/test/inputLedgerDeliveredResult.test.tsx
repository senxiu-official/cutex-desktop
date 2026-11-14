// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { InputRecord } from "@cutex-desktop/protocol";
import { capturedOperations, parseCapturedTrace } from "../src/renderer/src/lib/inputLedger/capturedTraces";
import captured from "./fixtures/inputLedgerDeliveredResult.json";

const fx = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  received: [] as unknown[],
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentHost: () => "local",
  selectedSidebar: () => null,
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({ ...(await importOriginal<object>()), useHostOwnerNotes: () => ({}) }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: (slot: string) => slot === "timeline.received" ? fx.received : [],
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { ResultsReceivedRow } = await import("../src/renderer/src/modules/conversation/TimelineRows");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { record, delivery } = await import("../src/renderer/src/lib/inputLedger/testkit");
const { applyInputLedgerSnapshot, emptyInputLedgerSession } = await import("../src/renderer/src/lib/inputLedger/alignment");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");

const SID = "s1";
const key = viewKey("local", SID);
type Sample = typeof captured.cases[number];

// Derived captured samples, NOT immutable captures: the null links are filled with the
// observed native item.id for the r274.1 expected contract. Bodies/labels are neutral.
function records(samples: Sample[], linked = true) {
  return samples.map(sample => record(sample.record.inputId, {
    ...sample.record as Partial<InputRecord>,
    sender: { kind: "agent", id: "worker", name: "Worker", host: null, cutexSessionId: null },
    timelineItemId: linked ? sample.record.timelineItemId : null,
  }));
}

function setLedger(samples: Sample[], linked = true) {
  fx.state.inputs = { [key]: applyInputLedgerSnapshot(emptyInputLedgerSession(), {
    ledgerEpoch: "e", stateRevision: 1, records: records(samples, linked),
    delivery: delivery("idle", 1), coverage: { kind: "full" },
  }).session };
}

function history(samples: Sample[]) {
  return timelineFromThreadRead({ thread: { id: "thread-s1", turns: samples.map(sample => ({
    id: sample.record.turnId, status: "completed", items: [sample.native],
  })) } } as never);
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fx.state = {
    selectedId: SID, selectedHost: null, hosts: null, sessions: {}, backgroundItems: {},
    outbox: {}, ledgerOutbox: {}, ledgerOwnerDrafts: {}, byHost: {},
    features: new Set(["input-ledger-v1"]),
  };
  // Exercise the real schema-selected delegation result row, not a mocked received row.
  fx.received = [{ moduleId: "conversation", mode: "show", item: {
    id: "conversation.delegationResults", schemas: ["cutex.delegation-results.v1"], Row: ResultsReceivedRow,
  } }];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function show(samples: Sample[]) {
  const timeline = history(samples);
  for (const sample of samples) {
    expect(timeline.entries.get(sample.native.id)).toMatchObject({
      kind: "received", id: sample.native.id, turnId: sample.record.turnId,
      message: { schema: "cutex.delegation-results.v1", data: sample.native.externalInputView.data },
    });
  }
  await act(async () => root.render(h(TimelineBody, {
    timeline, entries: orderedEntries(timeline), sessionId: SID, nameOf: (id: string) => id, pendingSends: true,
  })));
}

function fallback(sample: Sample) {
  // InputStatus also has data-input-id; restrict this to the actual preview wrapper.
  return host.querySelector(`div[data-input-id="${sample.record.inputId}"]`);
}

function assertNativeOnce(sample: Sample) {
  expect(sample.record.timelineItemId).toBe(sample.native.id);
  const excerpt = sample.native.externalInputView.data.items[0]!.preview;
  const rows = [...host.querySelectorAll('[data-tl-row]')].filter(row => row.textContent?.includes(excerpt));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent?.split(excerpt)).toHaveLength(2);
  expect(rows[0]!.textContent).toContain("delegation.resultFrom");
  const status = rows[0]!.querySelector(`[data-testid="input-status"][data-input-id="${sample.record.inputId}"]`);
  expect(status?.getAttribute("data-state")).toBe("inContext");
  expect(host.querySelectorAll(`[data-testid="input-status"][data-input-id="${sample.record.inputId}"]`)).toHaveLength(1);
}

describe("captured delivered delegation results (r274.1 expected link contract)", () => {
  it.each(["codex", "claude"])("current %s raw dlv binding joins a synthetic native received item once", async runtime => {
    const raw = readFileSync(resolve("src/renderer/src/dev/inputLedgerFixtures/r4-final-8be40c64", `s18-${runtime}.jsonl`), "utf8");
    const actual = capturedOperations(parseCapturedTrace(raw)).flatMap(op =>
      op.type === "event" && op.method === "cutex/input/stateChanged" ? [op.params.record as InputRecord] : [])
      .find(item => item.kind === "delegationResult" && item.state === "inContext" && item.timelineItemId !== null)!;
    expect(actual).toBeDefined();
    expect(actual.inputId).toMatch(/^dlv-/);
    expect(actual.timelineItemId).toMatch(/^cutex-ask-event-/);
    // The raw ledger supplies the binding unchanged. Native history below is explicitly
    // synthetic schema-shaped input: this does not claim independent provider evidence.
    const sample = structuredClone(captured.cases[0]!) as Sample;
    expect(actual.turnId).toEqual(expect.any(String));
    expect(actual.preview).toEqual(expect.any(String));
    sample.record = {
      inputId: actual.inputId, kind: actual.kind, state: actual.state, surface: actual.surface,
      evidence: actual.evidence!, turnId: actual.turnId!, askId: actual.askId!,
      batchId: actual.batchId!, timelineItemId: actual.timelineItemId!, preview: actual.preview!,
    };
    sample.native.id = actual.timelineItemId!;
    sample.native.externalInputView.data.items[0]!.askId = actual.askId!;
    setLedger([sample]);
    await show([sample]);
    assertNativeOnce(sample);
    expect(fallback(sample)).toBeNull();
    expect(host.querySelectorAll('[data-tl-row]')).toHaveLength(1);
  });

  it.each(captured.cases)("$label: joins the actual native received row without a ledger preview tail", async sample => {
    setLedger([sample]);
    await show([sample]);
    assertNativeOnce(sample);
    expect(fallback(sample)).toBeNull();
    expect(host.textContent).not.toContain(sample.record.preview);
    expect(host.querySelectorAll('[data-tl-row]')).toHaveLength(1);
  });

  it.each(captured.cases)("$label: missing history keeps fallback until its linked native item arrives", async sample => {
    setLedger([sample]);
    await show([]);
    expect(fallback(sample)?.textContent).toContain(sample.record.preview);
    expect(host.querySelectorAll('[data-tl-row]')).toHaveLength(1);
    await show([sample]);
    assertNativeOnce(sample);
    expect(fallback(sample)).toBeNull();
    expect(host.textContent).not.toContain(sample.record.preview);
  });

  it.each(captured.cases)("$label: the captured unlinked record remains visible even with native history", async sample => {
    setLedger([sample], false);
    await show([sample]);
    expect(fallback(sample)?.textContent).toContain(sample.record.preview);
    expect(host.textContent).toContain(sample.native.externalInputView.data.items[0]!.preview);
    expect(host.querySelectorAll('[data-tl-row]')).toHaveLength(2);
    expect(fallback(sample)?.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe("inContext");
  });

  it("keeps both canonical results distinct when the owner ridealong history arrives later", async () => {
    const [event, owner] = captured.cases as [Sample, Sample];
    expect(event.record.inputId).toBe("dlv-a4c134143b6c42f18dc7ae0c072fd8e4");
    expect(event.native.id).toBe("cutex-ask-event-d3e9fd6d1f3342c486466a7d4909ecef");
    expect(owner.record.inputId).toBe("dlv-520557a404cd41f7ac5c994ccd3ecf1a");
    expect(owner.native.id).toBe("cutex-ask-owner-508e64debc174e34b3b837ea89f42ea1");
    setLedger([event, owner]);
    await show([event]);
    assertNativeOnce(event);
    expect(fallback(event)).toBeNull();
    expect(fallback(owner)?.textContent).toContain(owner.record.preview);
    await show([event, owner]);
    for (const sample of [event, owner]) {
      assertNativeOnce(sample);
      expect(fallback(sample)).toBeNull();
      expect(host.textContent).not.toContain(sample.record.preview);
    }
    expect(host.querySelectorAll('[data-tl-row]')).toHaveLength(2);
  });
});


describe("057 coalesced carried results", () => {
  it("renders one shared native result view, preserves every input status, and keeps structured expansion reachable", async () => {
    const sample = structuredClone(captured.cases[0]!) as Sample;
    const fullBody = "Shared coalesced full result body";
    sample.native.output = JSON.stringify({ source: { kind: "service", id: "cutex-asks" }, type: "notice", text: fullBody });
    const secondItem = { ...sample.native.externalInputView.data.items[0]!, askId: "ask-second", title: "Second result", preview: "Second result excerpt" };
    sample.native.externalInputView.data.items.push(secondItem);
    const first = records([sample])[0]!;
    const second = { ...first, inputId: "dlv-second", state: "accepted" as const, stage: "offered" as const, askId: secondItem.askId, preview: "Second individual ledger preview" };
    const owner = record("carrying-owner", { cutexSessionId: first.cutexSessionId, kind: "owner", state: "inContext", turnId: first.turnId, timelineItemId: "owner-native", carries: [first.inputId, second.inputId] });
    const carried = [first, second].map(r => ({ ...r, reason: "carriedByOwner" }));
    fx.state.features = new Set(["input-ledger-v1", "owner-carries-v1"]);
    fx.state.inputs = { [key]: applyInputLedgerSnapshot(emptyInputLedgerSession(), {
      ledgerEpoch: "e", stateRevision: 1, records: [owner, ...carried], delivery: delivery("idle", 1), coverage: { kind: "full" },
    }).session };
    const timeline = timelineFromThreadRead({ thread: { id: "thread-s1", turns: [{ id: first.turnId, status: "completed", items: [
      { type: "userMessage", id: "owner-native", clientId: owner.inputId, content: [{ type: "text", text: "Owner text only" }] }, sample.native,
    ] }] } } as never);
    await act(async () => root.render(h(TimelineBody, { timeline, entries: orderedEntries(timeline), sessionId: SID, nameOf: (id: string) => id })));
    expect(host.querySelectorAll(`[data-carried-native-id="${sample.native.id}"]`)).toHaveLength(1);
    // Ordinary rows (owner 2026-11-05): no card box, no heading.
    expect(host.querySelector('[data-testid="owner-carried-inputs"]')).toBeNull();
    expect(host.textContent).not.toContain("inputLedger.carried");
    for (const child of carried) {
      const group = host.querySelector(`[data-carried-input-id="${child.inputId}"]`);
      expect(group?.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe(child.state);
      // Read in, or offered to the next tool gap: the timeline row already says it arrived — only a screen-reader word.
      expect(group?.querySelector('[data-testid="input-status"]')?.className).toBe("sr-only");
      expect(group?.textContent).toContain(child.state === "inContext" ? "inputLedger.record.inContext" : "inputLedger.record.accepted");
      expect(host.querySelectorAll(`[data-testid="input-status"][data-input-id="${child.inputId}"]`)).toHaveLength(1);
    }
    const resultButtons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent?.includes("delegation.resultFrom"));
    expect(resultButtons).toHaveLength(2);
    await act(async () => resultButtons[0]!.click());
    expect(host.textContent?.split(fullBody)).toHaveLength(2);
    expect(host.querySelector("[data-send-bubble]")?.textContent).toBe("Owner text only");
    expect(host.textContent).toContain("Second result");
    // The other result line controls the same shared rich body, rather than a second copy.
    await act(async () => resultButtons[1]!.click());
    expect(host.textContent).not.toContain(fullBody);
  });
});

// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import type { InputRecord, QueueItem } from "@cutex-desktop/protocol";
import { record, delivery, T0, iso } from "../src/renderer/src/lib/inputLedger/testkit";
import { emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";
const calls = vi.hoisted(() => ({ retry: vi.fn(), dismiss: vi.fn(), release: vi.fn(), resume: vi.fn(), notify: vi.fn(), log: vi.fn(), open: vi.fn(), sidebar: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { shell: { logError: calls.log } }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => vars?.n === undefined ? key : key + "(" + vars.n + ")" }) }));
vi.mock("../src/renderer/src/lib/delegationOpen", () => ({ openDelegationDetail: calls.open }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn(), openMenuAt: vi.fn() }));
vi.mock("../src/renderer/src/components/Avatar", () => ({ Avatar: ({ name, seed, size, agent }: { name: string; seed: string; size: number; agent: unknown }) => h("span", { "data-agent-avatar": seed, "data-size": size, "data-agent": !!agent }, name) }));
const LEDGER_ON = new Set(["input-ledger-v1", "stop-answer-admission-v1"]); const LEDGER_OFF = new Set<string>();
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ inputs: {}, ledgerOutbox: {}, sessions: {}, byHost: {}, selectedId: null, hosts: { active: "old-focus" },
    retryInput: calls.retry, dismissInput: calls.dismiss, releaseInputLease: calls.release, resumePaused: calls.resume, notify: calls.notify, hydrateQueue: () => {} }));
  return { useApp, agentState: (map: Record<string, unknown>, host: string, session: string) => map?.[host+"\n"+session],
    featuresOf: (_s: unknown, host: string) => host === "new-host" ? LEDGER_ON : LEDGER_OFF,
    selectedFeatures: () => new Set(), agentHost: () => "old-focus", sidebarOf: (s: unknown, host: string) => calls.sidebar(s, host) ?? null, viewOf: () => (globalThis as any).__reviewAdmissionView ?? null,
    queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map(p => p.text ?? "").join("") };
});
vi.mock("../src/renderer/src/lib/legacyDelivery/consumedBusReceipts", () => ({ useUnsettledBusReceipts: () => { throw Error("legacy receipt inference"); } }));
import { QueuePanel } from "../src/renderer/src/components/QueuePanel";
import { InputStatus } from "../src/renderer/src/components/InputStatus";
import { DeliveryStatus } from "../src/renderer/src/components/DeliveryStatus";
import { SessionDeliveryStatus } from "../src/renderer/src/components/PendingSends";
import { useApp } from "../src/renderer/src/store";
import { resetQueueViewCache } from "../src/renderer/src/lib/queueView";
import { ledgerOrderRef } from "../src/renderer/src/lib/admissionOrder";
import { ledgerQueue, deliveryBusy } from "../src/renderer/src/lib/inputLedger/nextUp";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { useDelegations } from "../src/renderer/src/lib/delegationStore";
import { useAgentMessages } from "../src/renderer/src/lib/agentMessageStore";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let el: HTMLDivElement;
const key = "new-host\ncutex.s1";
const noop = () => {};
const session = (records: InputRecord[], state = delivery("idle", 1)) => ({ ...emptyInputLedgerSession(), delivery: state, records: new Map(records.map(r => [r.inputId, r])) });
const seed = (records: InputRecord[], state = delivery("idle", 1)) => act(() => useApp.setState({ inputs: { [key]: session(records, state) } }));
const panelProps = (overrides: Partial<React.ComponentProps<typeof QueuePanel>> = {}) => ({ sessionId: "cutex.s1", hostId: "new-host", steers: [], outbox: { onRetry: noop, onEdit: noop, onDiscard: noop }, onInterruptSendSteers: noop, onDismissSteer: noop, paused: { steers: [], items: [], count: 0 }, onResumePaused: noop, onRestorePaused: noop, onClearPaused: noop, items: [], canEdit: true, onEdit: noop, onDelete: noop, ...overrides });
const panel = (overrides: Partial<React.ComponentProps<typeof QueuePanel>> = {}) => act(() => root.render(h(QueuePanel, panelProps(overrides))));
const ids = () => [...el.querySelectorAll<HTMLElement>('[data-testid="ledger-queue-row"]')].map(n => n.dataset.inputId);
async function click(text: string) { await act(async () => { const button = [...el.querySelectorAll("button")].find(b => b.textContent === text); expect(button).toBeTruthy(); button!.click(); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(T0 + 20*86400000);
  for (const fn of Object.values(calls)) fn.mockReset();
  useDelegations.setState({ byKey: {} });
  resetQueueViewCache(); localStorage.clear(); useApp.setState({ inputs: {}, ledgerOutbox: {} }); useAgentMessages.getState().reset();
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); vi.useRealTimers(); });

it('REVIEW: N10 is visible on the current ledger Next Up path', () => {
  const answer = record('answer-after-stop', {kind:'delegationResult', surface:'nextUp', state:'waiting',reason:'afterTurn',preview:'answer',actions:['dismiss'],askId:'ask-1'});
  (globalThis as any).__reviewAdmissionView = {admission:{ridealongsHeld:'ownerStop',nextStep:[{id:answer.inputId,deliveryKind:'answer',eligible:true,held:null,timing:'afterTurn'}]}};
  seed([answer]); panel();
  expect(ids()).toEqual([answer.inputId]);
  expect(el.textContent, 'ledger host with eligible ANSWER under stop must show approved N10 note').toContain('queue.turn.afterStop');
});

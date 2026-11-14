// @vitest-environment jsdom
// safety-grant-delivery in the UI: the 「主人已批准一次」 row of 接下来 and the safety-block card say how the grant
// reaches the agent (newer cutex) or keep their old words (older cutex).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputRecord, OwnerNotification, SafetyBlock } from "@cutex-desktop/protocol";

const fx = vi.hoisted(() => ({ notes: {} as Record<string, unknown>, ledger: null as unknown, state: { sidebar: null, inputs: {} } as Record<string, unknown> }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentState: () => ({ records: new Map(fx.ledger ? [["alarm-approval-1", fx.ledger]] : []) }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
// The shared 30 s clock captures the real time at module load; follow the faked Date instead.
vi.mock("../src/renderer/src/lib/time", async (importOriginal) => ({ ...(await importOriginal<object>()), useClock: () => Date.now() }));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({ ...(await importOriginal<object>()), useHostOwnerNotes: () => fx.notes, safetyCheckAct: vi.fn() }));
import { GrantNoticeStatus } from "../src/renderer/src/components/AdmissionRows";
import { NEXT_UP_DETAILS, fill } from "../src/renderer/src/lib/inputLedger/nextUpRegistry";
import { SafetyBlockCard } from "../src/renderer/src/components/SafetyBlockCard";
import { formatAbsolute, formatAt } from "../src/renderer/src/lib/time";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = Date.parse("2026-11-10T07:00:00.000Z");
const iso = (mins: number) => new Date(NOW + mins * 60_000).toISOString();
const hhmm = (mins: number) => formatAt((NOW + mins * 60_000) / 1000, NOW);

const block = (over: Partial<SafetyBlock> = {}): SafetyBlock => ({
  blockId: "sb-1", runtime: "claude", threadId: "t", turnId: "turn-1", itemId: "call-1", toolName: "Bash", toolInput: null, command: "rm -rf $OUT/$run", reason: "possibly-empty variable",
  state: "granted", blockedAt: iso(-10), decidedAt: iso(-1), expiresAt: iso(119), usedAt: null, grantSeconds: 1800,
  noticeInputId: "alarm-approval-1", noticeReadAt: null, hardExpiresAt: iso(119), ...over,
});
const note = (b: SafetyBlock): OwnerNotification => ({ notificationId: "ntf-1", agentId: "plot", agentName: "plot", origin: "system", text: "", level: "info", requestedLevel: "info", downgraded: null, muted: false, channels: [], needsReply: false, delegation: null, job: null, turnId: "turn-1", state: "acknowledged", createdAt: iso(-10), acknowledgedAt: iso(-1), reply: null, closedAt: iso(-1), systemKind: "safetyBlock", safetyBlock: b }) as OwnerNotification;
const record = (over: Partial<InputRecord> = {}) => ({ inputId: "alarm-approval-1", kind: "alarm", state: "accepted", evidence: null, ...over }) as Pick<InputRecord, "inputId" | "kind" | "state" | "evidence">;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
// Registry 1.5: the grant notice is a row-end add-on (words from NEXT_UP_DETAILS); without one the row keeps its own status.
const row = (r = record()) => act(() => root.render(h(GrantNoticeStatus, { record: r, sessionId: "plot", hostId: "local" })));
const card = (b: SafetyBlock) => act(() => root.render(h(SafetyBlockCard, { record: note(b), block: b, hostId: "local" })));
const stateLine = () => container.querySelector("[data-grant-notice]")?.textContent ?? container.querySelector("[data-safety-state] .ml-auto")?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fx.notes = {};
  fx.ledger = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("接下来 row of the approval notice", () => {
  it("registered / offered: 已批准一次，等待当前工具返回后送达 · 最晚 HH:MM 前有效", () => {
    fx.notes = { n: note(block()) };
    for (const r of [record({ state: "accepted", stage: "registered" } as Partial<InputRecord>), record({ state: "accepted", stage: "offered" } as Partial<InputRecord>), record({ state: "waiting" })]) {
      row(r);
      expect(container.querySelector("[data-testid=grant-notice-waiting]")).not.toBeNull();
      expect(container.textContent).toBe(`${NEXT_UP_DETAILS.grantWaiting.en} · ${fill(NEXT_UP_DETAILS.grantCap.en, { time: hhmm(119) })}`);
    }
  });

  it("r282 sends the approval notice as systemNotice: same add-on (older hosts: alarm)", () => {
    fx.notes = { n: note(block()) };
    row(record({ kind: "systemNotice", state: "waiting" }));
    expect(container.querySelector("[data-testid=grant-notice-waiting]")).not.toBeNull();
    row(record({ kind: "agentMessage", state: "waiting" }));
    expect(container.textContent).toBe("");
  });
  it("read: 已送达 · 有效至 HH:MM from expiresAt", () => {
    fx.notes = { n: note(block({ noticeReadAt: iso(0), expiresAt: iso(30) })) };
    row(record({ state: "inContext", evidence: "externalInputPersisted" }));
    expect(container.textContent).toBe(fill(NEXT_UP_DETAILS.grantRead.en, { time: hhmm(30) }));
  });

  it("an older cutex (no noticeInputId), another alarm, or a notice that failed: the ledger's own status", () => {
    fx.notes = { n: note(block({ noticeInputId: undefined, hardExpiresAt: undefined, noticeReadAt: undefined })) };
    row();
    expect(container.textContent).toBe("");
    fx.notes = { n: note(block()) };
    row(record({ inputId: "alarm-other" }));
    expect(container.textContent).toBe("");
    row(record({ state: "uncertain" }));
    expect(container.textContent).toBe("");
    // Used or expired: the grant is over, the row is not about delivery any more.
    fx.notes = { n: note(block({ state: "used" })) };
    row();
    expect(container.textContent).toBe("");
  });
});

describe("safety-block card of a granted block", () => {
  it("waiting for the read: the hard cap, and the hint explains the read window", () => {
    card(block());
    expect(stateLine()).toBe(`safetyBlock.notice.waiting · safetyBlock.notice.cap(time=${hhmm(119)})`);
    expect(container.querySelector("[data-grant-notice]")?.getAttribute("title")).toBe(`safetyBlock.notice.waitingHint(minutes=30,time=${hhmm(119)})`);
  });

  it("read (noticeReadAt, or the ledger record in context with evidence): 已送达 · 有效至 HH:MM", () => {
    card(block({ noticeReadAt: iso(0), expiresAt: iso(30) }));
    expect(stateLine()).toBe(`safetyBlock.notice.read(time=${hhmm(30)})`);
    fx.ledger = { state: "inContext", evidence: "contextPersisted" };
    card(block({ expiresAt: iso(30) }));
    expect(stateLine()).toBe(`safetyBlock.notice.read(time=${hhmm(30)})`);
  });

  it("an older cutex keeps 已批准一次，{time} 前有效", () => {
    card(block({ noticeInputId: undefined, hardExpiresAt: undefined, noticeReadAt: undefined, expiresAt: iso(30) }));
    expect(container.querySelector("[data-grant-notice]")).toBeNull();
    expect(container.textContent).toContain(`safetyBlock.state.granted(time=${formatAbsolute((NOW + 30 * 60_000) / 1000)})`);
  });

  it("used / expired keep their lines", () => {
    card(block({ state: "used", usedAt: iso(0) }));
    expect(container.textContent).toContain("safetyBlock.state.used");
    card(block({ expiresAt: iso(-1) }));
    expect(container.textContent).toContain("safetyBlock.state.expired");
  });
});

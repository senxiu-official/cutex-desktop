// r295 Z3 next-step navigation (lib/activityOpen): the delegation's detail on the record's host, scrolled to the result or
// the approval card; an approval whose card is not in the detail, or a detail that cannot open here, goes to that
// host's 审批 page; the row's old opener is the fallback for the rest. The chip (components/ActivityStepChip) renders
// the button only for navigation.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const opened: { hostId: string; askId: string }[] = [];
let unavailable = false;
const approvalsOn = vi.fn();

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/delegationOpen", () => ({
  openDelegationDetail: (hostId: string, askId: string, opts: { fallback?: () => void } = {}) => {
    opened.push({ hostId, askId });
    if (unavailable) opts.fallback?.();
  },
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ openApprovalsOn: approvalsOn }) } }));

import { approvalCardInDetail, openStepAction, ownStepOf, reviewCardInDetail, takeDetailFocus, useDetailFocus } from "../src/renderer/src/lib/activityOpen";
import { useDelegations } from "../src/renderer/src/lib/delegationStore";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { ActivityStepChip } from "../src/renderer/src/components/ActivityStepChip";

const ask = (askId: string, over: Partial<AskSummary> = {}): AskSummary => ({
  askId, title: "t", requester: { kind: "owner" }, target: "a", projectId: "p", execution: "queued", hold: null, review: null, closed: null, attempts: 0,
  createdAt: "2026-11-25T01:00:00Z", updatedAt: "2026-11-25T01:00:00Z", revision: 1, ...over,
}) as AskSummary;
const setRecord = (hostId: string, d: AskSummary) => useDelegations.setState((s) => ({ byKey: { ...s.byKey, [hostKey(hostId, d.askId)]: d } }));

beforeEach(() => {
  opened.length = 0;
  unavailable = false;
  approvalsOn.mockClear();
  useDetailFocus.setState({ request: null });
  useDelegations.setState({ byKey: {} });
});

describe("opening a next step", () => {
  it("the result: the record's own detail, with the answer id it pointed at for the detail to check", () => {
    openStepAction("ws", "ask-1", { kind: "result", answerId: "ans-1" });
    expect(opened).toEqual([{ hostId: "ws", askId: "ask-1" }]);
    expect(takeDetailFocus("local", "ask-1")).toBeNull();
    expect(takeDetailFocus("ws", "ask-1")).toMatchObject({ section: "result", answerId: "ans-1" });
    // Taken once.
    expect(takeDetailFocus("ws", "ask-1")).toBeNull();
  });

  it("an approval with its card in the detail (a delegation in 待审批, a routing review) opens the detail at the top", () => {
    setRecord("ws", ask("ask-1", { execution: "pendingReview" }));
    openStepAction("ws", "ask-1", { kind: "approval", ref: { kind: "capability", approvalId: "apr-1", projectId: "p" } });
    expect(opened).toEqual([{ hostId: "ws", askId: "ask-1" }]);
    expect(useDetailFocus.getState().request).toMatchObject({ hostId: "ws", askId: "ask-1", section: "review" });
    setRecord("ws", ask("ask-2", { reviewRefs: [{ kind: "routing", approvalId: "rt-1", projectId: "p" }] }));
    expect(reviewCardInDetail(useDelegations.getState().byKey[hostKey("ws", "ask-2")])).toBe(true);
  });

  it("an approval whose card is only on the 审批 page goes there, on the record's host", () => {
    setRecord("ws", ask("ask-1", { hold: { reason: "waitingForApproval" } }));
    openStepAction("ws", "ask-1", { kind: "approval", ref: { kind: "capability", approvalId: "apr-1", projectId: "p" } });
    expect(opened).toEqual([]);
    expect(approvalsOn).toHaveBeenCalledWith("ws");
    // Not loaded here at all: the 审批 page too.
    openStepAction("ws", "ask-9", { kind: "approval", ref: { kind: "capability", approvalId: "apr-9", projectId: null } });
    expect(approvalsOn).toHaveBeenCalledTimes(2);
  });

  it("a detail that cannot open here: the approval falls back to the 审批 page, the rest to the row's opener; no focus is left behind", () => {
    unavailable = true;
    setRecord("ws", ask("ask-1", { execution: "pendingReview" }));
    openStepAction("ws", "ask-1", { kind: "approval", ref: { kind: "capability", approvalId: "apr-1", projectId: "p" } });
    expect(approvalsOn).toHaveBeenCalledWith("ws");
    const fallback = vi.fn();
    openStepAction("ws", "ask-2", { kind: "result", answerId: "r" }, { fallback });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(useDetailFocus.getState().request).toBeNull();
  });

  it("an agent's owner approval opens its host's 审批 page", () => {
    openStepAction("ws", "", { kind: "approvals" });
    expect(approvalsOn).toHaveBeenCalledWith("ws");
    expect(opened).toEqual([]);
  });
});

describe("the step chip", () => {
  let host: HTMLDivElement;
  afterEach(() => host?.remove());
  const render = async (node: React.ReactNode) => {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(node));
    return root;
  };

  it("blocker words and one navigation button; 等待 stays words; blocker={false} shows the button alone", async () => {
    const root = await render(<>
      <ActivityStepChip step={{ blocker: "acceptance", next: "openResult", action: { kind: "result", answerId: "ans-1" } }} hostId="ws" askId="ask-1" />
      <ActivityStepChip step={{ blocker: "targetBusy", next: "wait", action: null }} hostId="ws" askId="ask-2" />
      <ActivityStepChip step={{ blocker: "quota", next: "openDelegation", action: { kind: "delegation" } }} hostId="ws" askId="ask-3" blocker={false} />
    </>);
    const chips = [...host.querySelectorAll("[data-activity-step]")];
    expect(chips.map((c) => c.getAttribute("data-activity-step"))).toEqual(["acceptance", "targetBusy", "quota"]);
    expect(chips[1]!.querySelector("button")).toBeNull();
    expect(chips[2]!.querySelector(".text-warn-text")).toBeNull();
    await act(async () => (chips[0]!.querySelector("button") as HTMLButtonElement).click());
    expect(opened).toEqual([{ hostId: "ws", askId: "ask-1" }]);
    expect(useDetailFocus.getState().request).toMatchObject({ section: "result", answerId: "ans-1" });
    await act(async () => root.unmount());
  });
});

// Review 2026-11-25 P2-1 (roster-bottom-review, activityOpenBoundary.review.test.tsx): the card is located by kind and id.
describe("review boundaries", () => {
  it("an approval reference absent from this detail goes to the host approval page", () => {
    setRecord("ws", ask("ask-1", { execution: "pendingReview", reviewRefs: [{ kind: "capability", approvalId: "apr-current", projectId: "p" }] }));
    openStepAction("ws", "ask-1", { kind: "approval", ref: { kind: "capability", approvalId: "apr-other", projectId: "p" } });
    expect(approvalsOn).toHaveBeenCalledWith("ws");
    expect(opened).toEqual([]);
  });

  it("a queued capability wait is not sent to a historical routing card", () => {
    setRecord("ws", ask("ask-1", { execution: "queued", hold: { reason: "waitingForApproval" }, reviewRefs: [
      { kind: "routing", approvalId: "rt-approved", projectId: "p" },
      { kind: "capability", approvalId: "apr-current", projectId: "p" },
    ] }));
    openStepAction("ws", "ask-1", { kind: "approval", ref: { kind: "capability", approvalId: "apr-current", projectId: "p" } });
    expect(approvalsOn).toHaveBeenCalledWith("ws");
    expect(opened).toEqual([]);
  });

  it("a routing card is found by its approval id; the delegation's own surfaces then still offer 查看审批 for the other one", () => {
    const d = ask("ask-1", { execution: "queued", hold: { reason: "waitingForApproval" }, reviewRefs: [{ kind: "routing", approvalId: "rt-1", projectId: "p" }, { kind: "capability", approvalId: "apr-2", projectId: "p" }],
      activityLink: { delegation: { kind: "delegation", askId: "ask-1" }, approval: { kind: "capability", approvalId: "apr-2", projectId: "p" }, result: null, blocker: "approval", next: "openApproval" } });
    expect(approvalCardInDetail(d, { kind: "routing", approvalId: "rt-1", projectId: "p" })).toBe(true);
    expect(approvalCardInDetail(d, { kind: "routing", approvalId: "rt-old", projectId: "p" })).toBe(false);
    expect(approvalCardInDetail(d, { kind: "capability", approvalId: "apr-2", projectId: "p" })).toBe(false);
    expect(ownStepOf(d)?.action).toEqual({ kind: "approval", ref: { kind: "capability", approvalId: "apr-2", projectId: "p" } });
    // In 待审批 with that capability card shown here: no 查看审批 on its own surfaces.
    expect(ownStepOf({ ...d, execution: "pendingReview", hold: null })).toBeNull();
  });

  it("the detail is told which approval it opened for", () => {
    setRecord("ws", ask("ask-1", { execution: "pendingReview" }));
    openStepAction("ws", "ask-1", { kind: "approval", ref: { kind: "capability", approvalId: "apr-1", projectId: "p" } });
    expect(takeDetailFocus("ws", "ask-1")).toMatchObject({ section: "review", approval: { kind: "capability", approvalId: "apr-1" } });
  });
});

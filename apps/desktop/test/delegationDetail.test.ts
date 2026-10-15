import { describe, expect, it } from "vitest";
import type { AskDetail } from "../src/shared/ipc";
import { askIdOfRef, DELEGATION_REF_KIND, delegationRef, isAskId } from "../src/renderer/src/lib/delegationRefs";
import { checkRefContributions } from "../src/renderer/src/lib/refs";
import { applyOpen, emptyLayout, hasContentFor, pageInView, place, placeSpec, shownTab, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { DETAIL, DETAIL_GROUP, DETAIL_STATE_VERSION, detailKey, detailOpenArgs, detailTabTitle, initDetail, parseDetailParams, refResult, restoreDetail, summaryFromDetail } from "../src/renderer/src/modules/delegations/detail";

describe("delegation refs", () => {
  it("formats a ref on the row's host, key = ask id, title clipped / defaulted", () => {
    expect(delegationRef("ssh-workstation", "ask-7", "  Review the queue  ")).toEqual({ hostId: "ssh-workstation", kind: DELEGATION_REF_KIND, key: "ask-7", title: "Review the queue", params: {} });
    expect(delegationRef("local", "ask-7").title).toBe("ask-7");
    expect(delegationRef("local", "ask-7", "x".repeat(300)).title).toHaveLength(200);
  });

  it("parses only well-formed delegation refs", () => {
    expect(askIdOfRef({ kind: "delegation", key: "ask-7" })).toBe("ask-7");
    expect(askIdOfRef({ kind: "artifact", key: "ask-7" })).toBeNull();
    expect(askIdOfRef({ kind: "delegation", key: "" })).toBeNull();
    expect(askIdOfRef({ kind: "delegation", key: "../etc" })).toBeNull();
    expect(askIdOfRef({ kind: "delegation", key: "a b" })).toBeNull();
    expect(isAskId("ask-123456")).toBe(true);
    expect(isAskId(7)).toBe(false);
  });

  it("is a valid, free ref kind", () => {
    const module = { id: "delegations", contributes: { "ref.target": [{ kind: DELEGATION_REF_KIND }], "side.component": [{ id: "delegations.detail" }] } };
    expect(checkRefContributions([module], [])).toEqual(new Map());
  });
});

describe("delegations.detail", () => {
  it("validates params and keeps the known title on reuse", () => {
    expect(parseDetailParams({ askId: "ask-7", title: "  T  " })).toEqual({ askId: "ask-7", title: "T" });
    expect(parseDetailParams({ askId: "ask-7", title: "" })).toEqual({ askId: "ask-7" });
    expect(parseDetailParams({ askId: 3 })).toBeNull();
    expect(parseDetailParams(null)).toBeNull();
    expect(detailKey({ askId: "ask-7" })).toBe("ask-7");
    expect(initDetail({ askId: "ask-7" }, { askId: "ask-7", title: "Old" })).toEqual({ askId: "ask-7", title: "Old" });
    expect(initDetail({ askId: "ask-8" }, { askId: "ask-7", title: "Old" })).toEqual({ askId: "ask-8" });
    expect(restoreDetail({ askId: "ask-7" }, DETAIL_STATE_VERSION)).toEqual({ askId: "ask-7" });
    expect(restoreDetail({ askId: "ask-7" }, DETAIL_STATE_VERSION + 1)).toBeNull();
  });

  it("titles the tab 委托 #tag · title", () => {
    expect(detailTabTitle("委托", "#7", "Review\n the  queue")).toBe("委托 #7 · Review the queue");
    expect(detailTabTitle("Delegation", "#7", null)).toBe("Delegation #7");
    expect(detailTabTitle("委托", "#7", "   ")).toBe("委托 #7");
  });

  it("binds the side open to the open agent on the ref's host (host-bound only with no agent)", () => {
    expect(detailOpenArgs(delegationRef("ssh-workstation", "ask-7", "Review"), "lead")).toEqual({ params: { askId: "ask-7", title: "Review" }, binding: { kind: "agent", hostId: "ssh-workstation", sessionId: "lead" } });
    expect(detailOpenArgs(delegationRef("local", "ask-7"), null)).toEqual({ params: { askId: "ask-7" }, binding: { kind: "host", hostId: "local" } });
    expect(detailOpenArgs({ hostId: "local", kind: "turn", key: "ask-7", title: "", params: {} }, "lead")).toBeNull();
  });

  // Regression (owner 2026-10-15: 打开一个 agent，旁边的委托页面还是其他 agent 的). The side layout's
  // pages are shared by every agent; a host-bound detail showed beside every agent of the host, and a
  // transient open from agent B replaced agent A's detail in place.
  it("keeps one agent's detail out of another agent's side view", () => {
    const spec = placeSpec({ home: DETAIL_GROUP, prefer: [{ containing: DETAIL }, { group: DETAIL_GROUP }] });
    const openFor = (layout: SideLayout, sessionId: string, askId: string, now: number) => {
      const args = detailOpenArgs(delegationRef("local", askId), sessionId)!;
      const key = detailKey(args.params);
      const decision = place(layout, { kind: DETAIL, binding: args.binding, key, transient: true, activePage: layout.activePage, columnOpen: layout.open }, spec);
      return applyOpen(layout, decision, { kind: DETAIL, binding: args.binding, key, state: { ...args.params }, v: DETAIL_STATE_VERSION, pinned: false }, now, { reveal: true, home: spec.home }).layout;
    };
    const ctx = (sessionId: string) => ({ hostId: "local", sessionId, workspaceKey: null, available: () => true });
    const shownAsk = (layout: SideLayout, sessionId: string) => {
      const page = pageInView(layout, ctx(sessionId));
      const card = page?.cards.find((c) => c.kind === DETAIL);
      const id = card ? shownTab(layout, card, ctx(sessionId)) : null;
      return id ? (layout.instances[id]!.state as { askId: string }).askId : null;
    };
    const a = openFor(emptyLayout(), "lead", "ask-run", 1);
    expect(shownAsk(a, "lead")).toBe("ask-run");
    // Agent B has nothing of its own: lead's detail is not in its view.
    expect(shownAsk(a, "mika")).toBeNull();
    expect(hasContentFor(a, ctx("mika"))).toBe(false);
    // B opens its own: a second tab (no in-place replace of lead's), each agent sees its own.
    const b = openFor(a, "mika", "ask-wait", 2);
    expect(Object.keys(b.instances)).toHaveLength(2);
    expect(shownAsk(b, "mika")).toBe("ask-wait");
    expect(shownAsk(b, "lead")).toBe("ask-run");
    // Within one agent a transient open still replaces its own preview in place.
    const c = openFor(b, "lead", "ask-done", 3);
    expect(Object.keys(c.instances)).toHaveLength(2);
    expect(shownAsk(c, "lead")).toBe("ask-done");
    expect(shownAsk(c, "mika")).toBe("ask-wait");
  });

  it("drops the old host-bound (state version 1) details on restore", () => {
    expect(restoreDetail({ askId: "ask-7" }, 1)).toBeNull();
    expect(restoreDetail({ askId: "ask-7" }, DETAIL_STATE_VERSION)).toEqual({ askId: "ask-7" });
  });

  it("maps side open results to ref results", () => {
    expect(refResult({ status: "opened", instanceId: "i", where: "card", pageId: "p", reused: false })).toEqual({ status: "opened", where: "card" });
    expect(refResult({ status: "stale" })).toEqual({ status: "stale" });
    expect(refResult({ status: "unavailable", reason: "capability" })).toEqual({ status: "unavailable", reason: "capability" });
    expect(refResult({ status: "unavailable", reason: "bad-params" })).toEqual({ status: "unavailable", reason: "bad-ref" });
    expect(refResult({ status: "unavailable", reason: "module-off" })).toEqual({ status: "unavailable", reason: "module-off" });
  });

  it("builds a summary from a detail the list store has not loaded", () => {
    const detail = {
      askId: "ask-7",
      title: "Review",
      requester: { kind: "agent", cutexSessionId: "lead" },
      targetCutexSessionId: "worker",
      targetName: "Worker",
      execution: "answered",
      closed: "completed",
      attempts: [{ n: 1, state: "completed" }, { n: 2, state: "completed", model: "gpt-5" }],
      answer: { answerId: "ans-1", bytes: 10 },
      questions: [{ questionId: "q", askId: "ask-7", questions: [], state: "open" }],
      createdAt: "2026-10-13T00:00:00Z",
      updatedAt: "2026-10-13T01:00:00Z",
      revision: 4,
      hops: 2,
    } as unknown as AskDetail;
    const s = summaryFromDetail(detail)!;
    expect(s).toMatchObject({ askId: "ask-7", target: "worker", targetName: "Worker", attempts: 2, answerId: "ans-1", openQuestions: 1, closed: "completed", revision: 4, hops: 2 });
    expect(s.attempt?.n).toBe(2);
    expect(s.attempt?.model).toBe("gpt-5");
  });
});

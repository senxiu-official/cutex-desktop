// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directorZh } from "../src/renderer/src/modules/project-view/directorI18n";

const mock = vi.hoisted(() => ({
  features: new Set<string>(),
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  callback: undefined as ((e: unknown) => void) | undefined,
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (fn: (s: unknown) => unknown) => fn({}),
  featuresOf: () => mock.features,
}));
vi.mock("../src/renderer/src/bridge", () => ({
  apiFor: () => mock.api,
  bridge: {
    on: (_name: string, callback: (e: unknown) => void) => {
      mock.callback = callback;
      return () => {};
    },
  },
}));
vi.mock("../src/renderer/src/i18n", () => ({
  useI18n: () => ({
    t: (k: keyof typeof directorZh, params: Record<string, unknown> = {}) =>
      Object.entries(params).reduce<string>(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        directorZh[k] ?? k,
      ),
  }),
}));
const { DirectorPanel } =
  await import("../src/renderer/src/modules/project-view/DirectorPanel");
const { scopeIds, handoverAttention } =
  await import("../src/renderer/src/modules/project-view/directorModel");
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, el: HTMLDivElement;
const ok = (value: unknown) => ({ ok: true, value });
const director = (epoch = 8) => ({
  projectId: "p",
  directorSessionId: "new",
  authorityEpoch: epoch,
  changes: [],
});
const start = {
  reviewId: "r/1",
  projectId: "p",
  sourceActionId: "action",
  sourceMessageId: "message",
  originalRequester: "old",
  targetSession: "worker",
  revision: 2,
  epochAtReview: 8,
  state: "open",
  contentSha256: "abc",
};
const mount = async (historyOpen = false) => {
  await act(async () =>
    root.render(
      h(DirectorPanel, {
        hostId: "local",
        projectId: "p",
        nameOf: (id: string | null) => id,
        historyOpen,
      }),
    ),
  );
};
const button = (text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (text: string) => {
  await act(async () => button(text).click());
};
beforeEach(() => {
  localStorage.clear();
  mock.features = new Set([
    "director-address",
    "director-change-notices",
    "director-handover",
    "management-start-adoption",
  ]);
  mock.api = {
    projectDirector: vi.fn().mockResolvedValue(ok(director())),
    directorHandovers: vi.fn().mockResolvedValue(
      ok({
        items: [
          {
            id: "h",
            askId: "ask-1",
            from: "old",
            to: "new",
            revision: 3,
            state: "pending",
            provenanceKnown: true,
          },
        ],
      }),
    ),
    directorStartReviews: vi.fn().mockResolvedValue(ok({ items: [start] })),
    directorReviewContent: vi.fn().mockResolvedValue(
      ok({
        reviewId: "r/1",
        content: "Original task",
        delivery: { outcome: "not_delivered", state: "quarantined" },
      }),
    ),
    directorScopeCandidates: vi.fn().mockResolvedValue(ok({ items: [] })),
    approveDirectorScope: vi.fn().mockResolvedValue(ok({})),
    decideDirectorItem: vi.fn().mockResolvedValue(ok({})),
  };
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  el.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe("Director panel", () => {
  it("leaves old daemons unchanged and makes no new calls", async () => {
    mock.features.clear();
    await mount();
    expect(el.innerHTML).toBe("");
    expect(mock.api.projectDirector).not.toHaveBeenCalled();
  });
  it("requires an in-place confirmation and sends the displayed fence", async () => {
    await mount();
    await click("接管");
    expect(mock.api.decideDirectorItem).not.toHaveBeenCalled();
    await click("确认");
    expect(mock.api.decideDirectorItem).toHaveBeenCalledWith(
      "p",
      "handover",
      "h",
      "accept",
      { expectedEpoch: 8, expectedRevision: 3 },
    );
  });
  it("requires reading the source before reissue", async () => {
    await mount();
    expect(button("重新发出").disabled).toBe(true);
    await click("查看原始任务与送达状态");
    expect(el.textContent).toContain("Original task");
    expect(button("重新发出").disabled).toBe(false);
  });
  it("never reissues unknown delivery even after reading the source", async () => {
    mock.api.directorStartReviews!.mockResolvedValue(
      ok({ items: [{ ...start, state: "deliveryUnknown" }] }),
    );
    mock.api.directorReviewContent!.mockResolvedValue(
      ok({
        reviewId: "r/1",
        content: "Unknown",
        delivery: { outcome: "unknown" },
      }),
    );
    await mount();
    await click("查看原始任务与送达状态");
    expect(button("重新发出").disabled).toBe(true);
    expect(button("丢弃待办").disabled).toBe(false);
  });
  it("refreshes after an epoch conflict without repeating the mutation", async () => {
    mock.api.decideDirectorItem!.mockResolvedValue({
      ok: false,
      code: "authority_conflict",
      message: "stale",
    });
    await mount();
    await click("接管");
    await click("确认");
    expect(el.textContent).toContain("{{Director}}或待办已变化");
    expect(mock.api.projectDirector).toHaveBeenCalledTimes(2);
    expect(mock.api.decideDirectorItem).toHaveBeenCalledTimes(1);
  });
  it("deduplicates explicit scope IDs without inferring any others", () => {
    expect(scopeIds("ask-1\nask-2, ask-1")).toEqual(["ask-1", "ask-2"]);
  });
  it("keeps the confirmed epoch when a change event refreshes the panel", async () => {
    await mount();
    await click("接管");
    mock.api.projectDirector!.mockResolvedValue(ok(director(9)));
    await act(async () =>
      mock.callback?.({
        hostId: "local",
        envelope: { cutex: { method: "cutex/project/directorChanged" } },
      }),
    );
    await click("确认");
    expect(mock.api.decideDirectorItem).toHaveBeenCalledWith(
      "p",
      "handover",
      "h",
      "accept",
      { expectedEpoch: 8, expectedRevision: 3 },
    );
  });
  it("scope discovery grants nothing until selected IDs are confirmed", async () => {
    mock.api.directorScopeCandidates!.mockResolvedValue(
      ok({
        items: [
          {
            askId: "legacy-1",
            title: "Legacy task",
            requester: { cutexSessionId: "old" },
            targetSession: "worker",
          },
          {
            askId: "private-2",
            title: "Private task",
            requester: { cutexSessionId: "other" },
            targetSession: "worker",
          },
        ],
      }),
    );
    await mount();
    await click("选择历史范围");
    expect(mock.api.approveDirectorScope).not.toHaveBeenCalled();
    await act(async () =>
      (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    await click("授权所选范围");
    expect(mock.api.approveDirectorScope).not.toHaveBeenCalled();
    await click("确认");
    expect(mock.api.approveDirectorScope).toHaveBeenCalledWith("p", {
      id: expect.any(String),
      expectedEpoch: 8,
      askIds: ["legacy-1"],
    });
    expect(mock.api.decideDirectorItem).not.toHaveBeenCalled();
  });
  it("shows a cleared seat and keeps discard available without enabling accept or reissue", async () => {
    mock.api.projectDirector!.mockResolvedValue(
      ok({
        ...director(),
        directorSessionId: null,
        changes: [
          {
            changeId: "clear",
            state: "finalized",
            oldDirector: "old",
            newDirector: null,
            cleared: true,
          },
        ],
      }),
    );
    await mount();
    expect(el.textContent).toContain("{{Director}}已取消");
    expect(button("接管").disabled).toBe(true);
    await click("查看原始任务与送达状态");
    expect(button("重新发出").disabled).toBe(true);
    expect(button("丢弃待办").disabled).toBe(false);
    await click("丢弃待办");
    await click("确认");
    expect(mock.api.decideDirectorItem).toHaveBeenCalledWith(
      "p",
      "handover",
      "h",
      "discard",
      { expectedEpoch: 8, expectedRevision: 3 },
    );
  });
  it("disables an already armed accept if the Director seat is cleared", async () => {
    await mount();
    await click("接管");
    mock.api.projectDirector!.mockResolvedValue(
      ok({ ...director(9), directorSessionId: null }),
    );
    await act(async () =>
      mock.callback?.({
        hostId: "local",
        envelope: { cutex: { method: "cutex/project/directorChanged" } },
      }),
    );
    expect(button("确认").disabled).toBe(true);
    await click("确认");
    expect(mock.api.decideDirectorItem).not.toHaveBeenCalled();
  });
  it.each(["pending", "superseded", "discarded"])(
    "lets the authenticated owner resolve a %s owner-only stale destination",
    async (state) => {
      mock.api.directorHandovers!.mockResolvedValue(
        ok({
          items: [
            {
              id: "h",
              askId: "ask-1",
              from: "old",
              to: "previous-target",
              revision: 4,
              state,
              ownerOnly: true,
            },
          ],
        }),
      );
      await mount();
      expect(el.textContent).toContain("仅{{owner}}可决定");
      expect(button("接管").disabled).toBe(false);
      await click("接管");
      await click("确认");
      expect(mock.api.decideDirectorItem).toHaveBeenCalledWith(
        "p",
        "handover",
        "h",
        "accept",
        { expectedEpoch: 8, expectedRevision: 4 },
      );
    },
  );
  it("shows actual accepted destination independently of the original proposal", async () => {
    mock.api.directorHandovers!.mockResolvedValue(
      ok({
        items: [
          {
            id: "h",
            askId: "ask-1",
            from: "old",
            to: "previous-target",
            resolvedTo: "actual-director",
            revision: 4,
            state: "accepted",
          },
        ],
      }),
    );
    await mount();
    expect(el.textContent).toContain("实际接管人：actual-director");
    expect(el.textContent).toContain("现由 actual-director 接管");
    expect(button("接管")).toBeUndefined();
  });
  it("keeps both verified and unverified scope candidates visible without granting them", async () => {
    mock.api.directorScopeCandidates!.mockResolvedValue(
      ok({
        items: [true, false].map((provenanceKnown) => ({
          askId: String(provenanceKnown),
          title: "Task",
          requester: { cutexSessionId: "old" },
          targetSession: "worker",
          provenanceKnown,
        })),
      }),
    );
    await mount();
    await click("选择历史范围");
    expect(el.textContent).toContain("项目来源已确认");
    expect(el.textContent).toContain("来源待确认");
    expect(el.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(mock.api.approveDirectorScope).not.toHaveBeenCalled();
  });
  it("does not approve scopes while the seat is vacant", async () => {
    mock.api.projectDirector!.mockResolvedValue(
      ok({ ...director(), directorSessionId: null }),
    );
    mock.api.directorScopeCandidates!.mockResolvedValue(
      ok({
        items: [
          {
            askId: "a",
            title: "Task",
            requester: { cutexSessionId: "old" },
            targetSession: "worker",
            provenanceKnown: true,
          },
        ],
      }),
    );
    await mount();
    await click("选择历史范围");
    await act(async () =>
      (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    expect(button("授权所选范围").disabled).toBe(true);
    expect(mock.api.approveDirectorScope).not.toHaveBeenCalled();
  });
});
// Owner 2026-10-29: quiet handovers disappear; history and current notices are separate from owner work.
describe("Director panel: hidden when there is nothing to act on", () => {
  const both = { handover: true, adoption: true };
  const seat = { directorSessionId: "new" };
  const empty = async () => {
    mock.api.directorHandovers!.mockResolvedValue(ok({ items: [] }));
    mock.api.directorStartReviews!.mockResolvedValue(ok({ items: [] }));
  };
  const panel = () =>
    el.querySelector('[data-testid="director-panel"]') as HTMLElement;

  it("the rule: a vacant seat, a pending handover or an open / unknown review need the owner", () => {
    expect(
      handoverAttention({ director: seat, handovers: [], starts: [] }, both),
    ).toBe(false);
    expect(
      handoverAttention(
        {
          director: seat,
          handovers: [
            { state: "accepted" },
            { state: "discarded" },
            { state: "superseded" },
          ],
          starts: [{ state: "adopted" }],
        },
        both,
      ),
    ).toBe(false);
    expect(
      handoverAttention(
        { director: { directorSessionId: null }, handovers: [], starts: [] },
        both,
      ),
    ).toBe(true);
    expect(
      handoverAttention(
        { director: seat, handovers: [{ state: "pending" }], starts: [] },
        both,
      ),
    ).toBe(true);
    expect(
      handoverAttention(
        { director: seat, handovers: [], starts: [{ state: "open" }] },
        both,
      ),
    ).toBe(true);
    expect(
      handoverAttention(
        {
          director: seat,
          handovers: [],
          starts: [{ state: "deliveryUnknown" }],
        },
        both,
      ),
    ).toBe(true);
    // A section the host does not offer does not count.
    expect(
      handoverAttention(
        {
          director: seat,
          handovers: [{ state: "pending" }],
          starts: [{ state: "open" }],
        },
        { handover: false, adoption: false },
      ),
    ).toBe(false);
  });

  it("all counts 0: no handover section, empty counts or controls", async () => {
    await empty();
    await mount();
    expect(panel()).toBeNull();
    expect(el.textContent).not.toContain("委托接管");
    expect(el.textContent).not.toContain("首消息审核");
    expect(button("刷新")).toBeUndefined();
  });

  it("history and scope stay reachable through an explicit history view", async () => {
    await empty();
    await mount();
    await mount(true);
    expect(panel().dataset.open).toBe("true");
    expect(el.textContent).toContain("委托接管 · 0");
    expect(button("选择历史范围")).toBeTruthy();
    expect(el.textContent).toContain("交接记录");
    await mount(false);
    expect(panel()).toBeNull();
  });

  it("opens by itself when a pending item arrives, even after the owner folded it", async () => {
    await empty();
    await mount();
    expect(panel()).toBeNull();
    mock.api.directorHandovers!.mockResolvedValue(
      ok({
        items: [
          {
            id: "h",
            askId: "ask-1",
            from: "old",
            to: "new",
            revision: 0,
            state: "pending",
            provenanceKnown: true,
          },
        ],
      }),
    );
    await act(async () =>
      mock.callback?.({
        hostId: "local",
        envelope: { cutex: { method: "cutex/project/handoverUpdated" } },
      }),
    );
    expect(panel().dataset.open).toBe("true");
    expect(button("接管")).toBeTruthy();
  });

  it("with pending items it starts open", async () => {
    await mount();
    expect(panel().dataset.open).toBe("true");
    expect(el.querySelector('[data-testid="director-panel-quiet"]')).toBeNull();
  });

  it("ignores retained manual expansion and scope UI after the last actionable item settles", async () => {
    await mount();
    await click("项目交接");
    await click("项目交接");
    await click("选择历史范围");
    expect(panel().dataset.open).toBe("true");
    await empty();
    await act(async () => mock.callback?.({ hostId: "local", envelope: { cutex: { method: "cutex/project/handoverUpdated" } } }));
    expect(panel()).toBeNull();
    expect(el.textContent).not.toContain("选择历史范围");
    // The same retained component still responds to new owner work.
    mock.api.directorStartReviews!.mockResolvedValue(ok({ items: [{ ...start, state: "deliveryUnknown" }] }));
    await act(async () => mock.callback?.({ hostId: "local", envelope: { cutex: { method: "cutex/project/handoverUpdated" } } }));
    expect(panel().dataset.open).toBe("true");
  });

  const change = (at: string, changeId = "notice-1") => ({ changeId, projectId: "p", oldDirector: "old", newDirector: "new", state: "finalized", preparedAt: at, settledAt: at, reason: "ownerAssigned", oldEpoch: 7, newEpoch: 8 });
  it("shows recent notices separately; dismissal survives remount and a different notice still shows", async () => {
    await empty();
    const at = new Date(Date.now() - 3 * 86400_000).toISOString();
    mock.api.projectDirector!.mockResolvedValue(ok({ ...director(), changes: [change(at)] }));
    await mount();
    expect(panel()).toBeNull();
    expect(el.querySelectorAll('[data-testid="director-change-notice"]')).toHaveLength(1);
    await click("知道了");
    expect(el.querySelector('[data-testid="director-change-notice"]')).toBeNull();
    await act(async () => root.render(null));
    await mount();
    expect(el.querySelector('[data-testid="director-change-notice"]')).toBeNull();
    mock.api.projectDirector!.mockResolvedValue(ok({ ...director(), changes: [change(at), change(at, "notice-2")] }));
    await act(async () => mock.callback?.({ hostId: "local", envelope: { cutex: { method: "cutex/project/directorChanged" } } }));
    expect(el.querySelectorAll('[data-testid="director-change-notice"]')).toHaveLength(1);
    await mount(true);
    expect(el.textContent).toContain("notice-1");
    expect(el.textContent).toContain("notice-2");
  });

  it("expires at seven days, including a view left mounted; retains history", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-10-29T00:00:00Z");
    vi.setSystemTime(now);
    await empty();
    const at = new Date(now - 7 * 86400_000 + 30_000).toISOString();
    mock.api.projectDirector!.mockResolvedValue(ok({ ...director(), changes: [change(at)] }));
    await mount();
    expect(el.querySelector('[data-testid="director-change-notice"]')).not.toBeNull();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(el.querySelector('[data-testid="director-change-notice"]')).toBeNull();
    expect(panel()).toBeNull();
    await mount(true);
    expect(el.textContent).toContain("notice-1");
    hidden.mockRestore();
  });

  it("does not show expired, invalid, future, or unfinalized notices on initial load", async () => {
    await empty();
    const old = new Date(Date.now() - 8 * 86400_000).toISOString();
    const future = new Date(Date.now() + 86400_000).toISOString();
    mock.api.projectDirector!.mockResolvedValue(ok({ ...director(), changes: [change(old), change("invalid", "bad"), change(future, "future"), { ...change(new Date().toISOString(), "prepared"), state: "prepared" }] }));
    await mount();
    expect(el.innerHTML).toBe("");
  });
});

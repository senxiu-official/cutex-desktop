// @vitest-environment jsdom
// Turn-error surface (cutex `turn-error-surface`, contract 2026-11-04; lib/turnErrorSurface,
// components/TurnErrorSurface): the agent list badge and the conversation header banner for a session whose
// `activity.lastTurnError` is set — shown only when the host advertises the feature, wording per code,
// 重新登录 only when an unauthorized-family failure repeats, 查看 jumps to the failed turn, gone on null.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ jumps: [] as unknown[][] }));

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/jump", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  jumpToTurn: (...args: unknown[]) => {
    fx.jumps.push(args);
    return Promise.resolve({ status: "focused" });
  },
}));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOpenPage: () => null,
  usePageOf: () => null,
  useSlot: () => [],
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { AgentRowButton } from "../src/renderer/src/components/AgentRows";
import { ConversationHeader } from "../src/renderer/src/components/ConversationHeader";
import { TurnErrorBanner } from "../src/renderer/src/components/TurnErrorSurface";
import { laterTurnStarted } from "../src/renderer/src/lib/turnErrorBanner";
import { emptyTimeline, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { viewKey } from "../src/renderer/src/lib/viewKey";
import { TURN_ERROR_SURFACE_FEATURE, lastTurnErrorOf, offersRelogin, truncateMessage, turnErrorSummary, turnErrorSurfaceOn, type LastTurnError } from "../src/renderer/src/lib/turnErrorSurface";
import { mockScenarioFeatures } from "../src/renderer/src/dev/mockFeatures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REFRESH = "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.";

function err(over: Partial<LastTurnError> = {}): LastTurnError {
  return { turnId: "t-fail", message: REFRESH, code: "refresh_token_reused", codexErrorInfo: "unauthorized", at: "2026-11-04T05:27:25.123Z", consecutive: 1, ...over };
}

function session(id: string, lastTurnError: LastTurnError | null | undefined): SessionResource {
  return {
    cutexSessionId: id,
    displayName: `Agent ${id}`,
    formalAgentName: `Agent ${id}`,
    registrationClass: null,
    lifecycle: "active",
    revision: 1,
    cwd: `/home/ema/${id}`,
    note: null,
    avatar: null,
    profile: "gamma",
    configuredProfile: "gamma",
    launchedProfile: "gamma",
    native: { threadId: `thread-${id}`, schema: null },
    runtime: { status: "online" },
    activity: lastTurnError === undefined ? { lastConversationAt: "2026-11-04T05:27:25Z" } : { lastConversationAt: "2026-11-04T05:27:25Z", lastTurnError },
  } as unknown as SessionResource;
}

function sidebar(sessions: SessionResource[]): SidebarSnapshot {
  return { active: sessions, retired: [], hostRows: {}, projects: { projects: [] } } as unknown as SidebarSnapshot;
}

/** The catalogs' text with `{var}` filled (what the I18nProvider renders for zh-CN / en). */
const tOf = (catalog: Record<string, string>) => (key: string, vars?: Record<string, string | number>) =>
  catalog[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
const tZh = tOf(zhCN as Record<string, string>) as Parameters<typeof turnErrorSummary>[0];
const tEn = tOf(en as Record<string, string>) as Parameters<typeof turnErrorSummary>[0];

describe("lastTurnError (pure)", () => {
  it("reads the field defensively; absent / null / malformed = none", () => {
    expect(lastTurnErrorOf(session("a", err()))).toEqual(err());
    expect(lastTurnErrorOf(session("a", null))).toBeNull();
    expect(lastTurnErrorOf(session("a", undefined))).toBeNull();
    expect(lastTurnErrorOf({ activity: null })).toBeNull();
    expect(lastTurnErrorOf({ activity: { lastTurnError: { message: "no turn id" } } })).toBeNull();
    expect(lastTurnErrorOf({ activity: { lastTurnError: { turnId: "t", consecutive: "x" } } })).toMatchObject({ turnId: "t", code: "other", consecutive: 1, message: "" });
  });

  it("the feature gate takes the kebab and the camel spelling", () => {
    expect(turnErrorSurfaceOn(new Set([TURN_ERROR_SURFACE_FEATURE]))).toBe(true);
    expect(turnErrorSurfaceOn(new Set(["turnErrorSurface"]))).toBe(true);
    expect(turnErrorSurfaceOn(new Set(["admission-order"]))).toBe(false);
    expect(turnErrorSurfaceOn(null)).toBe(false);
  });

  it("re-login only when an unauthorized-family failure repeats (consecutive >= 2)", () => {
    expect(offersRelogin(err({ consecutive: 1 }))).toBe(false);
    expect(offersRelogin(err({ consecutive: 2 }))).toBe(true);
    expect(offersRelogin(err({ code: "unauthorized", consecutive: 1 }))).toBe(false);
    expect(offersRelogin(err({ code: "unauthorized", consecutive: 3 }))).toBe(true);
    expect(offersRelogin(err({ code: "httpConnectionFailed", consecutive: 5 }))).toBe(false);
    expect(offersRelogin(err({ code: "other", consecutive: 2 }))).toBe(false);
  });

  it("wording: refresh_token_reused is the concurrent refresh clash, unauthorized the login, others their message", () => {
    expect(turnErrorSummary(tZh, err())).toBe("上一回合失败：并发刷新冲突；下一条消息会自动重试");
    expect(turnErrorSummary(tEn, err())).toBe("The last turn failed: a concurrent refresh clash; the next message retries automatically");
    expect(turnErrorSummary(tZh, err({ consecutive: 2 }))).toBe("连续 2 个回合失败：并发刷新冲突；下一条消息会自动重试");
    expect(turnErrorSummary(tZh, err({ code: "unauthorized", message: "401" }))).toBe("上一回合失败：登录未通过验证；如果再次出现，可能需要重新登录");
    expect(turnErrorSummary(tEn, err({ code: "unauthorized", consecutive: 2 }))).toBe("2 turns in a row failed: the sign-in was not accepted; the login may need renewing");
    expect(turnErrorSummary(tZh, err({ code: "httpConnectionFailed", message: "stream disconnected" }))).toBe("上一回合失败：stream disconnected");
    expect(turnErrorSummary(tEn, err({ code: "other", message: "" }))).toBe("The last turn failed: other");
    const long = "x".repeat(400);
    expect(truncateMessage(long)).toHaveLength(160);
    expect(truncateMessage(long).endsWith("…")).toBe(true);
    expect(turnErrorSummary(tZh, err({ code: "other", message: long })).length).toBeLessThan(200);
  });
});

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  useApp.setState({ sessions: {} });
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  fx.jumps.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
}

function setHost(sessions: SessionResource[], features: string[]) {
  useApp.setState({ hosts: null, selectedId: null, sidebar: sidebar(sessions), features: new Set(features), byHost: {} as never });
}

const row = (s: SessionResource) => ({ id: s.cutexSessionId, name: s.displayName, subtitle: "", status: "idle", isDirector: false, pinned: false, lastActivity: 0, profile: null, color: null, session: s });
const header = (sessionId: string) => h(ConversationHeader, { paneId: "main", hostId: "local", sessionId, focused: true, closable: false, maxed: false, framed: false });
const banner = () => container.querySelector<HTMLElement>('[data-testid="turn-error-banner"]');
const badge = () => container.querySelector<HTMLElement>('[data-testid="turn-error-badge"]');

describe("agent list badge", () => {
  it("shown with the feature and the field; the summary is its tooltip", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    await render(h(AgentRowButton, { row: row(s) as never }));
    expect(badge()).not.toBeNull();
    expect(badge()!.getAttribute("title")).toBe("上一回合失败：并发刷新冲突；下一条消息会自动重试");
    expect(badge()!.getAttribute("data-turn-error-code")).toBe("refresh_token_reused");
  });

  it("hidden without the field, with a null field, and on an older host (no feature) even with the field", async () => {
    setHost([session("a", undefined)], [TURN_ERROR_SURFACE_FEATURE]);
    await render(h(AgentRowButton, { row: row(session("a", undefined)) as never }));
    expect(badge()).toBeNull();
    await render(h(AgentRowButton, { row: row(session("b", null)) as never }));
    expect(badge()).toBeNull();
    setHost([session("c", err())], []);
    await render(h(AgentRowButton, { row: row(session("c", err())) as never }));
    expect(badge()).toBeNull();
  });
});

describe("agent list badge after the agent moved on (owner decision 2026-11-05)", () => {
  const running = (s: SessionResource, turnId: string) => ({ ...s, runtime: { status: "online", activeTurnId: turnId } }) as unknown as SessionResource;
  const showBadge = async (s: SessionResource) => render(h(AgentRowButton, { row: row(s) as never }));

  it("failed, then a later turn started (a requeued delegation): gone, and stays gone after that turn ends", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    await showBadge(s);
    expect(badge()).not.toBeNull();
    await showBadge(running(s, "t-retry"));
    expect(badge()).toBeNull();
    // That turn ended (interrupted: cutex keeps lastTurnError): no badge back for the same failure.
    await showBadge(s);
    expect(badge()).toBeNull();
    // The failed turn itself still reported as active (a stale snapshot) does not hide it.
    await showBadge(running(session("b", err()), "t-fail"));
    expect(badge()).not.toBeNull();
  });

  it("failed, opened: the open conversation settles the list badge", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    await showBadge(s);
    expect(badge()).not.toBeNull();
    await render(h(TurnErrorBanner, { session: s, hostId: "local" }));
    expect(banner()).not.toBeNull(); // the banner still explains it while open
    await showBadge(s);
    expect(badge()).toBeNull();
  });

  it("failed, started, failed again: a new failure shows the badge again", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    await showBadge(running(s, "t-retry"));
    expect(badge()).toBeNull();
    await showBadge(session("a", err({ turnId: "t-retry", consecutive: 2 })));
    expect(badge()).not.toBeNull();
  });

  it("per host, and another window settling it (storage event) hides it here too", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    localStorage.setItem('cutex-desktop.turnErrorBadge.settled:["other","a"]', "t-fail");
    await showBadge(s);
    expect(badge()).not.toBeNull();
    await act(async () => {
      localStorage.setItem('cutex-desktop.turnErrorBadge.settled:["local","a"]', "t-fail");
      window.dispatchEvent(new StorageEvent("storage", { key: 'cutex-desktop.turnErrorBadge.settled:["local","a"]' }));
    });
    expect(badge()).toBeNull();
  });
});

describe("conversation header banner", () => {
  it("dismisses this failure across remount/reconnect, leaves history intact, and shows a new failure", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    const timeline = timelineFromThreadRead({ thread: { id: "thread-a", turns: [{ id: "t-fail", status: "failed", items: [], error: { message: "Connection failed" } }] } });
    useApp.setState({ sessions: { [viewKey("local", "a")]: { timeline } } } as never);
    await render(h(TurnErrorBanner, { session: s, hostId: "local" }));
    const close = banner()!.querySelector<HTMLButtonElement>("[data-turn-error-dismiss]")!;
    expect(close.getAttribute("aria-label")).toBe("关闭");
    await act(async () => close.click());
    expect(banner()).toBeNull();
    expect(timeline.turns[0]?.error).toBe("Connection failed");
    expect(localStorage.getItem('cutex-desktop.turnErrorBanner.hidden:["local","a","t-fail"]')).toBe("1");
    await render(null);
    useApp.setState({ sessions: {} });
    await render(h(TurnErrorBanner, { session: session("a", err()), hostId: "local" }));
    expect(banner()).toBeNull();
    await render(h(TurnErrorBanner, { session: session("a", err({ turnId: "new-failure" })), hostId: "local" }));
    expect(banner()).not.toBeNull();
  });

  it("hides on a later running turn and remembers it after the view is unloaded and reconnected", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    const timeline = emptyTimeline();
    timeline.turns = [{ id: "t-fail", status: "failed", startedAt: null, completedAt: null, entryIds: [], error: "Connection failed" }];
    useApp.setState({ sessions: { [viewKey("local", "a")]: { timeline } } } as never);
    await render(h(TurnErrorBanner, { session: s, hostId: "local" }));
    expect(banner()).not.toBeNull();
    timeline.turns.push({ id: "new-running", status: "inProgress", startedAt: null, completedAt: null, entryIds: [] });
    timeline.activeTurnId = "new-running";
    await act(async () => useApp.setState({ sessions: { [viewKey("local", "a")]: { timeline, version: 1 } } } as never));
    expect(banner()).toBeNull();
    await render(null);
    useApp.setState({ sessions: {} });
    await render(h(TurnErrorBanner, { session: session("a", err()), hostId: "local" }));
    expect(banner()).toBeNull();
    // The next failure is not hidden by the earlier running turn's snapshot.
    useApp.setState({ sessions: { [viewKey("local", "a")]: { timeline } } } as never);
    await render(h(TurnErrorBanner, { session: session("a", err({ turnId: "new-running" })), hostId: "local" }));
    expect(banner()).not.toBeNull();
  });

  it("derives suppression from reloaded history without having observed the live start", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    const timeline = emptyTimeline();
    timeline.turns = ["t-fail", "next-interrupted"].map(id => ({ id, status: "interrupted", startedAt: null, completedAt: null, entryIds: [] }));
    useApp.setState({ sessions: { [viewKey("local", "a")]: { timeline } } } as never);
    await render(h(TurnErrorBanner, { session: s, hostId: "local" }));
    expect(banner()).toBeNull();
  });

  it("keeps dismissals separate for different agents and hosts", async () => {
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    useApp.setState({ byHost: { remote: { features: new Set([TURN_ERROR_SURFACE_FEATURE]) } } } as never);
    await render(h(TurnErrorBanner, { session: s, hostId: "local" }));
    await act(async () => banner()!.querySelector<HTMLButtonElement>("[data-turn-error-dismiss]")!.click());
    await render(h(TurnErrorBanner, { session: session("b", err()), hostId: "local" }));
    expect(banner()).not.toBeNull();
    await render(h(TurnErrorBanner, { session: s, hostId: "remote" }));
    expect(banner()).not.toBeNull();
  });

  it("uses the existing localized close label in English", async () => {
    localStorage.setItem("cutex-desktop.locale", "en");
    const s = session("a", err());
    setHost([s], [TURN_ERROR_SURFACE_FEATURE]);
    await render(h(TurnErrorBanner, { session: s, hostId: "local" }));
    expect(banner()!.querySelector("[data-turn-error-dismiss]")?.getAttribute("aria-label")).toBe("Close");
    expect(banner()!.querySelector("[data-turn-error-view]")?.textContent).toBe("View");
  });

  it("refresh_token_reused once: the clash wording and 查看, no 重新登录", async () => {
    setHost([session("a", err())], [TURN_ERROR_SURFACE_FEATURE]);
    await render(header("a"));
    expect(banner()?.textContent).toContain("上一回合失败：并发刷新冲突；下一条消息会自动重试");
    expect(banner()?.querySelector("[data-turn-error-summary]")?.getAttribute("title")).toBe(REFRESH);
    expect(banner()?.querySelector("[data-turn-error-view]")?.textContent).toBe("查看");
    expect(banner()?.querySelector("[data-turn-error-relogin]")).toBeNull();
    // The header row itself is unchanged (the banner is its sibling, below it).
    expect(container.querySelector('[data-conv-header="main"]')?.nextElementSibling).toBe(banner());
  });

  it("refresh_token_reused twice: 重新登录 opens the agent's Profile page (account rows)", async () => {
    setHost([session("a", err({ consecutive: 2 }))], [TURN_ERROR_SURFACE_FEATURE]);
    const openSettings = vi.fn();
    useApp.setState({ openSettings } as never);
    await render(header("a"));
    expect(banner()?.textContent).toContain("连续 2 个回合失败：并发刷新冲突");
    const relogin = banner()!.querySelector<HTMLButtonElement>("[data-turn-error-relogin]")!;
    expect(relogin.textContent).toBe("重新登录");
    expect(relogin.title).toBe("打开 Profile「gamma」的账户设置");
    await act(async () => relogin.click());
    expect(openSettings).toHaveBeenCalledWith("profiles", { profile: "gamma", anchor: "account" });
  });

  it("unauthorized: re-login only from the second consecutive failure", async () => {
    setHost([session("a", err({ code: "unauthorized", message: "401 Unauthorized" }))], [TURN_ERROR_SURFACE_FEATURE]);
    await render(header("a"));
    expect(banner()?.textContent).toContain("登录未通过验证；如果再次出现，可能需要重新登录");
    expect(banner()?.querySelector("[data-turn-error-relogin]")).toBeNull();
    setHost([session("a", err({ code: "unauthorized", consecutive: 2 }))], [TURN_ERROR_SURFACE_FEATURE]);
    await render(header("a"));
    expect(banner()?.textContent).toContain("连续 2 个回合失败：登录未通过验证，可能需要重新登录");
    expect(banner()?.querySelector("[data-turn-error-relogin]")).not.toBeNull();
  });

  it("another code: the generic summary with the (truncated) message, never 重新登录", async () => {
    const message = `stream disconnected before completion: ${"y".repeat(300)}`;
    setHost([session("a", err({ code: "httpConnectionFailed", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } }, message, consecutive: 4 }))], [TURN_ERROR_SURFACE_FEATURE]);
    await render(header("a"));
    const summary = banner()!.querySelector("[data-turn-error-summary]")!;
    expect(summary.textContent).toMatch(/^连续 4 个回合失败：stream disconnected before completion: y+…$/);
    expect(summary.getAttribute("title")).toBe(message);
    expect(banner()?.querySelector("[data-turn-error-relogin]")).toBeNull();
  });

  it("查看 jumps to the failed turn (lib/jump pages older history in and focuses it)", async () => {
    setHost([session("a", err({ turnId: "01a1a506-be96" }))], [TURN_ERROR_SURFACE_FEATURE]);
    await render(header("a"));
    await act(async () => banner()!.querySelector<HTMLButtonElement>("[data-turn-error-view]")!.click());
    expect(fx.jumps).toEqual([["local", "a", "01a1a506-be96"]]);
  });

  it("cleared as soon as lastTurnError becomes null (a later turn completed)", async () => {
    setHost([session("a", err())], [TURN_ERROR_SURFACE_FEATURE]);
    await render(header("a"));
    expect(banner()).not.toBeNull();
    await act(async () => setHost([session("a", null)], [TURN_ERROR_SURFACE_FEATURE]));
    expect(banner()).toBeNull();
    expect(container.querySelector('[data-conv-header="main"]')).not.toBeNull();
  });

  it("older host (no feature): no banner, the header renders as before", async () => {
    setHost([session("a", err({ consecutive: 3 }))], []);
    await render(header("a"));
    expect(banner()).toBeNull();
    expect(container.querySelector('[data-conv-header="main"]')?.nextElementSibling).toBeNull();
  });
});

describe("later-turn evidence", () => {
  const turn = (id: string, startedAt: number | null) => ({ id, startedAt, completedAt: null, status: "inProgress" as const, entryIds: [] });
  it("uses timestamps when the failed turn is paged out, without mistaking older history for a retry", () => {
    const at = Date.parse(err().at!) / 1000;
    expect(laterTurnStarted(err(), { turns: [turn("new", at + 1)], activeTurnId: null })).toBe(true);
    expect(laterTurnStarted(err(), { turns: [turn("old", at - 1)], activeTurnId: null })).toBe(false);
    expect(laterTurnStarted(err(), { turns: [turn("old", at - 1)], activeTurnId: "old" })).toBe(false);
    expect(laterTurnStarted(err(), { turns: [turn("old", null)], activeTurnId: "old" })).toBe(false);
  });
  it("uses the runtime active ID before history loads and ignores the failed turn itself", () => {
    expect(laterTurnStarted(err(), undefined, "next")).toBe(true);
    expect(laterTurnStarted(err(), undefined, "t-fail")).toBe(false);
    expect(laterTurnStarted(err(), undefined)).toBe(false);
  });
});

describe("mock preview", () => {
  it("?turnerror advertises the feature; legacy / no-turn-error-surface do not", () => {
    expect(mockScenarioFeatures("?turnerror")).toContain(TURN_ERROR_SURFACE_FEATURE);
    expect(mockScenarioFeatures("?turnerror&no-turn-error-surface")).not.toContain(TURN_ERROR_SURFACE_FEATURE);
    expect(mockScenarioFeatures("?turnerror&legacy")).not.toContain(TURN_ERROR_SURFACE_FEATURE);
    expect(mockScenarioFeatures("")).not.toContain(TURN_ERROR_SURFACE_FEATURE);
  });
});

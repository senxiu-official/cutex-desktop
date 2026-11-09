// 转为智能体 (cutex quick-chat-promote-v1): wire helpers, plain words for every contract code, the offer rule,
// the identical-request retry after `complete: false`, and the mock host.
import { describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../src/shared/ipc";
import { promoteDoneOf, promoteErrorKey, QUICK_CHAT_PROMOTE_FEATURE, validPromoteRequest, validPromoteTarget, type PromoteRequest, type PromoteResult } from "../src/shared/quickChatPromote";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const api = { promoteQuickChat: vi.fn<(id: string, r: PromoteRequest) => Promise<PromoteResult>>() };
const refreshHostSidebar = vi.fn(async () => {});
vi.mock("../src/renderer/src/store", () => ({
  hostApi: () => api,
  useApp: { getState: () => ({ refreshHostSidebar }) },
  featuresOf: () => new Set<string>(),
  sidebarOf: () => null,
}));
const { promoteNameProblem, promoteOffered, sendPromote, chatRunning } = await import("../src/renderer/src/lib/quickChatPromote");
const { mockPromote } = await import("../src/renderer/src/dev/mockQuickChatPromote");

const CODES = ["invalid_request", "agent_name_invalid", "session_not_found", "project_not_found", "revision_conflict", "not_quick_chat", "quick_chat_running", "project_not_active", "agent_name_conflict", "agent_name_reserved", "ambiguous_native_identity", "promotion_in_progress", "request_id_payload_conflict", "unsupported_quick_chat", "admission_busy", "persistence_unavailable", "transport"];
const request: PromoteRequest = { requestId: "promote-1", expectedRevision: 4, name: "Researcher", projectId: null };
const chat = (over: Partial<SessionResource> = {}) => ({ cutexSessionId: "cutex.chat", displayName: "Fix the build", registrationClass: "local_only", formalAgentName: null, lifecycle: "active", revision: 4, runtime: { status: "offline" }, ...over }) as unknown as SessionResource;

describe("wire helpers", () => {
  it("validates like the contract: requestId 1–256 without control characters, positive revision, name rules, project or null", () => {
    expect(validPromoteTarget("cutex.ag-1")).toBe(true);
    expect(validPromoteTarget("a/b")).toBe(false);
    expect(validPromoteRequest(request)).toBe(true);
    expect(validPromoteRequest({ ...request, projectId: "p1" })).toBe(true);
    expect(validPromoteRequest({ ...request, requestId: "x".repeat(257) })).toBe(false);
    expect(validPromoteRequest({ ...request, requestId: "a\nb" })).toBe(false);
    expect(validPromoteRequest({ ...request, expectedRevision: 0 })).toBe(false);
    expect(validPromoteRequest({ ...request, name: "  " })).toBe(false);
    expect(validPromoteRequest({ ...request, name: "x".repeat(129) })).toBe(false);
    expect(validPromoteRequest({ ...request, projectId: "" })).toBe(false);
  });
  it("reads the 200 body only when it answers this request", () => {
    const body = { requestId: "promote-1", cutexSessionId: "cutex.chat", name: "Researcher", projectId: null, revision: 5, complete: false, error: "import pending" };
    expect(promoteDoneOf(body, request, "cutex.chat")).toEqual({ cutexSessionId: "cutex.chat", name: "Researcher", projectId: null, revision: 5, complete: false, error: "import pending" });
    expect(promoteDoneOf({ ...body, requestId: "other" }, request, "cutex.chat")).toBeNull();
    expect(promoteDoneOf({ ...body, cutexSessionId: "cutex.x" }, request, "cutex.chat")).toBeNull();
  });
  it("every contract error code has its own plain sentence in zh-CN and en", () => {
    for (const code of CODES) {
      const key = promoteErrorKey(code);
      expect(key, code).not.toBe("promote.error.other");
      expect(zhCN[key as keyof typeof zhCN], code).toBeTruthy();
      expect(en[key as keyof typeof en], code).toBeTruthy();
    }
    for (const key of ["promote.error.incomplete", "promote.error.stopFailed", "promote.error.other"]) expect(zhCN[key as keyof typeof zhCN]).toBeTruthy();
  });
});

describe("offer and name check", () => {
  const features = new Set([QUICK_CHAT_PROMOTE_FEATURE]);
  it("only for an active quick chat, on a host with the capability, for the owner", () => {
    expect(promoteOffered(features, chat(), undefined)).toBe(true);
    expect(promoteOffered(new Set(), chat(), undefined)).toBe(false);
    expect(promoteOffered(new Set([QUICK_CHAT_PROMOTE_FEATURE, "desktop:restricted"]), chat(), undefined)).toBe(false);
    expect(promoteOffered(features, chat({ formalAgentName: "Mira" }), undefined)).toBe(false);
    expect(promoteOffered(features, chat({ lifecycle: "retired" } as Partial<SessionResource>), undefined)).toBe(false);
  });
  it("names: empty / too long / control / taken on this host (case-insensitive)", () => {
    const taken = new Set(["mira"]);
    expect(promoteNameProblem(" ", taken)).toBe("empty");
    expect(promoteNameProblem("x".repeat(129), taken)).toBe("tooLong");
    expect(promoteNameProblem("a\tb", taken)).toBe("control");
    expect(promoteNameProblem(" MIRA ", taken)).toBe("taken");
    expect(promoteNameProblem("Researcher", taken)).toBeNull();
  });
  it("running means a bound runtime (online or starting)", () => {
    expect(chatRunning(chat({ runtime: { status: "online" } } as Partial<SessionResource>))).toBe(true);
    expect(chatRunning(chat({ runtime: { status: "starting" } } as Partial<SessionResource>))).toBe(true);
    expect(chatRunning(chat())).toBe(false);
  });
});

describe("sendPromote", () => {
  it("complete:false sends the identical request again, then succeeds; the sidebar is read again", async () => {
    api.promoteQuickChat.mockReset();
    refreshHostSidebar.mockClear();
    const half = { ok: true as const, result: { cutexSessionId: "cutex.chat", name: "Researcher", projectId: null, revision: 5, complete: false, error: "pending" } };
    api.promoteQuickChat.mockResolvedValueOnce(half).mockResolvedValueOnce({ ok: true, result: { ...half.result, complete: true, error: null } });
    const out = await sendPromote("local", "cutex.chat", request, async () => {});
    expect(out.ok).toBe(true);
    expect(api.promoteQuickChat.mock.calls.map((c) => c[1])).toEqual([request, request]);
    expect(api.promoteQuickChat.mock.calls[1]![1]).toBe(request);
    expect(refreshHostSidebar).toHaveBeenCalledWith("local");
  });
  it("still incomplete after the retries: reported with the same request to retry", async () => {
    api.promoteQuickChat.mockReset();
    api.promoteQuickChat.mockResolvedValue({ ok: true, result: { cutexSessionId: "cutex.chat", name: "Researcher", projectId: null, revision: 5, complete: false, error: "pending" } });
    const out = await sendPromote("local", "cutex.chat", request, async () => {});
    expect(out).toMatchObject({ ok: false, error: { code: "incomplete", retrySame: true }, request });
    expect(api.promoteQuickChat).toHaveBeenCalledTimes(3);
  });
  it("a refusal ends it at once", async () => {
    api.promoteQuickChat.mockReset();
    api.promoteQuickChat.mockResolvedValue({ ok: false, error: { code: "agent_name_conflict", message: "taken", retrySame: false } });
    const out = await sendPromote("local", "cutex.chat", request, async () => {});
    expect(out).toMatchObject({ ok: false, error: { code: "agent_name_conflict" } });
    expect(api.promoteQuickChat).toHaveBeenCalledTimes(1);
  });
});

describe("mock host", () => {
  const sidebar = (status = "offline") => ({
    active: [chat({ runtime: { status } } as Partial<SessionResource>), { cutexSessionId: "cutex.mira", displayName: "Mira", formalAgentName: "Mira", registrationClass: "persistent", lifecycle: "active", revision: 1, runtime: { status: "online" } }],
    retired: [],
    hostRows: { "cutex.chat": { kind: "Session", projectId: null }, "cutex.mira": { kind: "Agent", projectId: null } },
    projects: { projects: [{ project_id: "p1", lifecycle: "active", presentation: { display_name: "Alpha" } }] },
  }) as unknown as SidebarSnapshot;
  it("promotes into a project in place, and refuses running chats, taken / reserved / invalid names", () => {
    expect(mockPromote(sidebar("online"), "cutex.chat", { ...request, requestId: "m1" }).reply).toMatchObject({ ok: false, error: { code: "quick_chat_running" } });
    expect(mockPromote(sidebar(), "cutex.chat", { ...request, requestId: "m2", name: "mira" }).reply).toMatchObject({ ok: false, error: { code: "agent_name_conflict" } });
    expect(mockPromote(sidebar(), "cutex.chat", { ...request, requestId: "m3", name: "Nova" }).reply).toMatchObject({ ok: false, error: { code: "agent_name_reserved" } });
    expect(mockPromote(sidebar(), "cutex.chat", { ...request, requestId: "m4", name: "x@y" }).reply).toMatchObject({ ok: false, error: { code: "agent_name_invalid" } });
    const { snapshot, reply } = mockPromote(sidebar(), "cutex.chat", { ...request, requestId: "m5", projectId: "p1" });
    expect(reply).toMatchObject({ ok: true, result: { complete: true, projectId: "p1", revision: 5 } });
    expect(snapshot.active.find((s) => s.cutexSessionId === "cutex.chat")).toMatchObject({ formalAgentName: "Researcher", revision: 5 });
    expect(snapshot.hostRows["cutex.chat"]).toMatchObject({ kind: "Agent", projectId: "p1", projectName: "Alpha" });
    // The same requestId with another body is refused; the same request replays.
    expect(mockPromote(snapshot, "cutex.chat", { ...request, requestId: "m5", projectId: "p1" }).reply).toEqual(reply);
    expect(mockPromote(snapshot, "cutex.chat", { ...request, requestId: "m5", name: "Other", projectId: "p1" }).reply).toMatchObject({ ok: false, error: { code: "request_id_payload_conflict" } });
  });
});

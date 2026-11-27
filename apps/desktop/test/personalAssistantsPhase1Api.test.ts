import { expect, it, vi } from "vitest";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import { personalAssistantsApi } from "../src/main/personalAssistantsApi";
import { ownerPinCreateBody, paBriefScheduleBody, paScopeRulesBody, readPaBrief, readPaScopeRules } from "../src/shared/personalAssistantsPhase1";
const reference = { instanceId: "eva", projectId: "project" };
const rules = [{ id: "rule-1", scope: { kind: "project" as const, ref: reference }, role: "observe" as const }];
it("validates scope rules and refuses malformed effective roles instead of inventing a default", () => {
  expect(paScopeRulesBody({ actionId: "save", expectedRevision: 0, rules })).toEqual({ actionId: "save", expectedRevision: 0, rules });
  expect(() => paScopeRulesBody({ actionId: "save", expectedRevision: 0, rules: [rules[0]!, rules[0]!] })).toThrow();
  expect(() => readPaScopeRules({ revision: 1, rules, effective: [{ ref: reference, role: "owner", ruleId: null }] })).toThrow();
  expect(() => readPaScopeRules({})).toThrow();
});
it("validates explicit daily times, zones, disabled schedules and complete latest briefs", () => {
  expect(paBriefScheduleBody({ actionId: "save", expectedRevision: 0, times: [], timezone: null }).times).toEqual([]);
  expect(() => paBriefScheduleBody({ actionId: "save", expectedRevision: 0, times: ["24:00"], timezone: null })).toThrow();
  expect(() => paBriefScheduleBody({ actionId: "save", expectedRevision: 0, times: ["08:00"], timezone: "Invalid/Zone" })).toThrow();
  expect(() => readPaBrief({ revision: 1, times: [], timezone: null })).toThrow();
});
it("reads a brief's pending run and stale mark, and an older host without them as none / not stale", () => {
  const base = { revision: 2, times: ["08:00"], timezone: null, latest: null };
  expect(readPaBrief(base)).toMatchObject({ pending: null, stale: false });
  expect(readPaBrief({ ...base, pending: null, stale: false })).toMatchObject({ pending: null, stale: false });
  expect(readPaBrief({ ...base, pending: { runId: "run-1", scheduledAt: "2026-11-28T08:00:00+11:00", queued: true }, stale: true })).toMatchObject({ pending: { runId: "run-1", scheduledAt: "2026-11-28T08:00:00+11:00", queued: true }, stale: true });
  expect(() => readPaBrief({ ...base, pending: { runId: "run-1", scheduledAt: "2026-11-28T08:00:00+11:00" } })).toThrow();
  expect(() => readPaBrief({ ...base, pending: { runId: "", scheduledAt: "2026-11-28T08:00:00+11:00", queued: false } })).toThrow();
  expect(() => readPaBrief({ ...base, stale: "yes" })).toThrow();
});
it("rebuilds fixed owner note bodies without trusting an author supplied by a caller", () => {
  expect(ownerPinCreateBody({ actionId: "capture", kind: "note", title: "memo", detail: null, agentId: null, author: "agent" } as never)).toEqual({ actionId: "capture", kind: "note", title: "memo", detail: null, agentId: null });
  expect(() => ownerPinCreateBody({ actionId: "capture", kind: "decide", title: "memo", detail: null, agentId: null } as never)).toThrow();
});
it("calls only the fixed scope, brief and reminder routes with checked inputs and replies", async () => {
  const request = vi.fn(async (_method: string, path: string) => path.endsWith("scope-rules") ? { revision: 1, rules, effective: [] } : path.endsWith("brief") ? { revision: 0, times: [], timezone: null, latest: null } : { alarmId: "a", at: "2026-12-01T00:00:00Z", message: "remember", state: "scheduled" });
  const api = personalAssistantsApi({ request } as unknown as CutexClient);
  await api.paScopeRules("pa-1");
  await api.paScopeRulesSave("pa-1", { actionId: "save", expectedRevision: 0, rules });
  await api.paBrief("pa-1");
  await api.paBriefSchedule("pa-1", { actionId: "schedule", expectedRevision: 0, times: [], timezone: null });
  await api.paReminderCreate("pa-1", { actionId: "remind", at: "2026-12-01T00:00:00Z", message: "remember" });
  expect(request.mock.calls.map(([method, path]) => [method, path])).toEqual([["GET", "/v2/personal-assistants/pa-1/scope-rules"], ["PUT", "/v2/personal-assistants/pa-1/scope-rules"], ["GET", "/v2/personal-assistants/pa-1/brief"], ["PUT", "/v2/personal-assistants/pa-1/brief"], ["POST", "/v2/personal-assistants/pa-1/reminders"]]);
});

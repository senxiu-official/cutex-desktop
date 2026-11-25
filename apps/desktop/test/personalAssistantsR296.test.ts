// 个人助理 on cutex updated (contract v4: recurring templates, qualified project refs, owner views, change events):
// main's fixed routes and checked bodies (templates POST vs PUT, pause / cancel, runs, notes, the owner request query,
// the calendar import within its limits), the replies as read, the renderer's model (re-confirm reasons, run outcomes,
// host-local time, the cross-host gate), the .ics / JSON snapshot reader, and the store's updated read path (list rows
// instead of detail reads, newest requests, change events read only what they name).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { personalAssistantsApi } from "../src/main/personalAssistantsApi";
import {
  PA_CALENDAR_EVENTS_MAX, paCalendarBody, paCalendarProblem, paCreateBody, paOwnerRequestsQuery, paRequestsQuery, paTemplateBody,
  readPaAgenda, readPaList, readPaRuns, readPaTemplates, type PaAssistant, type PaTemplate,
} from "../src/shared/personalAssistants";

const assistant = (over: Partial<PaAssistant> = {}): PaAssistant => ({
  id: "pa-1", revision: 3, enabled: true, sessionId: "s-1", coordinationProjectId: "pa-c",
  grants: { tier: "coordinator", operations: [], fullOwner: false },
  config: { name: "Life", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] },
  ...over,
});
const scheduleJson = (over: Record<string, unknown> = {}) => ({
  id: "sch-1", revision: 2, targetSessionId: "s-1", message: "Personal Assistant coordination request", rule: { kind: "daily", time: "09:00" }, timezone: "host",
  enabled: true, nextRunAt: "2026-11-26T22:00:00Z", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z", deletedAt: null,
  lastRun: { id: "sch-1-r3", sequence: 3, scheduleId: "sch-1", scheduleRevision: 2, targetSessionId: "s-1", message: "m", scheduledAt: "2026-11-25T22:00:00Z", startedAt: null, finishedAt: null, outcome: "handedOff", attempts: 1, nextAttemptAt: "2026-11-25T22:00:00Z", lastError: null, messageId: "dr-x", requestId: "dr-x", slotLocal: "2026-11-26T09:00:00+11:00" },
  assistantTemplate: { assistantId: "pa-1", assistantRevision: 3, projectRef: { instanceId: "inst-a", projectId: "desktop" }, templateRevision: 2, confirmedSeat: { sessionId: "eva", epoch: 2 }, task: "projectStatus" },
  ...over,
});

function fakeClient(reply: (method: string, path: string, opts: any) => unknown) {
  const calls: { method: string; path: string; opts: any }[] = [];
  return { calls, client: { request: async (method: string, path: string, opts: unknown) => (calls.push({ method, path, opts }), reply(method, path, opts)) } as any };
}

describe("main: updated routes", () => {
  const confirm = { actionId: "t1", expectedAssistantRevision: 3, projectRef: { instanceId: "inst-a", projectId: "desktop" }, confirmedSeat: { sessionId: "eva", epoch: 2 }, task: "projectStatus" as const, rule: { kind: "weekly" as const, weekday: 1, time: "09:30" } };

  it("a new 定期任务 is POSTed without a revision; re-confirming PUTs the template's revision; pause / cancel / runs", async () => {
    const { client, calls } = fakeClient((_m, path) => (path.endsWith("/runs") ? { items: [], nextCursor: null } : { schedule: scheduleJson() }));
    const api = personalAssistantsApi(client);
    expect((await api.paTemplateConfirm("pa-1", null, confirm)).template?.task).toBe("projectStatus");
    await api.paTemplateConfirm("pa-1", "sch-1", { ...confirm, actionId: "t2", expectedRevision: 2 });
    await api.paTemplateStop("pa-1", "sch-1", "pause", { actionId: "t3", expectedRevision: 3 });
    await api.paTemplateStop("pa-1", "sch-1", "cancel", { actionId: "t4", expectedRevision: 4 });
    await api.paTemplateRuns("pa-1", "sch-1", { cursor: "12", limit: 10 });
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ["POST", "/v2/personal-assistants/pa-1/templates"],
      ["PUT", "/v2/personal-assistants/pa-1/templates/sch-1"],
      ["POST", "/v2/personal-assistants/pa-1/templates/sch-1/pause"],
      ["POST", "/v2/personal-assistants/pa-1/templates/sch-1/cancel"],
      ["GET", "/v2/personal-assistants/pa-1/templates/sch-1/runs"],
    ]);
    expect(calls[0]!.opts.body).toEqual({ actionId: "t1", expectedAssistantRevision: 3, projectRef: { instanceId: "inst-a", projectId: "desktop" }, confirmedSeat: { sessionId: "eva", epoch: 2 }, task: "projectStatus", rule: { kind: "weekly", weekday: 1, time: "09:30" } });
    expect(calls[1]!.opts.body.expectedRevision).toBe(2);
    expect(calls[2]!.opts.body).toEqual({ actionId: "t3", expectedRevision: 3 });
    expect(calls[4]!.opts.query).toEqual({ cursor: "12", limit: 10 });
    await expect(api.paTemplateStop("pa-1", "sch-1", "delete" as never, { actionId: "x", expectedRevision: 1 })).rejects.toThrow(/template action/);
  });

  it("template bodies: seat, task and rule are checked; a create never carries a revision, an update always does", () => {
    expect(() => paTemplateBody({ ...confirm, expectedRevision: 1 }, false)).toThrow(/revision/);
    expect(() => paTemplateBody(confirm, true)).toThrow(/revision/);
    expect(() => paTemplateBody({ ...confirm, confirmedSeat: { sessionId: null, epoch: 2 } as never }, false)).toThrow(/seat/);
    expect(() => paTemplateBody({ ...confirm, task: "anything" as never }, false)).toThrow(/task/);
    expect(() => paTemplateBody({ ...confirm, rule: { kind: "daily", time: "9:00" } }, false)).toThrow(/rule/);
    expect(() => paTemplateBody({ ...confirm, rule: { kind: "weekly", weekday: 8, time: "09:00" } }, false)).toThrow(/rule/);
    expect(() => paTemplateBody({ ...confirm, rule: { kind: "interval", hours: 0 } }, false)).toThrow(/rule/);
    expect(paTemplateBody({ ...confirm, rule: { kind: "interval", hours: 6 }, extra: 1 } as never, false)).not.toHaveProperty("extra");
  });

  it("requests: state only when given; the owner query needs a project or a Director, an epoch only with its Director", () => {
    expect(paRequestsQuery({ cursor: 9 })).toEqual({ cursor: "9", limit: undefined });
    expect(paRequestsQuery({ state: "awaitingOwner", limit: 100 })).toEqual({ cursor: undefined, limit: 100, state: "awaitingOwner" });
    expect(() => paRequestsQuery({ state: "nope" })).toThrow(/state/);
    expect(paOwnerRequestsQuery({ project: { instanceId: "inst-a", projectId: "desktop" }, directorSessionId: "eva", directorEpoch: 2 })).toMatchObject({ instanceId: "inst-a", projectId: "desktop", directorSessionId: "eva", directorEpoch: 2 });
    expect(() => paOwnerRequestsQuery({})).toThrow(/scope/);
    expect(() => paOwnerRequestsQuery({ project: { instanceId: "inst-a", projectId: "desktop" }, directorEpoch: 2 })).toThrow(/seat/);
  });

  it("notes, the owner query and the calendar go to their fixed routes", async () => {
    const { client, calls } = fakeClient((m, path) =>
      path.endsWith("/notes") ? { items: [{ key: "k", revision: 2, content: "c", sourceRef: "s" }], nextCursor: "k" }
      : path.endsWith("/calendar") ? { revision: m === "GET" ? 1 : 2, status: m === "DELETE" ? "disconnected" : "ready", source: "Outlook", observedAt: "2026-11-25T00:00:00Z" }
      : { items: [], nextCursor: null },
    );
    const api = personalAssistantsApi(client);
    expect((await api.paNotes("pa-1", { q: "plan", limit: 20 })).nextCursor).toBe("k");
    await api.paOwnerRequests({ project: { instanceId: "inst-a", projectId: "desktop" }, state: "queued" });
    expect((await api.paCalendar("pa-1")).revision).toBe(1);
    const snapshot = { source: "Outlook", observedAt: "2026-11-25T00:00:00Z", events: [{ id: "e1", title: "组会", startsAt: "2026-11-25T23:00:00Z", endsAt: "2026-11-25T23:30:00Z" }] };
    expect((await api.paCalendarImport("pa-1", { actionId: "c1", expectedRevision: 1, snapshot })).status).toBe("ready");
    expect((await api.paCalendarClear("pa-1", { actionId: "c2", expectedRevision: 2 })).status).toBe("disconnected");
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ["GET", "/v2/personal-assistants/pa-1/notes"],
      ["GET", "/v2/personal-assistants/requests"],
      ["GET", "/v2/personal-assistants/pa-1/calendar"],
      ["PUT", "/v2/personal-assistants/pa-1/calendar"],
      ["DELETE", "/v2/personal-assistants/pa-1/calendar"],
    ]);
    expect(calls[0]!.opts.query).toEqual({ q: "plan", cursor: undefined, limit: 20 });
    expect(calls[1]!.opts.query).toMatchObject({ instanceId: "inst-a", projectId: "desktop", state: "queued" });
    expect(calls[3]!.opts.body).toEqual({ actionId: "c1", expectedRevision: 1, snapshot });
    expect(calls[4]!.opts.body).toEqual({ actionId: "c2", expectedRevision: 2 });
    await expect(api.paNotes("pa-1", { q: "汉".repeat(90) })).rejects.toThrow(/note query/);
  });

  it("calendar limits: 1000 events, byte limits, end after start, unique ids, 1 MiB", () => {
    const ev = (i: number, over: Record<string, string> = {}) => ({ id: `e${i}`, title: "t", startsAt: "2026-11-25T01:00:00Z", endsAt: "2026-11-25T02:00:00Z", ...over });
    const snap = (events: unknown[], over: Record<string, unknown> = {}) => ({ source: "Outlook", observedAt: "2026-11-25T00:00:00Z", events, ...over });
    expect(paCalendarProblem(snap(Array.from({ length: PA_CALENDAR_EVENTS_MAX }, (_, i) => ev(i))))).toBeNull();
    expect(paCalendarProblem(snap(Array.from({ length: PA_CALENDAR_EVENTS_MAX + 1 }, (_, i) => ev(i))))).toEqual({ code: "tooMany" });
    expect(paCalendarProblem(snap([ev(1)], { source: "源".repeat(54) }))).toEqual({ code: "source" }); // 162 bytes
    expect(paCalendarProblem(snap([ev(1, { title: "题".repeat(171) })]))).toEqual({ code: "eventTitle", index: 0 }); // 513 bytes
    expect(paCalendarProblem(snap([ev(1), ev(2, { endsAt: "2026-11-25T01:00:00Z" })]))).toEqual({ code: "eventTime", index: 1 });
    expect(paCalendarProblem(snap([ev(1), ev(1)]))).toEqual({ code: "duplicateId", index: 1 });
    expect(paCalendarProblem(snap([ev(1)], { observedAt: "yesterday" }))).toEqual({ code: "observedAt" });
    // 1000 events at the per-text byte limits fit 1 MiB as plain text…
    const big = snap(Array.from({ length: 1000 }, (_, i) => ev(i, { title: "😀".repeat(128), id: `${"x".repeat(90)}${i}` })));
    expect(paCalendarProblem(big)).toBeNull();
    expect(() => paCalendarBody({ actionId: "a", expectedRevision: 0, snapshot: big as never })).not.toThrow();
    // … but JSON escaping counts: quotes double, so 1000 events of quoted titles and ids pass 1 MiB.
    const huge = snap(Array.from({ length: 1000 }, (_, i) => ev(i, { title: String.fromCharCode(34).repeat(512), id: `${String.fromCharCode(34).repeat(96)}${i}` })));
    expect(paCalendarProblem(huge)).toBeNull();
    expect(() => paCalendarBody({ actionId: "a", expectedRevision: 0, snapshot: huge as never })).toThrow(/tooLarge/);
  });

  it("create with projectRefs: the home refs must match projectIds", () => {
    const base = { name: "Life", profile: "claude", homeInstanceId: "inst-a", projectIds: ["desktop"] };
    expect(paCreateBody({ actionId: "a", config: { ...base, projectRefs: [{ instanceId: "inst-a", projectId: "desktop" }] } }).config.projectRefs).toEqual([{ instanceId: "inst-a", projectId: "desktop" }]);
    expect(() => paCreateBody({ actionId: "a", config: { ...base, projectRefs: [{ instanceId: "inst-a", projectId: "waveline" }] } })).toThrow(/project set/);
    expect(paCreateBody({ actionId: "a", config: base }).config).not.toHaveProperty("projectRefs");
  });
});

describe("replies as read", () => {
  it("list rows carry availability and the current Profile (updated); older rows do not", () => {
    const row = { ...assistant(), availability: "runtimeUnsupported", activeProfile: "codex" };
    expect(readPaList({ homeInstanceId: "inst-a", items: [row], nextCursor: null }).status).toEqual({ "pa-1": { availability: "runtimeUnsupported", activeProfile: "codex" } });
    expect(readPaList({ homeInstanceId: "inst-a", items: [assistant()], nextCursor: null }).status).toBeNull();
  });

  it("templates and runs: the template, its last run, outcomes; an unknown rule is kept as null", () => {
    const page = readPaTemplates({ items: [scheduleJson(), scheduleJson({ id: "sch-2", rule: { kind: "monthly", day: 1 } })], nextCursor: "sch-2" });
    expect(page.items[0]).toMatchObject({ id: "sch-1", rule: { kind: "daily", time: "09:00" }, lastRun: { outcome: "handedOff", requestId: "dr-x", slotLocal: "2026-11-26T09:00:00+11:00" }, template: { confirmedSeat: { sessionId: "eva", epoch: 2 } } });
    expect(page.items[1]!.rule).toBeNull();
    expect(page.nextCursor).toBe("sch-2");
    const runs = readPaRuns({ items: [{ id: "r", sequence: 4, scheduleRevision: 2, scheduledAt: "t", outcome: "refused", attempts: 1, lastError: "director_changed", coalescedUntil: "u" }], nextCursor: "4" });
    expect(runs.items[0]).toMatchObject({ outcome: "refused", lastError: "director_changed", coalescedUntil: "u", requestId: null });
  });

  it("agenda: projects (a seat or an issue), due requests and the calendar with their cursors; older has none", () => {
    const a = readPaAgenda({
      date: "2026-11-25", items: [], reminders: [], schedules: [],
      projects: [{ projectId: "desktop", director: { sessionId: "eva", epoch: 2 }, revision: 5, lifecycle: "active", projectRef: { instanceId: "inst-a", projectId: "desktop" } }, { projectRef: { instanceId: "inst-a", projectId: "gone" }, issue: "project_not_found" }],
      nextProjectCursor: "desktop", dueRequests: [], nextDueCursor: null,
      calendar: { revision: 2, status: "ready", source: "Outlook", observedAt: "t", items: [{ id: "e", title: "组会", startsAt: "s", endsAt: "e" }], nextCursor: "2|1|e" },
    });
    expect(a.projects).toEqual([
      { projectRef: { instanceId: "inst-a", projectId: "desktop" }, director: { sessionId: "eva", epoch: 2 }, lifecycle: "active", issue: null },
      { projectRef: { instanceId: "inst-a", projectId: "gone" }, director: null, lifecycle: null, issue: "project_not_found" },
    ]);
    expect(a.calendar).toMatchObject({ status: "ready", nextCursor: "2|1|e", items: [{ title: "组会" }] });
    const old = readPaAgenda({ date: "2026-11-25", items: [], reminders: [], schedules: [] });
    expect([old.projects, old.dueRequests, old.calendar]).toEqual([null, null, null]);
  });
});

describe("renderer model (updated)", async () => {
  const m = await import("../src/renderer/src/lib/personalAssistants");
  const tpl = (over: Partial<PaTemplate> = {}): PaTemplate => readPaTemplates({ items: [scheduleJson()] }).items[0]! && { ...readPaTemplates({ items: [scheduleJson()] }).items[0]!, ...over };

  it("features gate: cross-host only when advertised, and never when the detail says false", () => {
    const f = m.paFeatures(new Set(["personal-assistants-recurring-v1", "personal-assistants-owner-views-v1"]));
    expect(f).toEqual({ recurring: true, qualifiedRefs: false, ownerViews: true, crossHost: false });
    expect(m.remoteProjectsSupported(f)).toBe(false);
    const cross = m.paFeatures(new Set(["personal-assistants-cross-host-scope-v1"]));
    expect(m.remoteProjectsSupported(cross)).toBe(true);
    expect(m.remoteProjectsSupported(cross, { crossHostProjectScope: false })).toBe(false);
    expect(m.assistantRefs(assistant({ config: { ...assistant().config, projectRefs: [{ instanceId: "inst-b", projectId: "lab" }] } }))).toEqual([{ instanceId: "inst-b", projectId: "lab" }]);
  });

  it("re-confirm: a refused run of this revision, or the Director seen now differs; the assistant's revision alone does not", () => {
    const seat = { sessionId: "eva", epoch: 2 };
    expect(m.reconfirmReason(tpl(), seat)).toBeNull();
    expect(m.reconfirmReason(tpl(), undefined)).toBeNull();
    expect(m.reconfirmReason(tpl(), { sessionId: "nova", epoch: 3 })).toBe("director");
    expect(m.reconfirmReason(tpl(), { sessionId: null, epoch: 3 })).toBe("directorMissing");
    const refused = (lastError: string, scheduleRevision = 2) => tpl({ lastRun: { ...tpl().lastRun!, outcome: "refused", lastError, scheduleRevision } });
    expect(m.reconfirmReason(refused("confirmation_stale"), seat)).toBe("assistant");
    expect(m.reconfirmReason(refused("director_changed"), seat)).toBe("director");
    // Re-confirmed since (the template's revision moved past the refused run's): fine again.
    expect(m.reconfirmReason({ ...refused("director_changed", 1) }, seat)).toBeNull();
    expect(m.reconfirmReason(tpl({ deletedAt: "t" }), { sessionId: "nova", epoch: 3 })).toBeNull();
    expect(m.templateState(tpl({ enabled: false }))).toBe("paused");
  });

  it("runs: outcomes as shown and the refusal code at the end of the error", () => {
    expect(["handedOff", "refused", "cancelled", "pending", "dispatching", "held", "retrying", "x"].map((outcome) => m.runKind({ outcome }))).toEqual(["sent", "refused", "cancelled", "waiting", "waiting", "held", "retrying", "other"]);
    expect(m.runErrorCode({ lastError: "admission: director_changed" })).toBe("director_changed");
    expect(m.runErrorCode({ lastError: "schedule cancelled, paused, or superseded before admission" })).toBeNull();
  });

  it("host-local time: a run's slot offset wins; else the daily rule places the next run; intervals stay unknown", () => {
    expect(m.hostOffset(tpl())).toBe(660);
    const noRun = tpl({ lastRun: null });
    expect(m.hostOffset(noRun, 600)).toBe(660); // 22:00Z is 09:00 at +11:00
    expect(m.hostOffset(tpl({ lastRun: null, rule: { kind: "daily", time: "09:00" }, nextRunAt: "2026-11-26T14:00:00Z" }), 0)).toBe(-300); // 09:00 at -05:00
    expect(m.hostOffset(tpl({ lastRun: null, rule: { kind: "interval", hours: 6 } }))).toBeNull();
    expect(m.hostWall("2026-11-25T22:00:00Z", 660)).toEqual({ date: "2026-11-26", time: "09:00", weekday: 4 });
    expect(m.offsetOf("2026-11-26T09:00:00-05:30")).toBe(-330);
  });
});

describe("calendar snapshot reader", async () => {
  const { parseCalendarText } = await import("../src/renderer/src/lib/calendarSnapshot");
  const now = new Date("2026-11-25T03:00:00Z");
  const ics = (body: string) => `BEGIN:VCALENDAR\r\nX-WR-CALNAME:学校日历\r\n${body}END:VCALENDAR\r\n`;
  const event = (lines: string) => `BEGIN:VEVENT\r\n${lines}END:VEVENT\r\n`;

  it("single events in UTC, a zone, all day; repeats, past, zone-less unknowns and cancelled ones are left out and counted", () => {
    const parsed = parseCalendarText(ics([
      event("UID:a\r\nSUMMARY:组会\\, 周三\r\nDTSTART:20261126T010000Z\r\nDTEND:20261126T013000Z\r\n"),
      event("UID:b\r\nSUMMARY:Lecture\r\nDTSTART;TZID=America/New_York:20261126T090000\r\nDURATION:PT1H\r\n"),
      event("UID:c\r\nSUMMARY:All day\r\nDTSTART;VALUE=DATE:20261128\r\n"),
      event("UID:d\r\nSUMMARY:Weekly\r\nDTSTART:20261126T010000Z\r\nRRULE:FREQ=WEEKLY\r\n"),
      event("UID:e\r\nSUMMARY:Old\r\nDTSTART:20261101T010000Z\r\nDTEND:20261101T020000Z\r\n"),
      event("UID:f\r\nSUMMARY:Windows zone\r\nDTSTART;TZID=AUS Eastern Standard Time:20261126T090000\r\nDTEND;TZID=AUS Eastern Standard Time:20261126T100000\r\n"),
      event("UID:g\r\nSTATUS:CANCELLED\r\nSUMMARY:Gone\r\nDTSTART:20261126T010000Z\r\nDTEND:20261126T020000Z\r\n"),
      event(`UID:${"u".repeat(150)}\r\nSUMMARY:Long id\r\nDTSTART:20261130T010000Z\r\nDTEND:20261130T020000Z\r\n`),
    ].join("")), now)!;
    expect(parsed.source).toBe("学校日历");
    expect(parsed.events.map((e) => e.title)).toEqual(["组会, 周三", "Lecture", "All day", "Long id"]);
    expect(parsed.events[1]).toMatchObject({ startsAt: "2026-11-26T14:00:00.000Z", endsAt: "2026-11-26T15:00:00.000Z" });
    expect(Date.parse(parsed.events[2]!.endsAt) - Date.parse(parsed.events[2]!.startsAt)).toBe(86_400_000);
    expect(new TextEncoder().encode(parsed.events[3]!.id).length).toBeLessThanOrEqual(100);
    expect([parsed.skippedRecurring, parsed.skippedPast, parsed.skippedZone, parsed.truncated]).toEqual([1, 1, 1, false]);
  });

  it("keeps the earliest 1000; a JSON snapshot passes through as written; anything else is not a calendar", () => {
    const many = Array.from({ length: 1005 }, (_, i) => event(`UID:x${i}\r\nSUMMARY:E${i}\r\nDTSTART:2026112${6 + (i % 3)}T0${i % 10}0000Z\r\nDTEND:2026112${6 + (i % 3)}T0${i % 10}3000Z\r\n`)).join("");
    const p = parseCalendarText(ics(many), now)!;
    expect([p.events.length, p.truncated]).toEqual([1000, true]);
    expect(new Set(p.events.map((e) => e.id)).size).toBe(1000);
    const json = parseCalendarText(JSON.stringify({ source: "Mine", observedAt: "2026-11-25T00:00:00Z", events: [{ id: "1", title: "t", startsAt: "a", endsAt: "b" }] }))!;
    expect(json).toMatchObject({ source: "Mine", events: [{ id: "1", startsAt: "a" }] });
    expect(parseCalendarText("hello")).toBeNull();
  });
});

// ---- the store's updated read path ----

const calls: { method: string; args: unknown[] }[] = [];
let features = new Set<string>();
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: () => () => {} }, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({
  hostDataNow: () => ({ features }),
  hostApi: () =>
    new Proxy({}, {
      get: (_t, method: string) => (...args: unknown[]) => {
        calls.push({ method, args });
        if (method === "paList") return Promise.resolve({ homeInstanceId: "inst-a", items: [assistant()], status: { "pa-1": { availability: "ready", activeProfile: "claude" } }, nextCursor: null });
        if (method === "paGet") return Promise.resolve({ assistant: assistant({ revision: 4 }), overlaps: [{ assistantId: "pa-2", name: "R", projectId: "desktop" }], moreOverlaps: false, availability: "ready", activeProfile: "claude", capabilities: { agenda: true } });
        if (method === "paRequests") {
          const q = args[1] as { state?: string };
          const r = (id: string, state: string, updatedAt: string) => ({ id, assistantId: "pa-1", projectId: "desktop", outcome: "o", constraints: "", sourceRef: "", director: { sessionId: "eva", epoch: 2 }, assistantRevision: 3, state, revision: 1, updatedAt, detail: null });
          return Promise.resolve(q?.state === "awaitingOwner" ? { items: [r("dr-old", "awaitingOwner", "2026-11-01")], nextCursor: null } : { items: [r("dr-new", "queued", "2026-11-25")], nextCursor: 7 });
        }
        return Promise.resolve(null);
      },
    }),
}));

describe("store on an updated host", () => {
  beforeEach(() => {
    calls.length = 0;
    features = new Set(["personal-assistants-local-v1", "personal-assistants-owner-views-v1", "personal-assistants-recurring-v1"]);
  });

  it("a host read lists and reads each assistant's waiting and newest requests: no detail reads", async () => {
    const store = await import("../src/renderer/src/lib/personalAssistantStore");
    store.resetPaStore();
    await store.refreshHost("local");
    expect(calls.map((c) => c.method)).toEqual(["paList", "paRequests", "paRequests"]);
    expect(calls.slice(1).map((c) => c.args[1])).toEqual([{ state: "awaitingOwner", limit: 100 }, { limit: 100 }]);
    const h = store.usePa.getState().byHost.local!;
    expect(h.views["pa-1"]).toMatchObject({ availability: "ready", activeProfile: "claude", fromList: true, capabilities: { recurringDirectorTemplates: true } });
    expect(h.requests["pa-1"]!.map((r) => r.id)).toEqual(["dr-new", "dr-old"]);
    expect(h.moreRequests["pa-1"]).toBe(true);
    // Opening it reads its detail once.
    await store.ensureDetail("local", "pa-1");
    await store.ensureDetail("local", "pa-1");
    expect(calls.filter((c) => c.method === "paGet")).toHaveLength(1);
    expect(store.usePa.getState().byHost.local!.views["pa-1"]!.overlaps).toHaveLength(1);
  });

  it("change events: ticks move at once; one burst reads only what it names", async () => {
    vi.useFakeTimers();
    try {
      const store = await import("../src/renderer/src/lib/personalAssistantStore");
      store.resetPaStore();
      await store.refreshHost("local");
      calls.length = 0;
      store.onPaChanged("local", { assistantId: "pa-1", areas: ["notes", "audit"] });
      expect(store.usePa.getState().byHost.local!.ticks["pa-1"]).toEqual({ notes: 1, audit: 1 });
      await vi.advanceTimersByTimeAsync(400);
      expect(calls).toEqual([]);
      store.onPaChanged("local", { assistantId: "pa-1", areas: ["requests", "audit"], requestId: "dr-new" });
      store.onPaChanged("local", { assistantId: "pa-1", areas: ["requests", "audit"] });
      await vi.advanceTimersByTimeAsync(400);
      expect(calls.map((c) => c.method)).toEqual(["paRequests", "paRequests"]);
      calls.length = 0;
      store.onPaChanged("local", { assistantId: "pa-new", areas: ["assistant", "audit"] });
      await vi.advanceTimersByTimeAsync(10);
      expect(calls[0]?.method).toBe("paList");
      store.onPaChanged("local", { nope: 1 });
      store.onPaChanged("elsewhere", { assistantId: "pa-1", areas: ["requests"] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a host that sends a 定期任务 change (area templates) is marked as announcing them", async () => {
    const store = await import("../src/renderer/src/lib/personalAssistantStore");
    store.resetPaStore();
    await store.refreshHost("local");
    expect(store.usePa.getState().byHost.local!.sendsTemplates).toBe(false);
    store.onPaChanged("local", { assistantId: "pa-1", areas: ["requests", "audit"] });
    expect(store.usePa.getState().byHost.local!.sendsTemplates).toBe(false);
    store.onPaChanged("local", { assistantId: "pa-1", areas: ["templates", "audit"] });
    expect(store.usePa.getState().byHost.local!.sendsTemplates).toBe(true);
    expect(store.usePa.getState().byHost.local!.ticks["pa-1"]).toMatchObject({ templates: 1 });
  });

  it("an older host keeps the detail-and-all-requests read", async () => {
    features = new Set(["personal-assistants-local-v1"]);
    const store = await import("../src/renderer/src/lib/personalAssistantStore");
    store.resetPaStore();
    await store.refreshHost("local");
    expect(calls.map((c) => c.method)).toEqual(["paList", "paGet", "paRequests"]);
  });
});

describe("refusals in plain words", async () => {
  const { paErrorText, paCodeText } = await import("../src/renderer/src/modules/personal-assistants/paHooks");
  const t = (key: string) => key;
  it("403 full_owner_native_confirmation_required and the updated codes have their own sentence", () => {
    expect(paErrorText(new Error("Error invoking remote method 'invoke': Error: full_owner_native_confirmation_required: Granting full owner access requires native owner confirmation, which this host does not support yet."), t as never)).toBe("personal-assistants.error.fullOwnerNative");
    expect(paCodeText("destination_scope_required", t as never)).toBe("personal-assistants.error.destinationScope");
    expect(paCodeText("body_too_large", t as never)).toBe("personal-assistants.error.bodyTooLarge");
    expect(paCodeText("something_else", t as never)).toBeNull();
  });
});

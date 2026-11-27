import { describe, expect, it } from "vitest";
import { personalAssistantsApi } from "../src/main/personalAssistantsApi";
import { paAgendaQuery, readPaAgenda, readPaCreateOptions, readPaList, readPaView } from "../src/shared/personalAssistants";

const row = { id: "pa-1", revision: 1, enabled: true, sessionId: "cutex.fixture", coordinationProjectId: "coord",
  config: { name: "Fixture", profile: "p", homeInstanceId: "eva", projectIds: [] },
  grants: { tier: "operational", operations: ["publishing"], fullOwner: false } };
const details = { publishing: { configured: true, effective: false, unsupported: true, reason: "host_unsupported" } };
const options = { homeInstanceId: "eva", profiles: [
  { id: "p1", name: "Claude", runtime: "claude", eligible: true, reason: null, runtimePin: "claude-r58" },
  { id: "p2", name: "Codex", runtime: "codex", eligible: false, reason: "assistant_profile_runtime_unsupported", runtimePin: null },
], capabilities: { ownerOperationDelegation: false }, observedAt: "2026-11-27T00:00:00Z", hostTimezone: "Australia/Sydney" };

describe("assistant readiness contract", () => {
  it("reads only the fixed create-options route and preserves rejection reasons", async () => {
    const calls: unknown[] = [];
    const client = { request: async (...args: unknown[]) => { calls.push(args); return options; } };
    const api = personalAssistantsApi(client as never);
    const result = await api.paCreateOptions();
    expect(calls).toEqual([["GET", "/v2/personal-assistants/create-options", { background: true }]]);
    expect(result.profiles.filter((p) => p.eligible).map((p) => p.id)).toEqual(["p1"]);
    expect(result.profiles[1]?.reason).toBe("assistant_profile_runtime_unsupported");
    expect(() => readPaCreateOptions({ ...options, profiles: [{ ...options.profiles[0], eligible: "yes" }] })).toThrow();
  });

  it("retains configured-but-unsupported authority in both row and detail; rejects contradictory effective authority", () => {
    expect(readPaList({ homeInstanceId: "eva", items: [{ ...row, availability: "ready", capabilityDetails: details }] }).status?.["pa-1"]?.capabilityDetails).toEqual(details);
    expect(readPaView({ assistant: row, capabilityDetails: details }).capabilityDetails).toEqual(details);
    expect(() => readPaView({ assistant: row, capabilityDetails: { publishing: { ...details.publishing, effective: true } } })).toThrow();
    expect(readPaView({ assistant: row }).capabilityDetails).toBeNull();
  });

  it("carries display/source zones and unknown reads; a missing/offline payload cannot become an empty agenda", async () => {
    const agenda = { date: "2027-04-04", timezone: "Australia/Sydney", displayTimezone: "Australia/Sydney", hostTimezone: "UTC",
      observedAt: "2027-04-03T13:00:00Z", items: [], reminders: [], schedules: [],
      sources: { projects: { instanceId: "samplehostb", timezone: "UTC", status: "unknown", observedAt: null, reason: "directory_unavailable" },
        calendar: { instanceId: "eva", timezone: "UTC", status: "snapshot", observedAt: "2027-04-01T00:00:00Z", reason: "imported_snapshot" } } };
    const read = readPaAgenda(agenda);
    expect(read.sources?.projects).toMatchObject({ status: "unknown", observedAt: null });
    expect(read.sources?.calendar?.observedAt).toBe("2027-04-01T00:00:00Z");
    expect(paAgendaQuery({ displayTimezone: "Australia/Sydney" }).displayTimezone).toBe("Australia/Sydney");
    expect(() => readPaAgenda({})).toThrow();
    const offline = personalAssistantsApi({ request: async () => { throw new Error("host offline"); } } as never);
    await expect(offline.paAgenda("pa-1")).rejects.toThrow("host offline");
    const old = readPaAgenda({ date: "2026-11-27", items: [], reminders: [], schedules: [] });
    expect(old.sources).toBeNull();
  });
});

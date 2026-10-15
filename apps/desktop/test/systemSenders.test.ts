// lib/systemSenders: which senders are cutex itself (委托系统 / 闹钟 / 作业 / Cutex 系统), never an agent.
import { describe, expect, it } from "vitest";

const { senderLabel, systemSender } = await import("../src/renderer/src/lib/systemSenders");

describe("systemSender", () => {
  it("cutex-asks is the delegation system", () => {
    expect(systemSender("cutex-asks")).toBe("delegation");
    expect(systemSender("cutex-asks", "service")).toBe("delegation");
  });

  it("alarms and the Job Service have their own names", () => {
    expect(systemSender("Cutex Alarm")).toBe("alarm");
    expect(systemSender("Cutex Alarm", "service")).toBe("alarm");
    expect(systemSender("cutex-job-service")).toBe("job");
    expect(systemSender("cutex-job-service", "service")).toBe("job");
  });

  it("other cutex services are the cutex system", () => {
    for (const id of ["cutex-task-service", "cutex-agent-bus", "AgentManagementSystem"]) expect(systemSender(id), id).toBe("cutex");
    expect(systemSender("something-new", "service")).toBe("cutex");
  });

  it("agents (cutex.<id> session ids, names) and missing ids are not system senders", () => {
    expect(systemSender("cutex.lead")).toBeNull();
    expect(systemSender("cutex.lead", "agent")).toBeNull();
    expect(systemSender("lead")).toBeNull();
    expect(systemSender(null)).toBeNull();
  });

  it("senderLabel swaps in the system name", () => {
    const t = (k: string) => `<${k}>`;
    expect(senderLabel(t, "cutex-asks", null, "cutex-asks")).toBe("<system.delegation>");
    expect(senderLabel(t, "x", "service", "x")).toBe("<system.cutex>");
    expect(senderLabel(t, "Cutex Alarm", "service", "?")).toBe("<system.alarm>");
    expect(senderLabel(t, "cutex-job-service", null, "?")).toBe("<system.job>");
    expect(senderLabel(t, "cutex.lead", "agent", "Lead")).toBe("Lead");
  });
});

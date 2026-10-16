// Jobs follow the job-service component (components spec v2 §5): with cutex `components`, the focus
// host's Job Service is not called while the component is missing (or its state is unread).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readComponentsList } from "../src/shared/components";

const env = vi.hoisted(() => ({ jobs: vi.fn(), caps: vi.fn(), components: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  bridge: { on: () => () => {} },
  api: { jobs: env.jobs, jobServiceCapabilities: env.caps },
  apiFor: () => ({ components: env.components }),
}));
const { refreshAgentJobs, startJobSync } = await import("../src/renderer/src/lib/jobStore");
const { loadComponents, resetHostComponents } = await import("../src/renderer/src/lib/componentStore");

const features = new Set(["job-service", "components"]);
startJobSync({ getState: () => ({ features, selectedId: null }) });
const list = (state: string) => readComponentsList({ managed: true, installFrom: "release", components: [{ name: "job-service", supported: true, state }] });

beforeEach(() => {
  resetHostComponents("local");
  env.jobs.mockReset().mockResolvedValue({ ok: true, value: { data: [], nextCursor: null } });
  env.caps.mockReset().mockResolvedValue({ ok: true, value: {} });
  env.components.mockReset();
});

describe("jobs and the job-service component", () => {
  it("no Job Service call while the component is missing or unread", async () => {
    env.components.mockResolvedValue(list("missing"));
    await refreshAgentJobs("s1"); // unread: starts the read, no call
    await loadComponents("local");
    await refreshAgentJobs("s1"); // missing: no call
    expect(env.jobs).not.toHaveBeenCalled();
  });

  it("calls once the component is ready", async () => {
    env.components.mockResolvedValue(list("ready"));
    await loadComponents("local");
    await refreshAgentJobs("s1");
    expect(env.jobs).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
// State surfaces follow-up (owner said yes, 2026-11-18): the job status hover lives on the shared mark, so the jobs
// capsule and the status row (both JobStatusMark) show what the jobs page shows: the full word, then its meaning.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "zh-CN", t: (key: string, vars?: Record<string, unknown>) => (vars?.state ? `${key}[${vars.state}]` : key) }) }));
vi.mock("../src/renderer/src/lib/jobsView", () => ({ useJobWord: () => (s: { key: string }) => `word:${s.key}` }));
vi.mock("../src/renderer/src/lib/jobStore", () => ({ closeJobOutput: vi.fn(), readJobOutput: vi.fn(), useHostJobs: () => ({}), useJobOutputView: () => null, useJobs: Object.assign(() => ({}), { getState: () => ({ allIds: null }) }) }));
vi.mock("../src/renderer/src/lib/menus", () => ({ copyText: vi.fn() }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ useTrackOverlay: () => {} }));
vi.mock("../src/renderer/src/lib/ownerContext", () => ({ useOwnerWindow: () => window }));
import { JobStatusMark } from "../src/renderer/src/components/JobParts";

const mark = (job: Record<string, unknown>) => renderToStaticMarkup(createElement(JobStatusMark, { job: { jobId: "j1", state: "running", exitCode: null, ...job } as never }));

describe("JobStatusMark hover", () => {
  it("an unconfirmed job explains itself wherever the mark shows", () => {
    const html = mark({ state: "unconfirmed" });
    expect(html).toContain("data-tip=\"word:unconfirmed\njobs.status.unconfirmed.tip");
  });
  it("an unrecognised state names the raw value", () => {
    expect(mark({ state: "suspended_remote" })).toContain("jobs.status.unrecognized.tip[suspended_remote]");
  });
  it("a plain running job has no hover", () => {
    expect(mark({ state: "running" })).not.toContain("data-tip");
  });
});

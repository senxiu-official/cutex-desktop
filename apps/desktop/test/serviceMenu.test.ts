// Start / stop / restart / logs only for services cutex runs (`managed`); `external` and `static`
// ones answer 409 not_supervised, so their menus offer open / owner / delete only.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
import type { ServiceView } from "../src/shared/ipc";
import { serviceMenu } from "../src/renderer/src/lib/services";

const view = (runtime: ServiceView["runtime"]): ServiceView =>
  ({ slug: "web", displayName: "Web", host: "h", port: 26180, path: null, ownerCutexSessionId: null, projectId: null, runtime, createdAt: "", lastSeenAt: null, health: "reachable", url: "http://h:26180", localUrl: "http://127.0.0.1:26180", process: null }) as unknown as ServiceView;
const labels = (runtime: ServiceView["runtime"]) =>
  serviceMenu(view(runtime), (k) => k, () => {}, () => {}, "local").flatMap((e) => (e && typeof e === "object" && "label" in e ? [e.label] : []));

describe("service menu", () => {
  it("managed services can be stopped, restarted and show logs", () => {
    expect(labels("managed")).toEqual(expect.arrayContaining(["services.stop", "services.restart", "services.logs", "services.delete"]));
  });
  it.each(["external", "static"] as const)("%s services offer no start / stop / restart / logs, but can be deleted", (runtime) => {
    const l = labels(runtime);
    for (const k of ["services.stop", "services.start", "services.restart", "services.logs"]) expect(l).not.toContain(k);
    expect(l).toContain("services.delete");
  });
});

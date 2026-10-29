import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as { request: ReturnType<typeof vi.fn> }[] }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    request = vi.fn();
    constructor(public endpoint: unknown) { fixture.clients.push(this); }
    host() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {}, CutexUnreachableError: class extends Error {}, EventFeed: class {}, openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";

const daemons: DaemonService[] = [];
afterEach(() => { for (const daemon of daemons.splice(0)) daemon.stop(); fixture.clients.length = 0; });
function connect(name: string) {
  const daemon = new DaemonService(() => {});
  daemons.push(daemon);
  daemon.useEndpoint({ baseUrl: `http://${name}.invalid`, token: "fixture" }, { remote: true });
  return { daemon, client: fixture.clients.at(-1)! };
}

describe("eligible service owners transport", () => {
  it("reads the encoded service suffix on its own connection without identity arguments", async () => {
    const focus = connect("focus"), remote = connect("remote");
    const answer = { hostId: "remote-daemon", slug: "my/service", owners: [] };
    remote.client.request.mockResolvedValue(answer);
    expect(await remote.daemon.serviceEligibleOwners("my/service")).toBe(answer);
    expect(remote.client.request).toHaveBeenCalledExactlyOnceWith("GET", "/v2/services/my%2Fservice/eligible-owners");
    expect(focus.client.request).not.toHaveBeenCalled();
  });

  it("propagates service/store read failures rather than returning an empty list", async () => {
    const { daemon, client } = connect("remote");
    client.request.mockRejectedValue(new Error("503 unavailable"));
    await expect(daemon.serviceEligibleOwners("web")).rejects.toThrow("503 unavailable");
  });
});

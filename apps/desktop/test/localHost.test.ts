// macOS is front-end only (main/localHost.ts): the implicit local host exists there only when a
// local cutex is configured; Windows / Linux always keep it. Without it the app lists no local
// host, never connects 127.0.0.1:24270, and with no remote host either shows the add-host guide.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => fake.userData },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => "unknown" },
}));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: () => new Promise(() => {}) }));

import { hasImplicitLocalHost, localCutexConfigured } from "../src/main/localHost";
import { HostManager } from "../src/main/hosts";
import type { HostsState } from "../src/shared/hosts";
import { firstRunView } from "../src/renderer/src/lib/firstRun";
import { hasLocalHost, hasNoHost, shownSettingsSource } from "../src/renderer/src/lib/hosts";

describe("the implicit local host rule", () => {
  it("Windows / Linux always have it; macOS only with a configured local cutex", () => {
    expect(hasImplicitLocalHost("win32", false)).toBe(true);
    expect(hasImplicitLocalHost("linux", false)).toBe(true);
    expect(hasImplicitLocalHost("darwin", false)).toBe(false);
    expect(hasImplicitLocalHost("darwin", true)).toBe(true);
  });

  it("configured = an explicit URL / CUTEX_HOME, or a management token in <home>/.cutex/config.json (as discovery)", () => {
    const seen: string[] = [];
    const none = (path: string) => (seen.push(path), null);
    const config = join("/Users/me", ".cutex", "config.json");
    const file = (text: string) => (path: string) => (path === config ? text : null);
    expect(localCutexConfigured({ home: "/Users/me" }, {}, none)).toBe(false);
    expect(seen).toEqual([config]);
    expect(localCutexConfigured({ home: "/Users/me" }, {}, file(JSON.stringify({ management_api_token: "t" })))).toBe(true);
    // A config.json without a management token (an old CLI-only cutex) is not a local daemon.
    expect(localCutexConfigured({ home: "/Users/me" }, {}, file(JSON.stringify({ default_profile: "x" })))).toBe(false);
    expect(localCutexConfigured({ home: "/Users/me" }, {}, file(JSON.stringify({ management_api_token: "" })))).toBe(false);
    expect(localCutexConfigured({ home: "/Users/me" }, {}, file("null"))).toBe(false);
    // Broken JSON: discovery reports the error on this host, so the host stays.
    expect(localCutexConfigured({ home: "/Users/me" }, {}, file("{"))).toBe(true);
    expect(localCutexConfigured({ baseUrl: "http://127.0.0.1:24370" }, {}, none)).toBe(true);
    expect(localCutexConfigured({}, { CUTEX_MANAGEMENT_URL: "http://127.0.0.1:24370" }, none)).toBe(true);
    expect(localCutexConfigured({}, { CUTEX_HOME: "/srv/cutex-b" }, none)).toBe(true);
    expect(localCutexConfigured({}, { CUTEX_HOME: "" }, none)).toBe(false);
  });
});

describe("HostManager without a local host", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-local-host-"));
    fake.userData = dir;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function manager(localHost?: boolean) {
    const published: HostsState[] = [];
    const opened: string[] = [];
    const hosts = new HostManager(
      (_event, state) => void published.push(state),
      (hostId) => {
        opened.push(hostId);
        return { hostId, useEndpoint: vi.fn(), suspend: vi.fn(), detachViews: vi.fn(), stop: vi.fn(), reconnectNow: vi.fn(), currentState: { kind: "connecting", baseUrl: "" }, activeClient: () => null } as never;
      },
      localHost === undefined ? {} : { localHost },
    );
    return { hosts, published, opened };
  }

  it("lists and connects no host at all (no dead 127.0.0.1:24270); the renderer shows the add-host guide", async () => {
    const { hosts, published, opened } = manager(false);
    await hosts.start();
    const state = published.at(-1)!;
    expect(state.hosts).toEqual([]);
    expect(opened).toEqual([]);
    expect(hosts.connection("local")).toBeUndefined();
    expect(hasNoHost(state)).toBe(true);
    expect(hasLocalHost(state)).toBe(false);
    expect(firstRunView({ kind: "connecting", baseUrl: "" }, false, null, hasNoHost(state))).toBe("noHost");
    await expect(hosts.switchHost("local")).rejects.toThrow("unknown host");
    await expect(hosts.reconnectHost("local")).rejects.toThrow("unknown host");
    // The banner / first-run 「重连」 without an id: nothing to reconnect, no error.
    await expect(hosts.reconnectHost()).resolves.toBeUndefined();
    expect(opened).toEqual([]);
    await expect(hosts.setScope({ kind: "host", id: "local" })).rejects.toThrow("unknown scope");
    expect(await hosts.testHost("local")).toMatchObject({ ok: false, error: { code: "badInput" } });
    hosts.stop();
  });

  it("a saved scope of this machine falls back to the first remote host (shown, connected, scope rewritten)", async () => {
    writeFileSync(join(dir, "hosts.json"), JSON.stringify({ version: 2, startOn: "local", scope: { kind: "host", id: "local" }, local: { autoConnect: true }, groups: [], hosts: [{ id: "ssh-abcd1234", label: "buildbox", target: "buildbox", autoConnect: false }] }));
    const { hosts, published, opened } = manager(false);
    await hosts.start();
    const state = published.at(-1)!;
    expect(state.hosts.map((h) => h.id)).toEqual(["ssh-abcd1234"]);
    expect(state.active).toBe("ssh-abcd1234");
    expect(state.scope).toEqual({ kind: "host", id: "ssh-abcd1234" });
    expect(opened).toEqual(["ssh-abcd1234"]);
    expect(hasNoHost(state)).toBe(false);
    hosts.stop();
  });

  it("by default (Windows / Linux, tests) this machine is a host and connects", async () => {
    const { hosts, published, opened } = manager();
    await hosts.start();
    expect(published.at(-1)!.hosts.map((h) => h.id)).toEqual(["local"]);
    expect(opened).toEqual(["local"]);
    expect(hasNoHost(published.at(-1)!)).toBe(false);
    hosts.stop();
  });
});

describe("settings without a local host", () => {
  const state = (ids: string[]): HostsState => ({ scope: { kind: "all" }, active: ids[0] ?? "local", startOn: "last", hosts: ids.map((id) => ({ id, kind: id === "local" ? "local" : "ssh", label: id, target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: "#000", platform: null })), groups: [], tunnel: null, weakSecretStorage: false });

  it("no 「本机」 source tag when this machine is not a host; other tags and the local case unchanged", () => {
    const remoteOnly = state(["ssh-abcd1234"]);
    expect(shownSettingsSource("local", remoteOnly)).toBeUndefined();
    expect(shownSettingsSource("local", state([]))).toBeUndefined();
    expect(shownSettingsSource("host", remoteOnly)).toBe("host");
    expect(shownSettingsSource("codex", remoteOnly)).toBe("codex");
    expect(shownSettingsSource(undefined, remoteOnly)).toBeUndefined();
    expect(shownSettingsSource("local", state(["local", "ssh-abcd1234"]))).toBe("local");
    // Before the first hosts state (null) this machine counts as a host, as hasLocalHost.
    expect(shownSettingsSource("local", null)).toBe("local");
  });
});

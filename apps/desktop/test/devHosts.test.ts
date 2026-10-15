// DEV ONLY direct hosts (main/devHosts.ts): CUTEX_DESKTOP_DEV_HOSTS adds loopback hosts for
// multi-host checks against isolated local daemons. A packaged app ignores the variable; only
// http://127.0.0.1:<port> is accepted; the token stays in main (never in the hosts state).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ packaged: false as boolean | undefined, userData: "" }));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return fake.packaged;
    },
    getPath: () => fake.userData,
  },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => "unknown" },
}));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: () => new Promise(() => {}) }));

import { DEV_HOSTS_ENV, devHostsFrom, loadDevHosts, parseDevHost, readDevToken } from "../src/main/devHosts";
import { HostManager } from "../src/main/hosts";
import type { HostsState } from "../src/shared/hosts";
import { hostIndicator } from "../src/renderer/src/lib/hosts";

const TOKEN = "0123456789abcdef0123456789abcdef";
let dir: string;
let tokenFile: string;
const entry = (over: Record<string, unknown> = {}) => ({ id: "dev-b", name: "instance B", baseUrl: "http://127.0.0.1:25870", tokenFile, ...over });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cutex-dev-hosts-"));
  tokenFile = join(dir, "token.txt");
  writeFileSync(tokenFile, `${TOKEN}\n`);
  fake.userData = dir;
  fake.packaged = false;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parsing CUTEX_DESKTOP_DEV_HOSTS", () => {
  it("is ignored entirely by a packaged app", () => {
    const value = JSON.stringify([entry()]);
    expect(devHostsFrom(value, true)).toEqual([]);
    fake.packaged = true;
    expect(loadDevHosts({ [DEV_HOSTS_ENV]: value })).toEqual([]);
    // Unknown (a harness without electron's flag) counts as packaged.
    fake.packaged = undefined;
    expect(loadDevHosts({ [DEV_HOSTS_ENV]: value })).toEqual([]);
    fake.packaged = false;
    expect(loadDevHosts({ [DEV_HOSTS_ENV]: value })).toEqual([{ id: "dev-b", name: "instance B", baseUrl: "http://127.0.0.1:25870", tokenFile }]);
  });

  it("accepts only http://127.0.0.1:<port> and a dev- id", () => {
    for (const baseUrl of ["http://localhost:25870", "http://[::1]:25870", "http://127.0.0.2:25870", "http://0.0.0.0:25870", "https://127.0.0.1:25870", "http://127.0.0.1", "http://127.0.0.1:25870/v2", "http://u:p@127.0.0.1:25870", "http://127.0.0.1:25870/?x=1", "http://workstation:24270", "nope"]) {
      expect(parseDevHost(entry({ baseUrl })), baseUrl).toBe(baseUrl === "nope" ? "baseUrl is not a URL" : "baseUrl must be http://127.0.0.1:<port>");
    }
    expect(parseDevHost(entry({ baseUrl: "http://127.0.0.1:25870/" }))).toMatchObject({ baseUrl: "http://127.0.0.1:25870" });
    for (const id of ["local", "ssh-1234abcd", "dev-", "dev-B", "dev-x y", 3]) expect(typeof parseDevHost(entry({ id })), String(id)).toBe("string");
    expect(parseDevHost(entry({ tokenFile: "token.txt" }))).toBe("tokenFile must be an absolute path");
    expect(parseDevHost(entry({ name: undefined }))).toMatchObject({ name: "dev-b" });
    const warnings: string[] = [];
    const list = devHostsFrom(JSON.stringify([entry(), entry(), entry({ id: "dev-c", baseUrl: "http://10.0.0.1:1" })]), false, (m) => warnings.push(m));
    expect(list.map((h) => h.id)).toEqual(["dev-b"]);
    expect(warnings).toHaveLength(2);
    expect(devHostsFrom("{not json", false, () => {})).toEqual([]);
    expect(devHostsFrom(JSON.stringify(entry()), false, () => {})).toEqual([]);
  });

  it("reads a plain token file or an instance config.json; errors never carry the content", () => {
    expect(readDevToken(entry() as never)).toBe(TOKEN);
    const config = join(dir, "config.json");
    writeFileSync(config, JSON.stringify({ management_port: 25870, management_api_token: TOKEN, agent_bus_token: "other" }));
    expect(readDevToken(entry({ tokenFile: config }) as never)).toBe(TOKEN);
    writeFileSync(config, JSON.stringify({ management_port: 25870 }));
    expect(() => readDevToken(entry({ tokenFile: config }) as never)).toThrow("no token in the token file");
    writeFileSync(tokenFile, "two words");
    expect(() => readDevToken(entry() as never)).toThrow(/^dev host dev-b: no token/);
    expect(() => readDevToken(entry({ tokenFile: join(dir, "missing") }) as never)).toThrow(/token file unreadable \(ENOENT\)/);
  });
});

describe("HostManager with a dev host", () => {
  function manager() {
    const published: HostsState[] = [];
    const daemons: { hostId: string; useEndpoint: ReturnType<typeof vi.fn>; suspend: ReturnType<typeof vi.fn>; detachViews: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; reconnectNow: ReturnType<typeof vi.fn> }[] = [];
    const hosts = new HostManager(
      (_event, state) => void published.push(state),
      (hostId) => {
        const daemon = { hostId, useEndpoint: vi.fn(), suspend: vi.fn(), detachViews: vi.fn(), stop: vi.fn(), reconnectNow: vi.fn(), currentState: { kind: "connecting", baseUrl: "" }, activeClient: () => null };
        daemons.push(daemon);
        return daemon as never;
      },
    );
    return { hosts, published, daemons };
  }

  it("a dev run lists and connects it directly (auto-connect, no tunnel, token only in the endpoint)", async () => {
    vi.stubEnv(DEV_HOSTS_ENV, JSON.stringify([entry()]));
    try {
      const { hosts, published, daemons } = manager();
      await hosts.start();
      const state = published.at(-1)!;
      const dev = state.hosts.find((h) => h.id === "dev-b")!;
      expect(dev).toMatchObject({ kind: "dev-direct", label: "instance B", target: "http://127.0.0.1:25870", autoConnect: true, paired: true });
      expect(dev.conn?.epoch).toMatch(/^[0-9a-f]{48}$/);
      expect(dev.conn?.tunnel).toBeNull();
      expect(state.active).toBe("local");
      const daemon = daemons.find((d) => d.hostId === "dev-b")!;
      expect(daemon.useEndpoint).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:25870", token: TOKEN, configPath: "dev:dev-b" }, { remote: true });
      expect(JSON.stringify(published)).not.toContain(TOKEN);
      // Focus it: shown as the focus, the old focus' views detached, the scope not written to hosts.json.
      await hosts.switchHost("dev-b");
      expect(published.at(-1)!).toMatchObject({ active: "dev-b", tunnel: null });
      expect(daemons.find((d) => d.hostId === "local")!.detachViews).toHaveBeenCalledOnce();
      expect(hosts.connection("dev-b")?.daemon).toBe(daemon);
      await new Promise((r) => setTimeout(r, 50));
      let saved: { scope?: unknown; hosts?: unknown[] } = {};
      try {
        saved = JSON.parse(readFileSync(join(dir, "hosts.json"), "utf8"));
      } catch {
        // nothing written: fine too
      }
      expect(JSON.stringify(saved)).not.toContain("dev-b");
      // Reconnect = the same connection reconnects (like local).
      await hosts.reconnectHost("dev-b");
      expect(daemon.reconnectNow).toHaveBeenCalledOnce();
      hosts.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("the shown dev host's status is its daemon connection (no tunnel)", async () => {
    vi.stubEnv(DEV_HOSTS_ENV, JSON.stringify([entry()]));
    try {
      const { hosts, published } = manager();
      await hosts.start();
      await hosts.switchHost("dev-b");
      const state = published.at(-1)!;
      expect(hostIndicator(state, { kind: "connected", baseUrl: "http://127.0.0.1:25870", hostId: "B" })).toMatchObject({ status: "online" });
      expect(hostIndicator(state, { kind: "unreachable", baseUrl: "http://127.0.0.1:25870", message: "down" })).toMatchObject({ status: "offline", problem: "remoteDaemon" });
      hosts.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a packaged app ignores the variable", async () => {
    fake.packaged = true;
    vi.stubEnv(DEV_HOSTS_ENV, JSON.stringify([entry()]));
    try {
      const { hosts, published, daemons } = manager();
      await hosts.start();
      expect(published.at(-1)!.hosts.map((h) => h.id)).toEqual(["local"]);
      expect(daemons.map((d) => d.hostId)).toEqual(["local"]);
      await expect(hosts.switchHost("dev-b")).rejects.toThrow("unknown host");
      hosts.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

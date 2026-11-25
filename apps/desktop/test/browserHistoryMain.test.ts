import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserHistoryRetention } from "../src/shared/browserIdentity";
import { BrowserHistory } from "../src/main/browser/identity/history";

const DAY = 24 * 60 * 60_000;
const START = 200 * DAY;
const work = "aabbccdd", personal = "default", local = "local", remote = "ssh-fixture";
const stores: { userData: string; history: BrowserHistory }[] = [];

function fixture(maxVisits = 100_000) {
  const userData = mkdtempSync(join(tmpdir(), "cutex-browser-history-"));
  let now = START, retention: BrowserHistoryRetention = "90d";
  const emit = vi.fn();
  const allowed = (id: string, host: string) => [work, personal].includes(id) && [local, remote].includes(host);
  const options = { userData, now: () => now, retention: () => retention, allowed, emit, maxVisits };
  const history = new BrowserHistory(options);
  stores.push({ userData, history });
  function record(url: string, title = "Example", identityId = work, hostId = local, visitedAt = now) {
    return history.record({ identityId, hostId, title, url, visitedAt, transition: "typed" });
  }
  return { userData, history, record, emit, options, time: (value: number) => { now = value; }, retention: (next: BrowserHistoryRetention) => { retention = next; } };
}

afterEach(() => {
  const fixtures = stores.splice(0);
  for (const { history } of fixtures) history.dispose();
  for (const userData of new Set(fixtures.map(fixture => fixture.userData))) rmSync(userData, { recursive: true, force: true });
});

describe("main browser history", () => {
  it("keeps a durable database for every identity and host with independently pageable same-tick visits", async () => {
    const f = fixture();
    const first = f.record("https://example.invalid/one#fragment", "Étude");
    const second = f.record("https://example.invalid/two", "Second");
    f.record("https://example.invalid/identity", "Other identity", personal);
    f.record("https://example.invalid/host", "Other host", work, remote);
    f.history.dispose();
    const reopened = new BrowserHistory(f.options);
    stores.push({ userData: f.userData, history: reopened });
    const latest = await reopened.query({ identityId: work, hostId: local, limit: 1 });
    expect(latest.entries.map(row => row.id)).toEqual([second]);
    expect(latest.nextBefore).not.toBeNull();
    const earlier = await reopened.query({ identityId: work, hostId: local, before: latest.nextBefore! });
    expect(earlier.entries).toMatchObject([{ id: first, url: "https://example.invalid/one", title: "Étude", transition: "typed" }]);
    expect(earlier.nextBefore).toBeNull();
    expect((await reopened.query({ identityId: work, hostId: local, text: "ÉTUDE" })).entries.map(entry => entry.id)).toEqual([first]);
    expect((await reopened.query({ identityId: personal, hostId: local })).entries[0]?.title).toBe("Other identity");
    expect((await reopened.query({ identityId: work, hostId: remote })).entries[0]?.title).toBe("Other host");
  });

  it("retitles the original visit and aggregates top sites per identity-host cell", async () => {
    const f = fixture(), url = "https://example.invalid/";
    const first = f.record(url, "Previous");
    const recent = f.record(url, "Most recent");
    f.record("https://another.invalid/", "Unrelated");
    f.history.retitle(work, local, url, "Updated previous visit", first);
    const rows = (await f.history.query({ identityId: work, hostId: local })).entries;
    expect(rows.find(row => row.id === first)?.title).toBe("Updated previous visit");
    expect(rows.find(row => row.id === recent)?.title).toBe("Most recent");
    await expect(f.history.topSites(work, local, 1)).resolves.toEqual([{ url, title: "Most recent", visits: 2 }]);
  });

  it("enforces retention and the cap while preserving prior history when recording is turned off", async () => {
    const f = fixture(2);
    f.record("https://example.invalid/expired", "expired", work, local, START - 60 * DAY);
    f.record("https://example.invalid/old", "old", work, local, START - 35 * DAY);
    f.record("https://example.invalid/current", "current");
    expect((await f.history.query({ identityId: work, hostId: local })).entries.map(row => row.title)).toEqual(["current", "old"]);
    f.retention("30d");
    await f.history.pruneAll();
    expect((await f.history.query({ identityId: work, hostId: local })).entries.map(row => row.title)).toEqual(["current"]);
    f.retention("off");
    expect(f.record("https://example.invalid/ignored")).toBeUndefined();
    expect((await f.history.query({ identityId: work, hostId: local })).entries.map(row => row.title)).toEqual(["current"]);
  });

  it("clears by ranges, exact origins, ids and host without touching another identity", async () => {
    const f = fixture();
    const old = f.record("https://one.invalid/old", "old", work, local, START - 2 * DAY);
    f.record("https://one.invalid/new", "new", work, local, START - 10_000);
    f.record("https://one.invalid/remote", "remote", work, remote, START - 5000);
    f.record("https://child.one.invalid/", "other origin", work, local, START);
    f.record("https://one.invalid/owner", "owner", personal);
    await f.history.clear({ identityId: work, hostId: "all", historyRange: "hour", types: ["history"], origins: ["https://one.invalid"] });
    expect((await f.history.query({ identityId: work, hostId: local })).entries.map(row => row.title)).toEqual(["other origin", "old"]);
    expect((await f.history.query({ identityId: work, hostId: remote })).entries).toEqual([]);
    await f.history.remove({ identityId: work, hostId: local, ids: [old!] });
    await f.history.remove({ identityId: work, hostId: local, origin: "https://child.one.invalid" });
    expect((await f.history.query({ identityId: work, hostId: local })).entries).toEqual([]);
    expect((await f.history.query({ identityId: personal, hostId: local })).entries[0]?.title).toBe("owner");
  });

  it("never opens stores for private or ineligible URLs and drops identity or host files independently", async () => {
    const f = fixture();
    for (const url of ["about:blank", "http://127.0.0.1/", "http://10.0.0.5/", "http://host.local/", "https://user:pass@example.invalid/"]) {
      expect(f.record(url)).toBeUndefined();
    }
    expect(f.record("https://example.invalid/", "Unknown", "ccccdddd")).toBeUndefined();
    expect(existsSync(join(f.userData, "browser-history"))).toBe(false);
    f.record("https://one.invalid/");
    f.record("https://one.invalid/", "remote", work, remote);
    f.record("https://one.invalid/", "owner", personal);
    await f.history.dropHost(remote);
    expect(existsSync(join(f.userData, "browser-history", work, "ssh-fixture.sqlite"))).toBe(false);
    await f.history.dropIdentity(work);
    expect(existsSync(join(f.userData, "browser-history", work))).toBe(false);
    expect(existsSync(join(f.userData, "browser-history", personal, "local.sqlite"))).toBe(true);
  });
});

// The settings nav has one 主机 entry (owner 2026-11-07): a host's page has no nav row of its own, the nav marks
// 主机 while it shows, and cards that moved to a sub-page keep working as link and search targets.
import { describe, expect, it } from "vitest";
import { settingsNavGroups, settingsNavPage, settingsTab, subPageOfAnchor } from "../src/renderer/src/lib/settingsNav";
import { mergeMyDevices, type HostDevices } from "../src/renderer/src/lib/myDevices";
import { firstDevices } from "../src/renderer/src/modules/users/model";
import { problemStage } from "../src/renderer/src/lib/hosts";
import { parseHostsFile } from "../src/shared/hosts";
import type { UserTokenRecord } from "../src/shared/users";
import { matchesFilter } from "../src/renderer/src/lib/listFilter";

const entry = (page: string, navParent?: string) => ({ item: { page, group: "connection" as const, navParent } });
const pages = [entry("me"), entry("hosts"), entry("access", "hosts")];

describe("a detail page in the settings nav", () => {
  it("has no nav row, and search still sees it", () => {
    const shown = (details?: boolean) => settingsNavGroups(pages, details).flatMap((g) => g.entries.map((e) => e.item.page));
    expect(shown()).toEqual(["me", "hosts"]);
    expect(shown(true)).toEqual(["me", "hosts", "access"]);
  });

  it("marks its parent", () => {
    expect(settingsNavPage(pages, "access")).toBe("hosts");
    expect(settingsNavPage(pages, "hosts")).toBe("hosts");
    expect(settingsNavPage(pages, "me")).toBe("me");
  });

  it("old pages land on the host's page", () => {
    for (const tab of ["access", "users", "peers", "remote"]) expect(settingsTab({ tab })).toBe("access");
    expect(settingsTab({ tab: "hosts" })).toBe("hosts");
  });
});

describe("cards on a sub-page", () => {
  const item = { subPages: { peers: { anchors: ["peers-list", "users-peers"] }, advanced: { anchors: ["diagnostics"] }, devices: {} } };

  it("an anchor leads to the sub-page holding it", () => {
    expect(subPageOfAnchor(item, "peers-list")).toBe("peers");
    expect(subPageOfAnchor(item, "diagnostics")).toBe("advanced");
  });

  it("a card on the page itself stays there", () => {
    expect(subPageOfAnchor(item, "users-devices")).toBeUndefined();
    expect(subPageOfAnchor(item, null)).toBeUndefined();
    expect(subPageOfAnchor(undefined, "peers-list")).toBeUndefined();
  });
});

describe("filtering a sub-page's list", () => {
  it("matches any text, ignoring case; an empty filter keeps everything", () => {
    expect(matchesFilter("WAVE", "desktop", "waveline")).toBe(true);
    expect(matchesFilter("kks", "desktop", null)).toBe(false);
    expect(matchesFilter("  ", "desktop")).toBe(true);
  });
});

describe("this machine's own name", () => {
  it("survives a reload of hosts.json; an empty one is not kept", () => {
    const base = { version: 2, hosts: [], startOn: "last", scope: { kind: "host", id: "local" }, groups: [] };
    expect(parseHostsFile({ ...base, local: { autoConnect: true, color: "#112233", platform: null, label: " Desk " } }).local.label).toBe("Desk");
    expect(parseHostsFile({ ...base, local: { autoConnect: true, color: "#112233", platform: null, label: "  " } }).local.label).toBeUndefined();
  });
});

describe("devices on a host's page", () => {
  const device = (tokenId: string, userId: string | null) => ({ tokenId, userId }) as UserTokenRecord;
  const settled = Array.from({ length: 9 }, (_, i) => device(`t${i}`, "u1"));

  it("shows the waiting ones and the first eight, and leads to the rest", () => {
    const { rows, more } = firstDevices([...settled, device("waiting", null)], 8);
    expect(rows.map((r) => r.tokenId)).toEqual(["waiting", "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(more).toBe(true);
  });

  it("has no link when all of them fit", () => {
    expect(firstDevices(settled.slice(0, 8), 8).more).toBe(false);
  });
});

describe("where a connection stopped", () => {
  it("every connection problem has its step", () => {
    const codes = ["noSsh", "auth", "hostKey", "resolve", "refused", "timeout", "forward", "cutexNotFound", "cutexTooOld", "badOutput", "noToken", "noKeyring", "tokenRejected", "badInput", "exited", "remoteDaemon", "hostMismatch", "daemon"];
    for (const code of codes) expect(problemStage(code), code).not.toBeNull();
    expect(problemStage("timeout")).toBe("address");
    expect(problemStage("auth")).toBe("ssh");
    expect(problemStage("remoteDaemon")).toBe("cutex");
    expect(problemStage("tokenRejected")).toBe("credential");
    expect(problemStage(null)).toBeNull();
  });
});

describe("my devices across hosts", () => {
  const token = (tokenId: string, deviceName: string, platform = "ios") => ({ tokenId, deviceName, platform }) as unknown as UserTokenRecord;
  const host = (hostId: string, tokens: UserTokenRecord[], ownTokenId: string | null = null) => ({ hostId, hostLabel: hostId, ownTokenId, tokens });
  const merge = (hosts: HostDevices[]) => mergeMyDevices(hosts, (t) => t.deviceName ?? "").map((r) => [r.name, r.on.map((p) => p.tokenId), r.own]);

  it("one name and platform on several hosts is one row", () => {
    expect(merge([host("a", [token("a1", "iPhone")]), host("b", [token("b1", "iphone")])])).toEqual([["iPhone", ["a1", "b1"], false]]);
  });

  it("stays apart when it is not sure", () => {
    expect(merge([host("a", [token("a1", "Phone", "ios")]), host("b", [token("b1", "Phone", "android")])])).toHaveLength(2);
    expect(merge([host("a", [token("a1", "Phone"), token("a2", "Phone")]), host("b", [token("b1", "Phone")])])).toHaveLength(3);
  });

  it("this desktop's own token is its own row, first", () => {
    expect(merge([host("a", [token("a1", "Zed"), token("a2", "Desk")], "a2"), host("b", [token("b1", "Desk")])])).toEqual([
      ["Desk", ["a2"], true],
      ["Desk", ["b1"], false],
      ["Zed", ["a1"], false],
    ]);
  });
});

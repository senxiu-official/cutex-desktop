// Counted messages (i18n/index.tsx countKey): `<key>.one` for n = 1 where a catalog has it.
import { describe, expect, it } from "vitest";
import { countKey } from "../src/renderer/src/i18n";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const fill = (template: string, n: number) => template.replace("{n}", String(n));

describe("countKey", () => {
  const catalog = { "x.devices": "{n} Geräte", "x.devices.one": "1 Gerät", "x.peers": "{n} Peers" };
  const fallback = { "x.devices": "{n} devices", "x.devices.one": "1 device", "x.peers": "{n} peers", "x.peers.one": "1 peer", "x.hosts": "{n} hosts", "x.hosts.one": "1 host" };
  it("picks .one only for n = 1", () => {
    expect(countKey("x.devices", { n: 1 }, catalog, fallback)).toBe("x.devices.one");
    expect(countKey("x.devices", { n: 2 }, catalog, fallback)).toBe("x.devices");
    expect(countKey("x.devices", { n: 0 }, catalog, fallback)).toBe("x.devices");
    expect(countKey("x.devices", undefined, catalog, fallback)).toBe("x.devices");
  });
  it("keeps a catalog's own plural when only en has .one; uses en's .one when the key falls back to en anyway", () => {
    expect(countKey("x.peers", { n: 1 }, catalog, fallback)).toBe("x.peers");
    expect(countKey("x.hosts", { n: 1 }, catalog, fallback)).toBe("x.hosts.one");
    expect(countKey("x.none", { n: 1 }, catalog, fallback)).toBe("x.none");
  });
  it("fixes the English singulars of 用户 / 你 (no more “1 peers”)", () => {
    const keys = ["users.summary.devices", "users.summary.peers", "users.summary.projects", "users.summary.standalone", "me.access.standalone"] as const;
    for (const key of keys) {
      const one = countKey(key, { n: 1 }, en, en) as keyof typeof en;
      expect(one).toBe(`${key}.one`);
      expect(fill(en[one], 1)).not.toMatch(/^1 .*(s|{{agents}})$/);
      // zh has no plural: its .one reads like the plural
      expect(fill(zhCN[one], 1)).toBe(fill(zhCN[key], 1));
    }
    expect(en["users.summary.peers.one"]).toBe("1 linked host");
  });
});

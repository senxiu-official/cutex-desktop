import { describe, expect, it } from "vitest";
import { createPluginNetworkLockdown, lockdownProxy } from "../src/main/pluginNetwork";

describe("plugin network lockdown", () => {
  it("black-holes loopback too in production and only lets the dev renderer server through in dev", () => {
    expect(lockdownProxy().proxyBypassRules).toBe("<-loopback>");
    expect(lockdownProxy("http://localhost:5199/").proxyBypassRules).toBe("<-loopback>;localhost:5199");
    expect(lockdownProxy("https://127.0.0.1").proxyBypassRules).toBe("<-loopback>;127.0.0.1:443");
    expect(lockdownProxy("not a url").proxyBypassRules).toBe("<-loopback>");
    expect(lockdownProxy().proxyRules).toBe("socks5://127.0.0.1:9");
  });

  it("applies DNS before the proxy, once, and shares the pending attempt", async () => {
    const order: string[] = [];
    let release!: () => void;
    const lockdown = createPluginNetworkLockdown({
      configureHostResolver: () => order.push("dns"),
      setProxy: () => { order.push("proxy"); return new Promise<void>(resolve => { release = resolve; }); },
    });
    const first = lockdown.ensure(), second = lockdown.ensure();
    expect(first).toBe(second);
    release();
    await first;
    await lockdown.ensure();
    expect(order).toEqual(["dns", "proxy"]);
  });
});

import { describe, expect, it } from "vitest";
import { devRendererUrl } from "../src/main/devRenderer";
import { lockdownProxy } from "../src/main/pluginNetwork";

describe("development renderer isolation", () => {
  it.each(["https://untrusted.example/", "http://127.0.0.1:5199", "file:///tmp/untrusted.html"])("ignores %s in a packaged build", value => {
    const url = devRendererUrl(true, { ELECTRON_RENDERER_URL: value });
    expect(url).toBeUndefined();
    expect(lockdownProxy(url).proxyBypassRules).toBe("<-loopback>");
  });
  it("preserves the development server and its containment exception for unpackaged runs", () => {
    const url = devRendererUrl(false, { ELECTRON_RENDERER_URL: "http://127.0.0.1:5199" });
    expect(url).toBe("http://127.0.0.1:5199");
    expect(lockdownProxy(url).proxyBypassRules).toBe("<-loopback>;127.0.0.1:5199");
    expect(devRendererUrl(false, {})).toBeUndefined();
  });
});

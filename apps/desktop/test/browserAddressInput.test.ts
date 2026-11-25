// 浏览器身份 package D: what the address bar does with typed text (design browser-profiles v3 §10).
import { describe, expect, it } from "vitest";
import { classifyAddress } from "../src/renderer/src/modules/browser/addressInput";

const g = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

describe("classifyAddress", () => {
  it.each([
    ["https://example.com/a", { kind: "url", url: "https://example.com/a" }],
    ["example.com", { kind: "url", url: "https://example.com/" }],
    ["foo.co.uk/path?x=1", { kind: "url", url: "https://foo.co.uk/path?x=1" }],
    ["localhost:3000", { kind: "url", url: "http://localhost:3000/" }],
    ["192.0.2.20:8123", { kind: "url", url: "https://192.0.2.20:8123/" }],
    ["about:blank", { kind: "url", url: "about:blank" }],
  ])("%s opens as an address", (input, out) => {
    expect(classifyAddress(input, "google")).toMatchObject(out);
  });

  it.each([
    ["rust borrow checker", g("rust borrow checker")],
    ["?example.com", g("example.com")],
    ["what is example.com", g("what is example.com")],
    ["天气 悉尼", g("天气 悉尼")],
    ["1+1", g("1+1")],
  ])("%s searches", (input, url) => {
    const out = classifyAddress(input, "google");
    expect(out).toMatchObject({ kind: "search", url });
    expect("alt" in out && out.alt).toBeFalsy();
  });

  it("a bare word searches and offers the intranet host", () => {
    expect(classifyAddress("intranet", "google")).toEqual({ kind: "search", url: g("intranet"), query: "intranet", alt: "http://intranet/" });
    expect(classifyAddress("Wiki:8080", "bing")).toMatchObject({ kind: "search", url: "https://www.bing.com/search?q=Wiki%3A8080", alt: "http://wiki:8080/" });
  });

  it("uses the chosen engine", () => {
    expect(classifyAddress("cats", "duckduckgo")).toMatchObject({ url: "https://duckduckgo.com/?q=cats" });
    expect(classifyAddress("猫", "baidu")).toMatchObject({ url: `https://www.baidu.com/s?wd=${encodeURIComponent("猫")}` });
  });

  it.each(["javascript:alert(1)", "file:///C:/x", "https://user@example.com/", "?", "user@example.com"])("%s is refused, never searched", (input) => {
    expect(classifyAddress(input, "google").kind).toBe("error");
  });
});

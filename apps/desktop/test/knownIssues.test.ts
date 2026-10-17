// Known issues fetched from the release branch: the schema-1 parser (shared/knownIssues.ts), version
// filtering, the main-process source (main/knownIssues.ts: size cap, timeout, cache, fallback) and the
// renderer's choice between the fetched and the built-in list.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applicableIssues, inRange, KNOWN_ISSUES_MAX_BYTES, localizedText, parseKnownIssues, parseRange, type KnownIssuesDoc } from "../src/shared/knownIssues";
import { handleKnownIssuesRequest, KNOWN_ISSUES_MAX_AGE_MS, KNOWN_ISSUES_MIN_INTERVAL_MS, KNOWN_ISSUES_URL, KnownIssuesSource } from "../src/main/knownIssues";
import type { Transport, TransportResponse } from "../src/main/updateTransport";

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {} }));
const { knownIssuesView, BUNDLED_KNOWN_ISSUES } = await import("../src/renderer/src/modules/about/knownIssues");

const t = (en: string, zh = `中文 ${en}`) => ({ "zh-CN": zh, en });
const issue = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: t(`title ${id}`), body: t(`body ${id}`), ...extra });
const doc = (issues: unknown[], extra: Record<string, unknown> = {}) => ({ schema: 1, issues, ...extra });

describe("parseKnownIssues", () => {
  it("keeps valid entries, ignores unknown fields and unknown locales", () => {
    const parsed = parseKnownIssues(doc([issue("a", { workaround: { ...t("do x"), "zh-Hant-CN": "做 x", "xx-YY": "?" }, fixedIn: "0.1.3", future: { any: 1 } })], { updated: "2026-10-16", extra: true }));
    expect(parsed).toEqual({
      schema: 1,
      issues: [{ id: "a", title: t("title a"), body: t("body a"), workaround: { ...t("do x"), "zh-Hant-CN": "做 x" }, fixedIn: "0.1.3" }],
    });
  });

  it("rejects documents of another shape as a whole", () => {
    expect(parseKnownIssues(null)).toBeNull();
    expect(parseKnownIssues([])).toBeNull();
    expect(parseKnownIssues({ issues: [] })).toBeNull();
    expect(parseKnownIssues({ schema: 2, issues: [] })).toBeNull();
    expect(parseKnownIssues({ schema: "1", issues: [] })).toBeNull();
    expect(parseKnownIssues({ schema: 1, issues: {} })).toBeNull();
    expect(parseKnownIssues(doc(Array.from({ length: 101 }, (_, i) => issue(`i${i}`))))).toBeNull();
  });

  it("drops entries that break a rule and keeps the rest", () => {
    const bad = [
      issue("bad id!"),
      { id: "noTitle", body: t("b") },
      issue("noEn", { title: { "zh-CN": "只有中文" } }),
      issue("noZh", { body: { en: "english only" } }),
      issue("number", { title: { "zh-CN": "标题", en: 5 } }),
      issue("html", { body: t("x\u0007y") }),
      issue("bidi", { title: t("abc‮def") }),
      issue("long", { body: t("x".repeat(2001)) }),
      issue("empty", { title: t("   ") }),
      issue("badFix", { fixedIn: 3 }),
      issue("badRange", { appliesTo: { desktop: "soon" } }),
      issue("badApplies", { appliesTo: "<0.1.3" }),
      issue("badWorkaround", { workaround: "plain string" }),
      "not an object",
      issue("ok"),
      issue("ok", { title: t("duplicate") }),
    ];
    const parsed = parseKnownIssues(doc(bad));
    expect(parsed?.issues.map((i) => i.id)).toEqual(["ok"]);
    expect(parsed?.issues[0]?.title.en).toBe("title ok");
  });

  it("allows line breaks, trims, and treats markup as plain text", () => {
    const parsed = parseKnownIssues(doc([issue("m", { body: t("  <b>line one</b>\n[link](https://example.com)  ") })]));
    expect(parsed?.issues[0]?.body.en).toBe("<b>line one</b>\n[link](https://example.com)");
  });
});

describe("version ranges", () => {
  it("parses comparators and refuses anything else", () => {
    expect(parseRange("<0.1.3")).toHaveLength(1);
    expect(parseRange(">=0.1.0 <0.1.3")).toHaveLength(2);
    expect(parseRange("0.1.2")).toEqual([{ op: "=", version: expect.objectContaining({ major: 0, minor: 1, patch: 2 }) }]);
    for (const bad of ["", "soon", "<", "~0.1.2", "^1.0.0", "<0.1", 5]) expect(parseRange(bad), String(bad)).toBeNull();
  });

  it("matches versions; unknown running versions count as inside", () => {
    expect(inRange("<0.1.3", "0.1.2")).toBe(true);
    expect(inRange("<0.1.3", "0.1.3")).toBe(false);
    expect(inRange("<0.1.3", "0.1.3-rc.1")).toBe(true);
    expect(inRange(">=0.1.0 <0.1.3", "v0.1.0")).toBe(true);
    expect(inRange(">=0.1.0 <0.1.3", "0.0.9")).toBe(false);
    expect(inRange("=0.1.2", "0.1.2")).toBe(true);
    expect(inRange(">0.1.2", "0.1.2")).toBe(false);
    expect(inRange("<=0.1.2", "0.1.2")).toBe(true);
    expect(inRange("<0.1.3", null)).toBe(true);
    expect(inRange("<0.1.3", "r227")).toBe(true);
  });

  it("hides entries outside their desktop / cutex range", () => {
    const parsed = parseKnownIssues(doc([issue("always"), issue("oldDesktop", { appliesTo: { desktop: "<0.1.3" } }), issue("oldCutex", { appliesTo: { cutex: "<0.1.2" } })]))!;
    const ids = (versions: { desktop?: string | null; cutex?: string | null }) => applicableIssues(parsed, versions).map((i) => i.id);
    expect(ids({})).toEqual(["always", "oldDesktop", "oldCutex"]);
    expect(ids({ desktop: "0.1.3", cutex: "0.1.1" })).toEqual(["always", "oldCutex"]);
    expect(ids({ desktop: "0.1.2", cutex: "0.1.2" })).toEqual(["always", "oldDesktop"]);
  });
});

describe("localizedText", () => {
  it("uses the locale's string, zh-Hant-CN falls back to zh-CN, others to en", () => {
    const v = { "zh-CN": "简", en: "en", "ja-JP": "日" };
    expect(localizedText(v, "zh-CN")).toBe("简");
    expect(localizedText(v, "ja-JP")).toBe("日");
    expect(localizedText(v, "zh-Hant-CN")).toBe("简");
    expect(localizedText({ ...v, "zh-Hant-CN": "繁" }, "zh-Hant-CN")).toBe("繁");
    expect(localizedText(v, "de-DE")).toBe("en");
    expect(localizedText(v, "en-AU")).toBe("en");
  });
});

// ---- main/knownIssues.ts ----

function response(status: number, body: string | Uint8Array[], headers: Record<string, string> = {}): TransportResponse & { cancelled: boolean } {
  const chunks = typeof body === "string" ? [new TextEncoder().encode(body)] : body;
  const res = {
    status,
    cancelled: false,
    header: (name: string) => headers[name.toLowerCase()] ?? null,
    body: (async function* () {
      for (const c of chunks) yield c;
    })(),
    cancel: () => void (res.cancelled = true),
  };
  return res;
}

describe("KnownIssuesSource", () => {
  let dir: string;
  let now: number;
  let calls: { url: string; headers: Record<string, string> }[];
  let reply: () => Promise<TransportResponse>;
  const transport: Transport = (url, init) => {
    calls.push({ url, headers: init.headers });
    return reply();
  };
  const remote = doc([issue("remote")]);
  const make = (opts: Partial<ConstructorParameters<typeof KnownIssuesSource>[0]> = {}) => new KnownIssuesSource({ transport, cacheFile: join(dir, "known-issues.json"), now: () => now, ...opts });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cutex-known-issues-"));
    now = Date.parse("2026-10-16T10:00:00Z");
    calls = [];
    reply = async () => response(200, JSON.stringify(remote));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("fetches the release branch's raw file, validates it and caches it in userData", async () => {
    expect(KNOWN_ISSUES_URL).toBe("https://raw.githubusercontent.com/senxiu-official/cutex-desktop/release/docs/known-issues.json");
    const result = await make().get();
    expect(calls.map((c) => c.url)).toEqual([KNOWN_ISSUES_URL]);
    expect(calls[0]!.headers["User-Agent"]).toBeTruthy();
    expect(result).toEqual({ source: "github", doc: parseKnownIssues(remote), fetchedAt: "2026-10-16T10:00:00.000Z" });
    const cached = JSON.parse(readFileSync(join(dir, "known-issues.json"), "utf8"));
    expect(cached).toEqual({ doc: parseKnownIssues(remote), fetchedAt: "2026-10-16T10:00:00.000Z" });
  });

  it("answers a recent copy without fetching again; refresh and age fetch again", async () => {
    const source = make();
    await source.get();
    now += 60_000;
    await source.get();
    expect(calls).toHaveLength(1);
    await source.get(true);
    expect(calls).toHaveLength(2);
    now += KNOWN_ISSUES_MAX_AGE_MS;
    await source.get();
    expect(calls).toHaveLength(3);
  });

  it("rate-limits attempts, also refreshes and failures", async () => {
    reply = async () => {
      throw new Error("offline");
    };
    const source = make();
    expect(await source.get()).toEqual({ source: "none", error: "offline" });
    await source.get(true);
    expect(calls).toHaveLength(1);
    now += KNOWN_ISSUES_MIN_INTERVAL_MS;
    await source.get(true);
    expect(calls).toHaveLength(2);
  });

  it("shares one fetch between concurrent requests", async () => {
    const source = make();
    const [a, b] = await Promise.all([source.get(), source.get()]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it("keeps the last good copy (from disk too) when a later fetch fails", async () => {
    await make().get();
    reply = async () => response(404, "Not Found");
    now += KNOWN_ISSUES_MAX_AGE_MS + 1;
    const second = make(); // a new run: reads the cache file
    expect(await second.get()).toEqual({ source: "github", doc: parseKnownIssues(remote), fetchedAt: "2026-10-16T10:00:00.000Z", stale: true, error: "HTTP 404" });
  });

  it("refuses non-200 answers (redirects are not followed), oversized and invalid bodies", async () => {
    const cases: [() => Promise<TransportResponse>, RegExp][] = [
      [async () => response(302, "", { location: "https://evil.example/x.json" }), /HTTP 302/],
      [async () => response(200, "{}", { "content-length": String(KNOWN_ISSUES_MAX_BYTES + 1) }), /larger than/],
      [async () => response(200, [new Uint8Array(200 * 1024), new Uint8Array(100 * 1024)]), /larger than/],
      [async () => response(200, "not json"), /JSON|Unexpected/],
      [async () => response(200, JSON.stringify({ schema: 2, issues: [] })), /not a valid/],
      [async () => response(200, [new Uint8Array([0xff, 0xfe])]), /./],
    ];
    for (const [r, error] of cases) {
      calls = [];
      reply = r;
      const result = await make({ cacheFile: join(dir, `c-${Math.random()}.json`) }).get();
      expect(result.source).toBe("none");
      expect(result.error).toMatch(error);
    }
  });

  it("gives up after the timeout", async () => {
    reply = () => new Promise(() => {});
    const source = new KnownIssuesSource({
      transport: (url, init) =>
        new Promise((_, reject) => {
          calls.push({ url, headers: init.headers });
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
      cacheFile: join(dir, "known-issues.json"),
      timeoutMs: 20,
    });
    expect(await source.get()).toEqual({ source: "none", error: "timed out" });
  });

  it("ignores an invalid cache file", async () => {
    writeFileSync(join(dir, "known-issues.json"), JSON.stringify({ doc: { schema: 1, issues: "x" }, fetchedAt: "2026-10-16T09:00:00Z" }));
    reply = async () => {
      throw new Error("offline");
    };
    expect((await make().get()).source).toBe("none");
  });

  it("the IPC handler accepts only op get", async () => {
    const source = make();
    await expect(handleKnownIssuesRequest(source, { op: "get" })).resolves.toMatchObject({ source: "github" });
    expect(() => handleKnownIssuesRequest(source, { op: "set" } as never)).toThrow("unknown known-issues op");
    expect(() => handleKnownIssuesRequest(source, null as never)).toThrow("unknown known-issues op");
  });
});

describe("knownIssuesView (renderer)", () => {
  it("shows the fetched list when valid, else the built-in one", () => {
    const fetched = parseKnownIssues(doc([issue("remote")])) as KnownIssuesDoc;
    expect(knownIssuesView({ source: "github", doc: fetched, fetchedAt: "2026-10-16T10:00:00Z" })).toEqual({ issues: fetched.issues, source: "github", fetchedAt: "2026-10-16T10:00:00Z" });
    expect(knownIssuesView({ source: "github", doc: fetched, fetchedAt: "2026-10-16T10:00:00Z", stale: true, error: "HTTP 404" })).toMatchObject({ source: "github", stale: true });
    expect(knownIssuesView({ source: "none", error: "offline" })).toEqual({ issues: BUNDLED_KNOWN_ISSUES.issues, source: "builtin" });
    expect(knownIssuesView(null)).toEqual({ issues: BUNDLED_KNOWN_ISSUES.issues, source: "builtin" });
    // A malformed answer (never from main, but the renderer re-checks) falls back too.
    expect(knownIssuesView({ source: "github", doc: { schema: 2 } as never, fetchedAt: "x" }).source).toBe("builtin");
  });
});

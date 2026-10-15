import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginResourceService } from "../src/main/plugins";

const temporary: string[] = [];
afterEach(() => { temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function fixture(extra: Record<string, unknown> = {}, options: { now?: () => number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cutex-plugin-test-")); temporary.push(root);
  const catalog = join(root, "plugins"), directory = join(catalog, "sample"); mkdirSync(directory, { recursive: true });
  const manifest = { apiVersion: 1, id: "sample", name: "Example", version: "1.0.0", entry: "index.html", script: "main.js", styles: ["style.css"], capabilities: ["views"], contributes: { "main.page": [{ id: "sample.page", title: "Example" }] }, ...extra };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest)); writeFileSync(join(directory, "index.html"), "<p>safe local package</p>");
  writeFileSync(join(directory, "main.js"), 'window.example = true;'); writeFileSync(join(directory, "style.css"), "p { color: red; }");
  const service = createPluginResourceService(catalog, options);
  const request = () => ({ pluginId: "sample", fingerprint: service.list().plugins[0]!.fingerprint, instanceId: randomUUID(), channel: randomUUID() });
  return { root, catalog, directory, service, request };
}
describe("main-owned plugin resources", () => {
  it("lists validated metadata and serves one bounded, opaque, framework-bootstrapped document", async () => {
    const f = fixture(), catalog = f.service.list();
    expect(catalog.errors).toEqual([]); expect(catalog.plugins[0]!.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const request = f.request(), prepared = f.service.prepare(1, request), response = f.service.respond(new Request(prepared.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    const html = await response.text(); expect(html).toContain("safe local package"); expect(html).toContain("sandboxBridge");
    expect(html).toContain(request.channel); expect(html).not.toContain(f.root); expect(html).not.toContain("window.cutex");
    expect(f.service.respond(new Request(prepared.url)).status).toBe(404);
  });
  it("refuses stale fingerprints when either code or manifest changes", () => {
    const f = fixture(), original = f.request(); writeFileSync(join(f.directory, "main.js"), "window.changed = true;");
    expect(() => f.service.prepare(1, original)).toThrow(/changed/);
    const next = f.request(); writeFileSync(join(f.directory, "manifest.json"), JSON.stringify({ ...f.service.list().plugins[0]!.manifest, name: "Updated" }));
    expect(() => f.service.prepare(1, next)).toThrow(/changed/);
  });
  it("refuses malformed packages, unsupported authority and identity mismatch", () => {
    for (const patch of [{ id: "other" }, { capabilities: ["daemon.sessions"] }, { entry: "../secret.html" }, { required: true }]) {
      const f = fixture(patch); expect(f.service.list().plugins).toEqual([]); expect(f.service.list().errors).toHaveLength(1);
      expect(JSON.stringify(f.service.list())).not.toContain(f.root);
    }
  });
  it("bounds asset size and rejects invalid UTF-8 and malformed JSON", () => {
    const f = fixture(); writeFileSync(join(f.directory, "main.js"), "x".repeat(512 * 1024 + 1)); expect(f.service.list().plugins).toEqual([]);
    writeFileSync(join(f.directory, "main.js"), Buffer.from([0xff, 0xfe])); expect(f.service.list().plugins).toEqual([]);
    writeFileSync(join(f.directory, "manifest.json"), "{broken"); expect(f.service.list().plugins).toEqual([]);
  });
  it.skipIf(process.platform === "win32")("refuses symlinked assets, package directories and catalogs", () => {
    const f = fixture(); writeFileSync(join(f.root, "secret.js"), "secret"); rmSync(join(f.directory, "main.js"));
    symlinkSync(join(f.root, "secret.js"), join(f.directory, "main.js")); expect(f.service.list().plugins).toEqual([]);
    const g = fixture(); symlinkSync(g.directory, join(g.catalog, "other"), "dir"); expect(g.service.list().errors).toContainEqual({ id: "other", message: "Plugin package is invalid or unreadable" });
    const link = join(g.root, "linked"); symlinkSync(g.catalog, link, "dir"); expect(createPluginResourceService(link).list().plugins).toEqual([]);
  });
  it("refuses hardlinked assets", () => {
    const f = fixture(); writeFileSync(join(f.root, "secret.js"), "secret"); rmSync(join(f.directory, "main.js"));
    linkSync(join(f.root, "secret.js"), join(f.directory, "main.js")); expect(f.service.list().plugins).toEqual([]);
  });
  it("binds release to its renderer owner and revokes all prepared resources on reload", () => {
    const f = fixture(), a = f.service.prepare(1, f.request()), b = f.service.prepare(2, f.request());
    f.service.release(2, a.id); expect(f.service.respond(new Request(a.url)).status).toBe(200);
    const c = f.service.prepare(1, f.request()); f.service.releaseOwner(1);
    expect(f.service.respond(new Request(c.url)).status).toBe(404); expect(f.service.respond(new Request(b.url)).status).toBe(200);
    const d = f.service.prepare(1, f.request()); f.service.release(1, d.id); expect(f.service.respond(new Request(d.url)).status).toBe(404);
  });
  it("authorizes only the owner's exact prepared URL, retaining identity after consumption until release", () => {
    const f = fixture(), prepared = f.service.prepare(1, f.request());
    expect(f.service.ownsUrl(prepared.url, 1)).toBe(true); expect(f.service.ownsUrl(prepared.url, 2)).toBe(false);
    for (const url of ["https://example.com", prepared.url + "?changed", prepared.url.replace("frame/", "other/"), "cutex-plugin://frame/unknown/index.html"]) expect(f.service.ownsUrl(url, 1)).toBe(false);
    expect(f.service.respond(new Request(prepared.url)).status).toBe(200); expect(f.service.ownsUrl(prepared.url, 1)).toBe(true);
    expect(f.service.respond(new Request(prepared.url)).status).toBe(404);
    f.service.releaseOwner(1); expect(f.service.ownsUrl(prepared.url, 1)).toBe(false);
  });
  it("expires unconsumed URLs and limits preparation without touching package files", () => {
    let now = 100; const f = fixture({}, { now: () => now }), first = f.service.prepare(1, f.request());
    for (let i = 1; i < 8; i++) f.service.prepare(1, f.request()); expect(() => f.service.prepare(1, f.request())).toThrow(/Too many/);
    now += 30001; expect(f.service.respond(new Request(first.url)).status).toBe(404); expect(() => f.service.prepare(1, f.request())).not.toThrow();
  });
  it("rejects malformed document requests and URL variants without consuming the legitimate URL", () => {
    const f = fixture(), request = f.request();
    for (const patch of [{ html: "arbitrary" }, { pluginId: "../secret" }, { instanceId: "bad" }, { channel: "bad" }, { fingerprint: "bad" }]) {
      expect(() => f.service.prepare(1, { ...request, ...patch })).toThrow(/Invalid/);
    }
    const resource = f.service.prepare(1, request);
    expect(f.service.respond(new Request(resource.url + "?extra=1")).status).toBe(404);
    expect(f.service.respond(new Request(resource.url, { method: "POST" })).status).toBe(404);
    expect(f.service.respond(new Request(resource.url)).status).toBe(200);
  });
  it("treats a missing catalog as empty without creating an installation directory", () => {
    const f = fixture(); expect(createPluginResourceService(join(f.root, "missing")).list()).toEqual({ plugins: [], errors: [] });
  });
});

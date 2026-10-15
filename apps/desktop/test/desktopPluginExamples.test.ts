import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPluginResourceService } from "../src/main/plugins";

it("every checked-in example loads its manifest and assets through the actual main-process catalog", async () => {
  const directory = resolve(__dirname, "../../../examples/plugins");
  const ids = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  expect(ids.length).toBeGreaterThan(0);
  const service = createPluginResourceService(directory);
  const catalog = service.list();
  expect(catalog.errors).toEqual([]);
  expect(catalog.plugins.map(({ manifest }) => manifest.id).sort()).toEqual(ids);
  for (const { manifest, fingerprint } of catalog.plugins) {
    const prepared = service.prepare(1, { pluginId: manifest.id, fingerprint, instanceId: randomUUID(), channel: randomUUID() });
    const response = service.respond(new Request(prepared.url));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(readFileSync(resolve(directory, manifest.id, manifest.entry), "utf8"));
    expect(html).toContain("sandboxBridge");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts");
    service.release(1, prepared.id);
  }
});

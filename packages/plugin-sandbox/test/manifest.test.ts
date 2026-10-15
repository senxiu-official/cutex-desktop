import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "../src/manifest";

const base = () => ({ apiVersion: 1, id: "desk-note", name: "Desk note", version: "1.0.0", entry: "index.html", script: "main.js",
  capabilities: ["views", "entries", "settings"], contributes: { "main.page": [{ id: "desk-note.page", title: "Notes" }], "nav.primary": [{ id: "desk-note.nav", title: "Notes", page: "desk-note.page" }] } });
describe("strict external manifests", () => {
  it("normalizes only supported declarations, preserving owned page targets", () => {
    const value = parsePluginManifest(base());
    expect(value.requires).toEqual({ hosts: "any", cutexCapabilities: [] });
    expect(value.styles).toEqual([]); expect(value.dependencies).toEqual([]);
    expect(parsePluginManifest(value)).toEqual(value);
  });
  it.each(["commands", "status", "browser", "daemon.sessions", "sessions.read", "layouts", "surfaces"])("refuses unsupported %s capabilities", capability => {
    expect(() => parsePluginManifest({ ...base(), capabilities: [capability] })).toThrow(/Unsupported plugin capability/);
  });
  it.each(["../secret.html", "/secret.html", "sub/../../secret.html", "C:\\secret.html", "https://host/index.html", "%2e%2e/index.html", "sub//index.html"])("refuses an escaping entry %s", entry => {
    expect(() => parsePluginManifest({ ...base(), entry })).toThrow(/asset path/);
  });
  it("rejects unknown fields, unsupported contributions and cross-owner links", () => {
    for (const patch of [{ enabled: true }, { required: true }, { requires: { host: "local" } }, { contributes: { "timeline.tool": [] } },
      { contributes: { "main.page": [{ id: "shell.page", title: "bad" }] } },
      { contributes: { "main.page": [{ id: "desk-note.page", title: "ok" }], "nav.primary": [{ id: "desk-note.nav", title: "bad", page: "shell.settings" }] } },
      { capabilities: [] }, { apiVersion: 2 }, { id: "a".repeat(56) }, { dependencies: ["desk-note"] }, { styles: ["styles.css", "styles.css"] }]) {
      expect(() => parsePluginManifest({ ...base(), ...patch })).toThrow();
    }
  });
});

// A module's `settings.section` only shows if its target page places <SettingsSections page="…" />
// (the 书签 card on 侧栏与顶栏 was registered but never rendered).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");

const RENDERER = fileURLToPath(new URL("../src/renderer/src/", import.meta.url));

function placedPages(): Set<string> {
  const pages = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) {
        for (const m of readFileSync(path, "utf8").matchAll(/<SettingsSections\s+page="([^"]+)"/g)) pages.add(m[1]!);
      }
    }
  };
  walk(RENDERER);
  return pages;
}

describe("settings sections", () => {
  it("every settings.section lands on a page that renders module sections", () => {
    const placed = placedPages();
    const sections = MODULES.flatMap((m) => (m.contributes?.["settings.section"] ?? []).map((s) => ({ id: s.id, page: s.page })));
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) expect(placed.has(s.page), `${s.id} → ${s.page}`).toBe(true);
  });
});

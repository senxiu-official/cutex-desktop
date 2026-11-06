// One toast face (design 040 §2.1, owner 2026-11-05): the composer's notice line, agent toasts, the Shelf toast and the
// desk notice all wear `.float .float-toast` — no red box, no second border / shadow / corner of their own.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(resolve(__dirname, "../src/renderer/src", p), "utf8");

describe("one toast face", () => {
  it.each(["components/Composer.tsx", "components/AgentToasts.tsx", "components/side/ShelfToast.tsx", "components/DeskPerformanceNotice.tsx"])("%s", (p) => {
    const code = src(p);
    expect(code).toMatch(/className="float float-toast[ "]/);
    expect(code).not.toMatch(/motion-toast-in/);
  });

  it("the composer's error notice leads with a danger icon instead of a red bordered box", () => {
    const code = src("components/Composer.tsx");
    expect(code).toContain('data-tone={shownNotice.tone === "error" ? "error" : undefined}');
    expect(code).not.toMatch(/rounded border border-border bg-surface px-2 text-xs/);
    expect(src("styles.css")).toMatch(/\.float-toast\[data-tone="error"\] > \[data-toast-icon\] \{\s*color: var\(--danger\);/);
  });
});

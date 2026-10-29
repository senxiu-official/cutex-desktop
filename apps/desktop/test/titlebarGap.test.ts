// Design 040 step 11 (owner 2026-10-23, answer A): the title bar stays a full-width strip (its caption buttons in the
// window corner) and the cards below keep the standard 8 px gap to it — except 贴边显示 (edge to edge), which keeps
// no gaps at all.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(__dirname, "../src/renderer/src", p), "utf8");

describe("the gap under the title bar", () => {
  it("the pane host and the full Settings layer pad 8 px at the top too", () => {
    expect(src("components/PaneHost.tsx")).toMatch(/data-pane-host="" className=\{`relative flex min-h-0 flex-1 pt-2 pr-2 pb-2/);
    expect(src("components/SettingsShelf.tsx")).toMatch(/data-settings-max="" [^>]*className="absolute inset-0 z-\[45\] flex bg-win pt-2 pr-2 pb-2 pl-2/);
  });

  it("edge to edge still has no padding at all (the cards meet the bar)", () => {
    expect(src("styles.css")).toMatch(/:root\[data-edge-to-edge\] \[data-pane-host\] \{\s*padding: 0;/);
  });
});

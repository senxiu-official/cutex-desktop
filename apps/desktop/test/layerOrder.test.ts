// @vitest-environment jsdom
// Menus / popovers / tooltips are always on top (owner 2026-10-23: the 「独占」 foretell outline crossed the open
// Shelf ⋯ menu). The order (styles.css 「Layers」): panes ≤ 39 < Settings Shelf 45 < drag shields 47 < foretell / drop
// previews 48 < drop labels / ghost 49 < every menu, popover, dialog ≥ 50 — and since a popover inside a pane can
// never rise above a window-level layer (its card's stacking context), the preview layers leave a hole where each
// open popover is (lib/overlayHoles).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { holesClip, openPopoverBoxes, POPOVER_SELECTOR } from "../src/renderer/src/lib/overlayHoles";

const src = (p: string) => readFileSync(resolve(__dirname, "../src/renderer/src", p), "utf8");
const zs = (text: string) => [...text.matchAll(/\bz-\[(\d+)\]|\bz-(\d+)\b/g)].map((m) => Number(m[1] ?? m[2]));

describe("the layer order", () => {
  it("foretell and drop previews: above the panes and the Settings Shelf, under every menu / popover (< 50)", () => {
    const z = Number(/z-index: (\d+);/.exec(src("components/foretell.css").split(".foretell-layer {")[1]!)![1]);
    expect(z).toBeGreaterThan(45);
    expect(z).toBeLessThan(50);
    for (const p of ["components/side/SideDndLayer.tsx", "components/WorkspaceDndLayer.tsx"]) {
      const all = zs(src(p));
      expect(all.length).toBeGreaterThan(0);
      for (const n of all) {
        expect(n, p).toBeGreaterThanOrEqual(47);
        expect(n, p).toBeLessThan(50);
      }
    }
  });

  it("every menu, popover, flyout, palette and dialog is at 50 or more", () => {
    const popovers: [string, RegExp][] = [
      ["components/Overlays.tsx", /role="menu"[\s\S]{0,80}?className="fixed z-50/],
      ["components/Menu.tsx", /data-popover=\{open \? "" : undefined\}\s+className=\{`absolute bottom-full z-\[51\]/],
      ["components/SlashPalette.tsx", /data-popover="" className="absolute [^"]*z-50/],
      ["components/ComposerPanels.tsx", /data-popover="" className=\{`absolute [^`]*z-50/],
      ["components/MenuFlyout.tsx", /data-flyout="" data-popover="" className="fixed z-\[52\]/],
      ["components/StatusChip.tsx", /data-popover="" className=\{`absolute [^`]*z-50/],
      ["components/PendingOwnerNotes.tsx", /data-popover="" className="absolute [^"]*z-50/],
      ["components/GoalBar.tsx", /popover className="absolute [^"]*z-50/],
      ["components/HostPicker.tsx", /role="listbox" data-popover="" [^>]*z-50/],
      ["components/settings/FontCombo.tsx", /role="listbox" data-popover="" className="absolute [^"]*z-50/],
      ["components/settings/Form.tsx", /role="note" data-popover="" [^>]*className="fixed z-\[60\]/],
      ["components/RestoreBanner.tsx", /role="dialog" [^>]*z-50/],
      ["modules/status-capsule/StatusCapsule.tsx", /role="menu" className="absolute [^"]*z-50/],
      ["components/ProjectFlyout.tsx", /className="fixed z-50/],
      ["components/AgentListDialog.tsx", /fixed inset-0 z-50/],
      ["components/JobParts.tsx", /fixed inset-0 z-50/],
      ["modules/projects/MemberPicker.tsx", /fixed inset-0 z-50/],
      ["modules/projects/DirectorRotationDialog.tsx", /fixed inset-0 z-50/],
      ["modules/claude-accounts/AccountFlow.tsx", /fixed inset-0 z-50/],
      ["modules/jobs/MarkExternalDialog.tsx", /fixed inset-0 z-50/],
      ["modules/usage/UsagePage.tsx", /fixed inset-0 z-50/],
    ];
    for (const [p, re] of popovers) expect(src(p), p).toMatch(re);
  });

  it("each preview layer cuts a hole for the open popovers", () => {
    expect(src("components/ForetellLayer.tsx")).toContain("useOverlayHoles(!!shown)");
    expect(src("components/side/SideDndLayer.tsx")).toContain("useOverlayHoles(!!drag)");
    expect(src("components/WorkspaceDndLayer.tsx")).toContain("useOverlayHoles(!!s.ref)");
  });
});

describe("lib/overlayHoles", () => {
  it("no popover: no clip; one popover: the window with a rounded hole (even-odd)", () => {
    expect(holesClip(1500, 900, [])).toBeUndefined();
    expect(holesClip(1500, 900, [{ left: 0, top: 0, width: 0, height: 10 }])).toBeUndefined();
    const clip = holesClip(1500, 900, [{ left: 100, top: 200, width: 300, height: 400 }])!;
    expect(clip.startsWith('path(evenodd, "M0,0H1500V900H0Z M112,200H388A12,12')).toBe(true);
  });

  it("what counts: menus, dialogs, tooltips and marked popovers — not a list in a pane, not the preview layers' own parts", () => {
    document.body.innerHTML = `
      <div role="menu" id="a"></div>
      <div data-popover id="b"></div>
      <ul role="listbox" id="c"></ul>
      <div data-foretell><div role="dialog" id="d"></div></div>`;
    for (const el of document.querySelectorAll<HTMLElement>("[id]")) el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 50, height: 20, right: 60, bottom: 30, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    expect(POPOVER_SELECTOR).not.toContain("listbox");
    expect(openPopoverBoxes()).toHaveLength(2);
  });
});

// @vitest-environment jsdom
// The composer row's quota rings after the owner's per-gauge choices (by name, all Profiles) and
// same-reset merging (lib/quota composerGauges), plus the prefs migration that turns the removed
// global 「显示重置时间」 switch into each gauge's countdown default.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaGauge } from "../src/shared/ipc";

const H = 3600;
const at = (h: number) => Math.round(Date.now() / 1000 + h * H);
const w = (id: string, windowLabel: string, remainingPercent: number | null, resetAt: number | null): QuotaGauge =>
  ({ id, label: "Claude", kind: "window", remainingPercent, balance: null, resetAt, windowLabel, observedAt: Date.now() / 1000, stale: false }) as QuotaGauge;
const bal = (id: string, balance: string): QuotaGauge => ({ id, label: "Credits", kind: "balance", remainingPercent: null, balance, resetAt: null, windowLabel: null, observedAt: Date.now() / 1000, stale: false }) as QuotaGauge;

/** The mock claude profile's shape: 5h + two weekly windows that reset together. */
const claude = (): QuotaGauge[] => [w("claude-0", "5h", 88, at(3.72)), w("claude-1", "7d", 31, at(48)), w("claude-2", "Fable 7d", 79, at(48))];
const ringIds = (rows: { draw: QuotaGauge; balance: boolean }[]) => rows.map((r) => r.balance ? `bal:${r.draw.id}` : r.draw.id);

const { composerGauges, gaugeChoiceName, migrateGaugeChoices, MERGE_RESET_TOLERANCE_MS } = await import("../src/renderer/src/lib/quota");

describe("composerGauges", () => {
  it("merges windows that reset together into one ring drawing the one closest to running out; balances stay text", () => {
    const rows = composerGauges([...claude(), bal("credits", "62.4")], {}, true, true);
    expect(ringIds(rows)).toEqual(["claude-0", "claude-1", "bal:credits"]);
    const merged = rows[1]!;
    expect(merged.members.map((m) => m.id)).toEqual(["claude-1", "claude-2"]);
    expect(merged.draw.id).toBe("claude-1"); // 31 % left < 79 %
    expect(merged.showReset).toBe(true);
  });

  it("resets more than 10 minutes apart stay separate rings", () => {
    const rows = composerGauges([w("a", "7d", 31, at(48)), w("b", "Fable 7d", 79, at(48) + MERGE_RESET_TOLERANCE_MS / 1000 + 60)], {}, true, true);
    expect(rows).toHaveLength(2);
  });

  it("clusters transitively: A~B and B~C merge all three", () => {
    const near = MERGE_RESET_TOLERANCE_MS / 1000 / 2;
    const rows = composerGauges([w("a", "5h", 50, at(1)), w("b", "7d", 20, at(1) + near), w("c", "Fable 7d", 80, at(1) + 2 * near)], {}, true, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.members).toHaveLength(3);
    expect(rows[0]!.draw.id).toBe("b");
  });

  it("the popover's merge switch off keeps every window its own ring", () => {
    const rows = composerGauges(claude(), {}, true, false);
    expect(ringIds(rows)).toEqual(["claude-0", "claude-1", "claude-2"]);
  });

  it("a gauge whose ring is switched off (by name) disappears from the row", () => {
    const rows = composerGauges(claude(), { "Claude 5h": { ring: false } }, true, true);
    expect(ringIds(rows)).toEqual(["claude-1"]);
  });

  it("a hidden window under 15 % left comes back temporarily (red), and hides again at 15 %", () => {
    const low = [w("claude-0", "5h", 9, at(3.72)), ...claude().slice(1)];
    expect(composerGauges(low, { "Claude 5h": { ring: false } }, true, true)[0]).toMatchObject({ draw: { id: "claude-0" }, emergency: true });
    const edge = [w("claude-0", "5h", 15, at(3.72)), ...claude().slice(1)];
    expect(composerGauges(edge, { "Claude 5h": { ring: false } }, true, true).map((r) => r.draw.id)).not.toContain("claude-0");
  });

  it("the countdown follows each gauge's choice; a merged ring shows it when any member says yes", () => {
    expect(composerGauges(claude(), { "Claude 7d": { reset: false } }, true, true)[1]!.showReset).toBe(true); // 7d off, Fable 7d still on
    expect(composerGauges(claude(), { "Claude 7d": { reset: false }, "Claude Fable 7d": { reset: false } }, true, true)[1]!.showReset).toBe(false); // every member off
    expect(composerGauges(claude(), {}, false, true).every((r) => r.showReset === false)).toBe(true); // the old global switch seeded off
    expect(composerGauges(claude(), { "Claude Fable 7d": { reset: true } }, false, true)[1]!.showReset).toBe(true); // one member turns it on
  });

  it("gauges without a reset time never merge", () => {
    const rows = composerGauges([w("a", "5h", 40, null), w("b", "7d", 60, null)], {}, true, true);
    expect(rows).toHaveLength(2);
  });

  it("remembers choices by the gauge's display name, shared across Profiles", () => {
    expect(gaugeChoiceName(w("claude-1", "7d", 31, at(48)))).toBe("Claude 7d");
  });
});

describe("migrateGaugeChoices", () => {
  it("keeps sane partial choices and drops the rest", () => {
    expect(migrateGaugeChoices(null)).toEqual({});
    expect(migrateGaugeChoices("x")).toEqual({});
    expect(migrateGaugeChoices({ bad: "nope", "Claude 5h": { ring: false }, "Claude 7d": { reset: true }, empty: {} })).toEqual({ "Claude 5h": { ring: false }, "Claude 7d": { reset: true } });
  });
});

describe("quota prefs migration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function prefs() {
    return (await import("../src/renderer/src/lib/prefs")).getUiPrefs();
  }

  it("the removed global switch seeds the countdown default; off stays off", async () => {
    localStorage.setItem("cutex-desktop.ui", JSON.stringify({ quotaShowReset: false }));
    const p = await prefs();
    expect(p.quotaResetDefault).toBe(false);
    expect(p.quotaGauges).toEqual({});
    expect(p.quotaMerge).toBe(true);
    expect("quotaShowReset" in p).toBe(false);
  });

  it("stored choices and the merge switch survive a reload", async () => {
    localStorage.setItem("cutex-desktop.ui", JSON.stringify({ quotaGauges: { "Claude 5h": { ring: false } }, quotaResetDefault: false, quotaMerge: false }));
    const p = await prefs();
    expect(p.quotaGauges).toEqual({ "Claude 5h": { ring: false } });
    expect(p.quotaResetDefault).toBe(false);
    expect(p.quotaMerge).toBe(false);
  });
});

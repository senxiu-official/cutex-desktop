// Profile → 模型与上下文 (owner 2026-11-18): one 上下文窗口 / 自动压缩 pair mapped onto each backend.
// The invariant that matters most: a value read from a host and not touched maps back to exactly itself.
import { describe, expect, it } from "vitest";
import {
  claudeCompactsAt, claudeWindowLocked, codexEffective, codexPercentBlock, compactChoice, contextReasonMessage, customCompactText, formatTokens,
  fromClaude, fromCodex, fromCodexRow, parseCustomCompact, toClaude, toCodex, toCodexRow,
} from "../src/renderer/src/lib/contextCompaction";
import { WINDOW_PRESETS } from "../src/renderer/src/lib/contextPresets";
import { compactAt, WINDOW_MAX, WINDOW_MIN } from "../src/shared/claudeCompaction";

const COMPACT_AT_PRESETS = [300_000, 500_000, 700_000];

describe("Claude", () => {
  it("maps every valid stored value back to itself", () => {
    const windows = new Set<number>([WINDOW_MIN, WINDOW_MAX, ...WINDOW_PRESETS.filter((w) => w >= WINDOW_MIN), 133_000, 333_000, 533_000, 733_000, 450_000, 123_456, 999_999]);
    for (let w = WINDOW_MIN; w <= WINDOW_MAX; w += 7_000) windows.add(w);
    for (const window of windows) for (const percent of [1, 50, 75, 80, 85, 90, 99, 100]) {
      const stored = { window, percent };
      expect(toClaude(fromClaude(stored))).toEqual(stored);
    }
    expect(toClaude(fromClaude(null))).toBeNull();
  });

  it("shows the earlier 约 30/50/70 万 token values as 自定义 tokens and keeps them on save", () => {
    for (const at of COMPACT_AT_PRESETS) {
      const stored = { window: at + 33_000, percent: 100 };
      const v = fromClaude(stored);
      expect(v).toEqual({ window: null, compact: { tokens: at } });
      expect(compactChoice(v.compact)).toBe("custom");
      expect(customCompactText(v.compact)).toBe(`${at / 1000}k`);
      expect(claudeWindowLocked(v)).toBe(true);
      expect(toClaude(v)).toEqual(stored);
      // Where it compacts is unchanged by the new presentation.
      expect(claudeCompactsAt(stored, 1_000_000)).toBe(compactAt(stored, 1_000_000));
    }
  });

  it("reads a preset window at 100 % as that window with the default compaction", () => {
    expect(fromClaude({ window: 200_000, percent: 100 })).toEqual({ window: 200_000, compact: null });
    expect(fromClaude({ window: 400_000, percent: 80 })).toEqual({ window: 400_000, compact: { percent: 80 } });
    expect(compactChoice({ percent: 80 })).toBe("p80");
    expect(compactChoice({ percent: 85 })).toBe("custom");
  });

  it("needs a fixed window for a percentage until the host supports one without (B1)", () => {
    expect(toClaude({ window: null, compact: { percent: 80 } })).toEqual({ unsupported: "percentNeedsWindow" });
    expect(toClaude({ window: 400_000, compact: { percent: 80 } })).toEqual({ window: 400_000, percent: 80 });
    expect(toClaude({ window: null, compact: { tokens: 2_000_000 } })).toEqual({ unsupported: "outOfRange" });
    expect(toClaude({ window: null, compact: null })).toBeNull();
  });

  it("puts the default compaction at Claude Code's own point for the model", () => {
    expect(claudeCompactsAt(null, 200_000)).toBe(compactAt({ window: 200_000, percent: 100 }));
    expect(claudeCompactsAt(null, null)).toBeNull();
  });
});

describe("Codex", () => {
  it("maps every valid stored value back to itself", () => {
    for (const window of [null, 128_000, 200_000, 272_000, 400_000, 1_000_000]) {
      for (const limit of [null, 64_000, 96_000, 150_000, 160_000, 180_000, 204_000, 217_600, 244_800, 300_000, 360_000]) {
        if (window && limit && limit >= window) continue;
        expect(toCodex(fromCodex(window, limit))).toEqual({ modelContextWindow: window, modelAutoCompactTokenLimit: limit });
      }
    }
  });

  it("shows a percentage only when the limit is exactly that share of the window", () => {
    expect(fromCodex(400_000, 300_000)).toEqual({ window: 400_000, compact: { percent: 75 } });
    expect(fromCodex(400_000, 360_000)).toEqual({ window: 400_000, compact: { percent: 90 } });
    expect(fromCodex(400_000, 300_001)).toEqual({ window: 400_000, compact: { tokens: 300_001 } });
    expect(fromCodex(null, 300_000)).toEqual({ window: null, compact: { tokens: 300_000 } });
  });

  it("refuses a percentage without a window (B2) and a limit not below the window", () => {
    expect(toCodex({ window: null, compact: { percent: 80 } })).toEqual({ unsupported: "percentNeedsWindow" });
    expect(toCodex({ window: 200_000, compact: { tokens: 200_000 } })).toEqual({ unsupported: "limitNotBelowWindow" });
    expect(toCodex({ window: 200_000, compact: { percent: 80 } })).toEqual({ modelContextWindow: 200_000, modelAutoCompactTokenLimit: 160_000 });
  });

  it("previews the effective point with the 90 % cap and the model maximum", () => {
    const row = { contextWindow: 272_000, maxContextWindow: 400_000, autoCompactTokenLimit: null };
    expect(codexEffective(row, { window: null, compact: null })).toEqual({ window: 272_000, compactAt: 244_800, own: false });
    expect(codexEffective(row, { window: 1_000_000, compact: null })).toEqual({ window: 400_000, compactAt: 360_000, own: false });
    expect(codexEffective(row, { window: 400_000, compact: { tokens: 380_000 } }).compactAt).toBe(360_000);
    expect(codexEffective(row, { window: 400_000, compact: { percent: 75 } }).compactAt).toBe(300_000);
  });

  it("takes a catalog row's percentage of the model maximum when its window is unset", () => {
    expect(fromCodexRow(null, 400_000, 300_000)).toEqual({ window: null, compact: { percent: 75 } });
    expect(toCodexRow({ window: null, compact: { percent: 75 } }, 400_000)).toEqual({ contextWindow: null, autoCompactTokenLimit: 300_000 });
    expect(toCodexRow({ window: null, compact: { percent: 75 } }, null)).toEqual({ unsupported: "percentNeedsWindow" });
    for (const [w, max, limit] of [[null, 400_000, null], [200_000, 400_000, 150_000], [null, null, 123_000], [null, 400_000, 320_000]] as const) {
      expect(toCodexRow(fromCodexRow(w, max, limit), max)).toEqual({ contextWindow: w, autoCompactTokenLimit: limit });
    }
  });
});

describe("自定义 text", () => {
  it("accepts tokens or a percentage", () => {
    expect(parseCustomCompact("85%")).toEqual({ percent: 85 });
    expect(parseCustomCompact(" 450k ")).toEqual({ tokens: 450_000 });
    expect(parseCustomCompact("45万")).toEqual({ tokens: 450_000 });
    expect(parseCustomCompact("1.2m")).toEqual({ tokens: 1_200_000 });
    expect(parseCustomCompact("300000")).toEqual({ tokens: 300_000 });
    for (const bad of ["", "0%", "101%", "abc", "-5k", "0"]) expect(parseCustomCompact(bad)).toBeUndefined();
  });

  it("round-trips its own text", () => {
    for (const c of [{ percent: 85 }, { tokens: 450_000 }, { tokens: 123_456 }]) expect(parseCustomCompact(customCompactText(c))).toEqual(c);
    expect(customCompactText(null)).toBe("");
  });
});

describe("profile-model-context-v1", () => {
  it("stores a Codex percentage in its own field, without a window, and clears the other mode", () => {
    expect(toCodex({ window: null, compact: { percent: 75 } }, true)).toEqual({ modelContextWindow: null, modelAutoCompactTokenLimit: null, modelAutoCompactPercent: 75 });
    expect(toCodex({ window: null, compact: { tokens: 300_000 } }, true)).toEqual({ modelContextWindow: null, modelAutoCompactTokenLimit: 300_000, modelAutoCompactPercent: null });
    expect(toCodex({ window: null, compact: null }, true)).toEqual({ modelContextWindow: null, modelAutoCompactTokenLimit: null, modelAutoCompactPercent: null });
  });

  it("maps every stored v1 value back to itself and never makes a percentage of a custom token value", () => {
    for (const window of [null, 200_000, 400_000]) for (const [limit, percent] of [[null, null], [null, 75], [null, 50], [300_000, null], [150_000, null]] as const) {
      if (window && limit && limit >= window) continue;
      const v = fromCodex(window, limit, percent, false);
      expect(toCodex(v, true)).toEqual({ modelContextWindow: window, modelAutoCompactTokenLimit: limit, modelAutoCompactPercent: percent });
    }
    expect(fromCodex(400_000, 300_000, null, false).compact).toEqual({ tokens: 300_000 });
  });

  it("lets a migrated model's own values win over the Profile's (contract golden examples)", () => {
    const row = { contextWindow: 128_000, maxContextWindow: 256_000, autoCompactTokenLimit: null, autoCompactPercent: null };
    // Row window 128000 wins over Profile 200000; absent row compaction inherits the Profile's 75 % → 96000.
    expect(codexEffective(row, { window: 200_000, compact: { percent: 75 } }, true)).toEqual({ window: 128_000, compactAt: 96_000, own: false, ownWindow: true });
    // Row percent 50 → 64000 despite the Profile's 150000.
    expect(codexEffective({ ...row, autoCompactPercent: 50 }, { window: 200_000, compact: { tokens: 150_000 } }, true)).toEqual({ window: 128_000, compactAt: 64_000, own: true, ownWindow: true });
    // 100 % stays capped at 90 % (115200).
    expect(codexEffective({ ...row, autoCompactPercent: 100 }, { window: null, compact: null }, true).compactAt).toBe(115_200);
    // No row window: the Profile's, capped at the maximum.
    expect(codexEffective({ ...row, contextWindow: null }, { window: 500_000, compact: null }, true)).toEqual({ window: 256_000, compactAt: 230_400, own: false });
  });

  it("gives a migrated row its own percent and follows the Profile when unset", () => {
    expect(fromCodexRow(null, 400_000, null, 75, true)).toEqual({ window: null, compact: { percent: 75 } });
    expect(toCodexRow({ window: null, compact: { percent: 75 } }, null, true)).toEqual({ contextWindow: null, autoCompactTokenLimit: null, autoCompactPercent: 75 });
    expect(toCodexRow({ window: null, compact: null }, 400_000, true)).toEqual({ contextWindow: null, autoCompactTokenLimit: null, autoCompactPercent: null });
    expect(toCodexRow({ window: null, compact: { tokens: 400_000 } }, 400_000, true)).toEqual({ unsupported: "limitNotBelowWindow" });
  });

  it("stores a Claude percent alone and reads it back", () => {
    expect(toClaude({ window: null, compact: { percent: 80 } }, true)).toEqual({ window: null, percent: 80 });
    for (const stored of [{ window: null, percent: 80 }, { window: null, percent: 100 }, { window: 400_000, percent: 80 }, { window: 533_000, percent: 100 }]) {
      expect(toClaude(fromClaude(stored), true)).toEqual(stored);
    }
    expect(claudeCompactsAt({ window: null, percent: 80 }, 200_000)).toBe(compactAt({ window: 200_000, percent: 80 }));
    expect(claudeCompactsAt({ percent: 80 }, null)).toBeNull();
  });

  it("says why a percentage still needs a window", () => {
    expect(codexPercentBlock(false, {}, true)).toBe("hostV1");
    expect(codexPercentBlock(true, { modelContextSettingsSupport: { supported: false, reason: "nativeModelContextSettingsV1Required" } }, true)).toBe("nativeModelContextSettingsV1Required");
    expect(codexPercentBlock(true, { modelContextSettingsSupport: { supported: true, reason: null }, modelContextSettingsV1: false }, true)).toBe("notMigrated");
    expect(codexPercentBlock(true, { modelContextSettingsSupport: { supported: true, reason: null }, modelContextSettingsV1: true }, true)).toBeNull();
    expect(contextReasonMessage("dshContextSettingsUnsupported").key).toBe("settings.modelContext.unsupportedDsh");
    expect(contextReasonMessage("kimiContextSettingsUnsupported").key).toBe("settings.modelContext.unsupportedKimi");
    expect(contextReasonMessage("nativeModelContextSettingsV1Required").key).toBe("settings.modelContext.reason.nativeV1Required");
    expect(contextReasonMessage("somethingNew")).toEqual({ key: "settings.modelContext.reason.other", vars: { code: "somethingNew" } });
  });

  it("formats token amounts per locale", () => {
    expect(formatTokens(432_000, "zh-CN")).toBe("43.2 万");
    expect(formatTokens(432_000, "en")).toBe("432K");
  });
});

describe("cutex migration edge: a legacy limit at or above the window, kept raw", () => {
  it("shows it as custom tokens, previews the 90 % cap, and refuses to write it back unchanged", () => {
    for (const percentField of [false, true]) {
      const v = fromCodex(200_000, 500_000, null, !percentField);
      expect(v).toEqual({ window: 200_000, compact: { tokens: 500_000 } });
      expect(compactChoice(v.compact)).toBe("custom");
      expect(customCompactText(v.compact)).toBe("500k");
      // cutex refuses this pair on any ordinary write; the rows never send it (only a changed value is written).
      expect(toCodex(v, percentField)).toEqual({ unsupported: "limitNotBelowWindow" });
      // Raising the window or lowering the limit makes it writable again.
      expect(toCodex({ window: 1_000_000, compact: v.compact }, percentField)).toMatchObject({ modelContextWindow: 1_000_000, modelAutoCompactTokenLimit: 500_000 });
    }
    const row = { contextWindow: 272_000, maxContextWindow: 400_000, autoCompactTokenLimit: null };
    expect(codexEffective(row, { window: 200_000, compact: { tokens: 500_000 } })).toEqual({ window: 200_000, compactAt: 180_000, own: false });
    expect(codexEffective({ ...row, contextWindow: null }, { window: 200_000, compact: { tokens: 500_000 } }, true)).toEqual({ window: 200_000, compactAt: 180_000, own: false });
  });
});

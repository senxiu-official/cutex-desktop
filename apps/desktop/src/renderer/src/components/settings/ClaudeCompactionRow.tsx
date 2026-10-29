// Profile → 模型, Claude profiles (cutex `claude-compaction`, docs/design/036): 「自动压缩」 — default
// (Claude Code decides), "compact at about 30 / 50 / 70 万 tokens", or a custom window + percent. Part of
// the page draft (sticky save bar); cutex writes profiles/<id>/claude-runtime.json and Claude Code reads
// it at each agent's next runtime start (no restart from here: a model switch or a running turn keeps
// the old value until then).
import { useState } from "react";
import type { ProfileDetail } from "../../../../shared/ipc";
import { COMPACT_AT_PRESETS, CLAUDE_COMPACTION_FEATURE, compactAt, presetOf, validCompaction, WINDOW_PRESETS, windowPresetValue, compactionOfValue, type ClaudeCompaction } from "../../../../shared/claudeCompaction";
import { useI18n, type MessageKey } from "../../i18n";
import { parseWindow } from "../../lib/contextPresets";
import { fieldEditable } from "../../lib/profileKind";
import { useTargetFeatures } from "../../lib/targetHost";
import { SettingRow, Select, TextInput } from "./Form";

type Mode = "default" | "custom" | `${number}` | `w${number}x${number}`;

/** `draft`: undefined = unchanged, null = back to default. `change(undefined)` drops the draft. */
export function ClaudeCompactionRow({ detail, draft, change }: { detail: ProfileDetail; draft: ClaudeCompaction | null | undefined; change(v: ClaudeCompaction | null | undefined): void }) {
  const { t, locale } = useI18n();
  const features = useTargetFeatures();
  const value = draft !== undefined ? draft : (detail.claudeCompaction ?? null);
  const [custom, setCustom] = useState<{ window: string; percent: string } | null>(null);
  // Reverted or saved: a valid custom entry is no longer a draft, show the stored value.
  if (custom && draft === undefined && validCompaction({ window: parseWindow(custom.window) ?? NaN, percent: Number(custom.percent) })) setCustom(null);
  if (detail.cliKind !== "claude" || !features.has(CLAUDE_COMPACTION_FEATURE) || detail.claudeCompaction === undefined) return null;
  const preset = presetOf(value);
  const windowPreset = windowPresetValue(value);
  const mode: Mode = custom ? "custom" : value === null ? "default" : preset ? `${preset}` : windowPreset ? (windowPreset as Mode) : "custom";
  const zh = locale.startsWith("zh");
  const amount = (n: number) => (zh ? `${+(n / 10_000).toFixed(1)} 万` : `${Math.round(n / 1000)}K`);
  const fields = custom ?? (value ? { window: String(value.window), percent: String(value.percent) } : { window: "", percent: "100" });
  const typed = { window: parseWindow(fields.window) ?? NaN, percent: Number(fields.percent) };
  const invalid = mode === "custom" && !validCompaction(typed);
  const type = (next: { window: string; percent: string }) => {
    setCustom(next);
    const parsed = { window: parseWindow(next.window) ?? NaN, percent: Number(next.percent) };
    change(validCompaction(parsed) ? parsed : undefined);
  };
  const error = detail.detail?.claudeCompactionError;
  const shown = invalid ? null : mode === "custom" ? typed : value;
  return (
    <SettingRow source="host"
      agents="next"
      label={t("settings.profileIa.defaultCompaction" as MessageKey)}
      hint={
        <>
          <span className="block">{t("settings.profileIa.defaultCompactionHint" as MessageKey)}</span>
          <span className="block">{t("settings.profileTiming.compaction" as MessageKey)}</span>
          {shown ? t("agent-config.profile.claudeCompaction.hint", { at: amount(compactAt(shown)) }) : t("agent-config.profile.claudeCompaction.hintDefault")}
          {error && draft === undefined && <span className="block text-danger">{t("agent-config.profile.claudeCompaction.error", { error })}</span>}
          {/* The custom entry sits under the hint (full row width), not beside the select: three more controls in the right column squeezed the hint and overlapped it. */}
          {mode === "custom" && (
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <TextInput width="w-24" label={t("agent-config.profile.claudeCompaction.window")} placeholder="533k" value={fields.window} onChange={(w) => type({ ...fields, window: w })} />
              <TextInput width="w-14" label={t("agent-config.profile.claudeCompaction.percent")} value={fields.percent} onChange={(p) => type({ ...fields, percent: p })} />
              <span className="text-xs text-subtle">%</span>
              {invalid && <span className="text-xs text-danger">{t("agent-config.profile.claudeCompaction.invalid")}</span>}
            </span>
          )}
        </>
      }
    >
      <Select<Mode>
        value={mode}
        disabled={!fieldEditable(detail, "claudeCompaction")}
        options={[
          { value: "default", label: t("agent-config.profile.claudeCompaction.default") },
          ...COMPACT_AT_PRESETS.map((n) => ({ value: `${n}` as Mode, label: t("agent-config.profile.claudeCompaction.preset", { n: n / 10_000, k: n / 1000 }) })),
          ...WINDOW_PRESETS.map((c) => ({ value: windowPresetValue(c) as Mode, label: t("agent-config.profile.claudeCompaction.windowPreset", { w: c.window / 1000, p: c.percent, at: Math.round(compactAt(c) / 1000) }), group: t("agent-config.profile.claudeCompaction.windowGroup", { w: c.window / 1000 }) })),
          { value: "custom", label: t("agent-config.profile.custom") },
        ]}
        onChange={(v) => {
          if (v === "custom") return type(fields);
          setCustom(null);
          change(v === "default" ? null : compactionOfValue(v));
        }}
      />
    </SettingRow>
  );
}

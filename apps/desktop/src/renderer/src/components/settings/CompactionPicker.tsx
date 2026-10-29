// A compaction point picker (docs/design/036 / 037): unset, "compact at about 30 / 50 / 70 万 tokens", or a
// custom window + percent. Used per model in Profile → 模型 (ProfileModels); `value` null = unset, and
// `onChange(undefined)` is a custom entry that is not valid yet (the caller keeps its last valid value).
import { useState } from "react";
import { COMPACT_AT_PRESETS, presetOf, validCompaction, WINDOW_PRESETS, windowPresetValue, compactAt, compactionOfValue, type ClaudeCompaction } from "../../../../shared/claudeCompaction";
import { useI18n } from "../../i18n";
import { parseWindow } from "../../lib/contextPresets";
import { Select, TextInput } from "./Form";

type Mode = "unset" | "custom" | `${number}` | `w${number}x${number}`;

export function CompactionPicker({ value, unsetLabel, disabled, onChange }: { value: ClaudeCompaction | null; unsetLabel: string; disabled?: boolean; onChange(v: ClaudeCompaction | null | undefined): void }) {
  const { t } = useI18n();
  const [custom, setCustom] = useState<{ window: string; percent: string } | null>(null);
  const preset = presetOf(value);
  const windowPreset = windowPresetValue(value);
  const mode: Mode = custom ? "custom" : value === null ? "unset" : preset ? `${preset}` : windowPreset ? (windowPreset as Mode) : "custom";
  const fields = custom ?? (value ? { window: String(value.window), percent: String(value.percent) } : { window: "", percent: "100" });
  const parse = (f: { window: string; percent: string }) => ({ window: parseWindow(f.window) ?? NaN, percent: Number(f.percent) });
  const invalid = mode === "custom" && !validCompaction(parse(fields));
  const type = (next: { window: string; percent: string }) => {
    setCustom(next);
    const parsed = parse(next);
    onChange(validCompaction(parsed) ? parsed : undefined);
  };
  return (
    <>
      <Select<Mode>
        value={mode}
        disabled={disabled}
        label={t("agent-config.profile.claudeCompaction")}
        options={[
          { value: "unset", label: unsetLabel },
          ...COMPACT_AT_PRESETS.map((n) => ({ value: `${n}` as Mode, label: t("agent-config.profile.claudeCompaction.preset", { n: n / 10_000, k: n / 1000 }) })),
          ...WINDOW_PRESETS.map((c) => ({ value: windowPresetValue(c) as Mode, label: t("agent-config.profile.claudeCompaction.windowPreset", { w: c.window / 1000, p: c.percent, at: Math.round(compactAt(c) / 1000) }), group: t("agent-config.profile.claudeCompaction.windowGroup", { w: c.window / 1000 }) })),
          { value: "custom", label: t("agent-config.profile.custom") },
        ]}
        onChange={(v) => {
          if (v === "custom") return type(fields);
          setCustom(null);
          onChange(v === "unset" ? null : compactionOfValue(v));
        }}
      />
      {mode === "custom" && (
        <>
          <TextInput width="w-24" label={t("agent-config.profile.claudeCompaction.window")} placeholder="533k" disabled={disabled} value={fields.window} onChange={(w) => type({ ...fields, window: w })} />
          <TextInput width="w-14" label={t("agent-config.profile.claudeCompaction.percent")} disabled={disabled} value={fields.percent} onChange={(p) => type({ ...fields, percent: p })} />
          <span className="text-xs text-subtle">%</span>
          {invalid && <span className="text-xs text-danger">{t("agent-config.profile.claudeCompaction.invalid")}</span>}
        </>
      )}
    </>
  );
}

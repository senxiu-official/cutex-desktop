import { useI18n } from "../../i18n";
import { formatWindow, WINDOW_PRESETS } from "../../lib/contextPresets";
import { useTokenInput } from "../../lib/useTokenInput";
import { Select, TextInput } from "./Form";

/** Window picker: presets + custom text ("256k"), plus "inherit" (null). */
export function WindowInput({ value, onChange, allowInherit, inheritLabel, width, onValidityChange }: { value: number | null; onChange(v: number | null): void; allowInherit?: boolean; inheritLabel?: string; width?: string; onValidityChange?(valid: boolean): void }) {
  const { t } = useI18n();
  const input = useTokenInput(value, onChange, onValidityChange);
  const preset = input.custom ? "custom" : value !== null && (WINDOW_PRESETS as readonly number[]).includes(value) ? String(value) : value === null ? "inherit" : "custom";
  const options = [
    ...(allowInherit ? [{ value: "inherit", label: inheritLabel ?? t("agent-config.profile.inherit") }] : []),
    ...WINDOW_PRESETS.map((w) => ({ value: String(w), label: formatWindow(w) })),
    { value: "custom", label: t("agent-config.profile.custom") },
  ];
  return (
    <>
      <Select
        width={width}
        value={preset}
        options={options}
        onChange={(v) => {
          if (v === "custom") input.begin();
          else input.choose(v === "inherit" ? null : Number(v));
        }}
      />
      {preset === "custom" && (
        <TextInput
          width="w-28"
          value={input.text}
          placeholder="300k"
          onChange={input.type}
        />
      )}
      {input.invalid && <span className="text-xs text-danger">{t("agent-config.profile.invalidTokens")}</span>}
    </>
  );
}

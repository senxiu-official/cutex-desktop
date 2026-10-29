// Profile → 模型与上下文 → 输入图片, Codex profiles (cutex `profile-image-history-trim`, docs/design/027 option C):
// 「只给模型发最新的几张图」 — off (default), or on with "over N images, keep the newest M". Part of the page
// draft (sticky save bar). An invalid entry shows an inline error and is not sent (the draft drops it).
import { useState } from "react";
import type { ProfileDetail } from "../../../../shared/ipc";
import { DEFAULT_IMAGE_HISTORY_TRIM, parseImageHistoryTrim, type ImageHistoryTrim } from "../../../../shared/imageHistoryTrim";
import { useI18n } from "../../i18n";
import { fieldEditable } from "../../lib/profileKind";
import { SettingRow, TextInput, Toggle } from "./Form";

type Fields = { maxInline: string; keep: string };
const fieldsOf = (v: ImageHistoryTrim): Fields => ({ maxInline: String(v.maxInline), keep: String(v.keep) });

/** `draft`: undefined = unchanged, null = off. `change(undefined)` drops the draft (back to the stored value). */
export function ImageHistoryTrimRow({ detail, draft, change }: { detail: ProfileDetail; draft: ImageHistoryTrim | null | undefined; change(v: ImageHistoryTrim | null | undefined): void }) {
  const { t } = useI18n();
  const stored = detail.imageHistoryTrim ?? null;
  const value = draft !== undefined ? draft : stored;
  // What is being typed while it is not (yet) valid; a valid entry lives in the draft.
  const [typing, setTyping] = useState<Fields | null>(null);
  // Reverted or saved: a valid typed entry is no longer a draft, show the stored value.
  if (typing && draft === undefined && parseImageHistoryTrim(typing)) setTyping(null);
  const on = typing !== null || value !== null;
  const fields = typing ?? fieldsOf(value ?? DEFAULT_IMAGE_HISTORY_TRIM);
  const parsed = parseImageHistoryTrim(fields);
  const invalid = on && !parsed;
  const shown = parsed ?? value ?? DEFAULT_IMAGE_HISTORY_TRIM;
  const editable = fieldEditable(detail, "imageHistoryTrim");
  const type = (next: Fields) => {
    setTyping(next);
    change(parseImageHistoryTrim(next) ?? undefined);
  };
  return (
    <SettingRow agents="next" source="host"
      label={t("agent-config.profile.imageHistoryTrim")}
      hint={
        <>
          {t("agent-config.profile.imageHistoryTrimHint", { max: shown.maxInline, keep: shown.keep })}
          {invalid && <span className="block text-danger">{t("agent-config.profile.imageHistoryTrimInvalid")}</span>}
        </>
      }
    >
      {on && (
        <>
          <span className="text-xs text-subtle">{t("agent-config.profile.imageHistoryTrimMaxInline")}</span>
          <TextInput width="w-14" label={t("agent-config.profile.imageHistoryTrimMaxInline")} disabled={!editable} value={fields.maxInline} onChange={(v) => type({ ...fields, maxInline: v })} />
          <span className="text-xs text-subtle">{t("agent-config.profile.imageHistoryTrimKeep")}</span>
          <TextInput width="w-14" label={t("agent-config.profile.imageHistoryTrimKeep")} disabled={!editable} value={fields.keep} onChange={(v) => type({ ...fields, keep: v })} />
        </>
      )}
      <Toggle
        checked={on}
        disabled={!editable}
        onChange={(v) => {
          setTyping(null);
          change(v ? (stored ?? DEFAULT_IMAGE_HISTORY_TRIM) : null);
        }}
      />
    </SettingRow>
  );
}

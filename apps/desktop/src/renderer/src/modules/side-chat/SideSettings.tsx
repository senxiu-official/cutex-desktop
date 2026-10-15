import { useEffect, useState } from "react";
import { Button, ResetButton, Section, Select, SettingRow, TextArea, TextField } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useModulePref } from "../react";
import { SUMMARY_PROMPT } from "./model";

export function SideSettings() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useModulePref<string>("side-chat", "summaryPrompt", SUMMARY_PROMPT);
  const [draft, setDraft] = useState(String(prompt));
  const [anchor, setAnchor] = useModulePref<string>("side-chat", "summaryAnchor", "start");
  const [scope, setScope] = useModulePref<string>("side-chat", "forkScope", "all");
  const [model, setModel] = useModulePref<string>("side-chat", "model", "");
  useEffect(() => setDraft(String(prompt)), [prompt]);
  return <Section title={t("side-chat.title")} source="local">
    <SettingRow label={t("side-chat.summaryPrompt")} hint={t("side-chat.summaryHint")} reset={<ResetButton title={t("side-chat.resetPrompt")} disabled={prompt === SUMMARY_PROMPT} onClick={() => setPrompt(SUMMARY_PROMPT)} />}>
      <div className="flex max-w-full flex-col items-end gap-2"><TextArea value={draft} onChange={setDraft} rows={5} /><Button disabled={!draft.trim() || draft === prompt || new TextEncoder().encode(draft).length > 65_536} onClick={() => setPrompt(draft)}>{t("side-chat.savePrompt")}</Button></div>
    </SettingRow>
    <SettingRow label={t("side-chat.anchorSetting")}><Select value={String(anchor)} onChange={setAnchor} options={[{ value: "start", label: t("side-chat.anchorStart") }, { value: "latest", label: t("side-chat.anchorLatest") }]} /></SettingRow>
    <SettingRow label={t("side-chat.scopeSetting")}><Select value={String(scope)} onChange={setScope} options={[{ value: "all", label: t("side-chat.scopeAll") }, { value: "through", label: t("side-chat.scopeThrough") }]} /></SettingRow>
    <SettingRow label={t("side-chat.modelSetting")} hint={t("side-chat.modelHint")} reset={<ResetButton disabled={!model} onClick={() => setModel("")} />}>
      <TextField value={String(model)} placeholder={t("side-chat.modelSame")} maxLength={200} onCommit={value => { if (new TextEncoder().encode(value).length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)) setModel(value.trim()); }} />
    </SettingRow>
  </Section>;
}

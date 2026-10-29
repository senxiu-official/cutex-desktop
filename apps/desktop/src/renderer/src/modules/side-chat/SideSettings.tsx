// Settings → 对话: two cards (owner 2026-10-19) — 侧边对话 (what the side chat sees of the main thread)
// and 记为批注 (where the note goes, its prompt). The side-chat model pref is not offered for now.
// Timing: the fork scope shapes the forked model context when a new side chat starts (next); a note is
// owner-private metadata (none), but its prompt goes to the side-chat model at the next note request (now).
import { useState } from "react";
import { Button, ResetButton, Section, Segmented, SettingRow, SettingsGroup, TextArea } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useModulePref } from "../react";
import { SUMMARY_PROMPT } from "./model";

export function SideChatSettings() {
  const { t } = useI18n();
  const [scope, setScope] = useModulePref<string>("side-chat", "forkScope", "all");
  return <Section title={t("side-chat.title")} hint={t("side-chat.settingsHint")}>
    <SettingRow agents="next" source="local" label={t("side-chat.scopeSetting")} info={t("side-chat.scopeHint")}>
      <Segmented value={scope === "through" ? "through" : "all"} onChange={setScope} options={[{ value: "all", label: t("side-chat.scopeAll") }, { value: "through", label: t("side-chat.scopeThrough") }]} />
    </SettingRow>
  </Section>;
}

export function SideSummarySettings() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useModulePref<string>("side-chat", "summaryPrompt", SUMMARY_PROMPT);
  const [anchor, setAnchor] = useModulePref<string>("side-chat", "summaryAnchor", "start");
  // The prompt editor is folded away by default (local state only).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(prompt));
  const toggle = () => { setDraft(String(prompt)); setEditing(!editing); };
  const save = () => { setPrompt(draft); setEditing(false); };
  return <Section title={t("side-chat.summary")} hint={t("side-chat.summarySettingsHint")}>
    <SettingRow agents="none" source="local" label={t("side-chat.anchorSetting")}>
      <Segmented value={anchor === "latest" ? "latest" : "start"} onChange={setAnchor} options={[{ value: "start", label: t("side-chat.anchorStart") }, { value: "latest", label: t("side-chat.anchorLatest") }]} />
    </SettingRow>
    <SettingRow label={t("side-chat.summaryPrompt")} agents="now" source="local" reset={<ResetButton title={t("side-chat.resetPrompt")} disabled={prompt === SUMMARY_PROMPT} onClick={() => { setPrompt(SUMMARY_PROMPT); setDraft(SUMMARY_PROMPT); }} />}>
      <Button onClick={toggle}>{editing ? t("side-chat.collapsePrompt") : t("side-chat.editPrompt")}</Button>
    </SettingRow>
    {/* The prompt editor of the row above (same setting). */}
    {editing && (
      <SettingsGroup agents="now" source="local">
        <div className="flex flex-col items-end gap-2 border-t border-border/60 py-3">
          <TextArea value={draft} onChange={setDraft} rows={6} width="w-full" label={t("side-chat.summaryPrompt")} />
          <Button primary disabled={!draft.trim() || draft === prompt || new TextEncoder().encode(draft).length > 65_536} onClick={save}>{t("side-chat.savePrompt")}</Button>
        </div>
      </SettingsGroup>
    )}
  </Section>;
}

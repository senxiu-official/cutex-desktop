// Settings → 键盘快捷键 → 快捷键方案 (owner 2026-11-26, like JetBrains keymaps / VS Code keybinding profiles): pick the
// active scheme; 新建 / 复制 / 重命名 / 删除 (in-place second click) / 导出 (JSON to the clipboard) / 导入 (pasted JSON);
// per scheme 「同步到我的其他设备」 and the 已同步 marker (when the 同步 category is on). The built-in 默认 is read-only.
import { useState } from "react";
import { useI18n } from "../../i18n";
import { useKeybindingsVersion } from "../../lib/useKeybindings";
import { BUILTIN_SCHEME_ID, MAX_SCHEMES, SCHEME_NAME_MAX, exportScheme, overriddenCount, type KeyScheme } from "../../lib/keybindingSchemes";
import { createScheme, deleteScheme, importScheme, keybindingSyncOn, renameScheme, schemeLibrary, setSchemeSync, switchScheme } from "../../lib/keybindingSchemeStore";
import { ArmedRemove, Button, Section, Select, SettingRow, SettingsGroup, TextArea, TextInput, Toggle } from "./Form";
import { settingsAnchorId } from "../../lib/settingsNav";
import { schemeLabels } from "./keySchemeLabels";

type Editing = { kind: "new" | "copy" | "rename"; name: string } | { kind: "import"; text: string; bad: boolean } | null;

export function KeySchemesSection() {
  const { t } = useI18n();
  useKeybindingsVersion();
  const lib = schemeLibrary();
  const syncOn = keybindingSyncOn();
  const labels = schemeLabels(lib.schemes, t("keySchemes.mine"));
  const active = lib.schemes.find((s) => s.id === lib.active) ?? null;
  const [editing, setEditing] = useState<Editing>(null);
  const full = lib.schemes.length >= MAX_SCHEMES;
  const source = syncOn ? "person" : "local";
  const nameOf = (s: KeyScheme | null) => (s ? labels.get(s.id)! : t("keySchemes.builtin"));

  const options = [
    { value: BUILTIN_SCHEME_ID, label: t("keySchemes.builtin") },
    ...lib.schemes.map((s) => ({ value: s.id, label: `${labels.get(s.id)} · ${t(syncOn && s.sync ? "keySchemes.synced" : "keySchemes.localOnly")}` })),
  ];

  const commitName = () => {
    if (!editing || editing.kind === "import") return;
    const name = editing.name.trim();
    if (!name) return;
    if (editing.kind === "rename" && active) renameScheme(active.id, name);
    else createScheme(name, editing.kind === "copy" ? lib.active : BUILTIN_SCHEME_ID);
    setEditing(null);
  };

  const doImport = () => {
    if (editing?.kind !== "import") return;
    if (importScheme(editing.text, t("keySchemes.newName"))) setEditing(null);
    else setEditing({ ...editing, bad: true });
  };

  const exportActive = () => {
    if (!active) return;
    void navigator.clipboard.writeText(exportScheme(active, nameOf(active))).catch(() => undefined);
  };

  return (
    <Section id={settingsAnchorId("shortcuts-schemes")} title={t("keySchemes.title")} hint={t("keySchemes.hint")}>
      <div data-key-schemes="">
        <SettingRow agents="none" source={source}
          label={
            <span className="inline-flex items-center gap-2">
              {t("keySchemes.active")}
              {active && syncOn && active.sync && (
                <span data-key-scheme-synced="" className="rounded bg-accent/15 px-1.5 py-px text-caption font-medium text-accent">{t("keySchemes.synced")}</span>
              )}
            </span>
          }
          hint={active ? t(overriddenCount(active) ? "keySchemes.changed" : "keySchemes.unchanged", { n: overriddenCount(active) }) : t("keySchemes.readOnly")}
        >
          <Select value={lib.active} options={options} onChange={(v) => (setEditing(null), switchScheme(v))} label={t("keySchemes.active")} />
        </SettingRow>
        <SettingsGroup agents="none" source={source}>
          <div className="flex flex-wrap items-center justify-end gap-2 pb-2" data-key-scheme-actions="">
            <Button disabled={full} title={full ? t("keySchemes.full", { n: MAX_SCHEMES }) : undefined} onClick={() => setEditing({ kind: "new", name: t("keySchemes.newName") })}>{t("keySchemes.new")}</Button>
            <Button disabled={full} title={full ? t("keySchemes.full", { n: MAX_SCHEMES }) : undefined} onClick={() => setEditing({ kind: "copy", name: t("keySchemes.copyName", { name: nameOf(active) }) })}>{t("keySchemes.copy")}</Button>
            <Button disabled={!active} onClick={() => active && setEditing({ kind: "rename", name: nameOf(active) })}>{t("keySchemes.rename")}</Button>
            <Button disabled={!active} title={t("keySchemes.exportTitle")} onClick={exportActive}>{t("keySchemes.export")}</Button>
            <Button disabled={full} onClick={() => setEditing({ kind: "import", text: "", bad: false })}>{t("keySchemes.import")}</Button>
            {active && <ArmedRemove title={t("keySchemes.deleteTitle")} label={t("keySchemes.delete")} armedLabel={t("keySchemes.deleteArmed")} onRemove={() => (setEditing(null), deleteScheme(active.id))} />}
          </div>
        </SettingsGroup>
        {editing && editing.kind !== "import" && (
          <div data-key-scheme-name={editing.kind} className="mb-2 flex flex-wrap items-center justify-end gap-2 rounded border border-border bg-surface-2 px-3 py-2">
            <span className="mr-auto text-xs text-muted">{t(`keySchemes.${editing.kind}Prompt`)}</span>
            <SettingsGroup agents="none" source={source}><TextInput autoFocus value={editing.name} maxLength={SCHEME_NAME_MAX} label={t("keySchemes.namePlaceholder")} placeholder={t("keySchemes.namePlaceholder")}
              onChange={(name) => setEditing({ ...editing, name })}
              onKeyDown={(e) => { if (e.key === "Enter") commitName(); else if (e.key === "Escape") setEditing(null); }} /></SettingsGroup>
            <Button primary disabled={!editing.name.trim()} onClick={commitName}>{t("keySchemes.save")}</Button>
            <Button onClick={() => setEditing(null)}>{t("keySchemes.cancel")}</Button>
          </div>
        )}
        {editing?.kind === "import" && (
          <div data-key-scheme-import="" className="mb-2 flex flex-col gap-2 rounded border border-border bg-surface-2 px-3 py-2">
            <span className="text-xs text-muted">{t("keySchemes.importHint")}</span>
            <SettingsGroup agents="none" source={source}><TextArea mono width="w-full" rows={5} value={editing.text} label={t("keySchemes.import")} onChange={(text) => setEditing({ kind: "import", text, bad: false })} /></SettingsGroup>
            {editing.bad && <span role="alert" className="text-xs text-danger">{t("keySchemes.importBad")}</span>}
            <span className="flex justify-end gap-2">
              <Button primary disabled={!editing.text.trim()} onClick={doImport}>{t("keySchemes.importDo")}</Button>
              <Button onClick={() => setEditing(null)}>{t("keySchemes.cancel")}</Button>
            </span>
          </div>
        )}
        {active && (
          <SettingRow agents="none" source={source} label={t("keySchemes.sync")} hint={t(syncOn ? "keySchemes.syncHint" : "keySchemes.syncOff")}>
            <Toggle checked={active.sync} onChange={(v) => setSchemeSync(active.id, v)} label={t("keySchemes.sync")} />
          </SettingRow>
        )}
      </div>
    </Section>
  );
}

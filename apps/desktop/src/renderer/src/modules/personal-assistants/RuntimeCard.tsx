// 运行方式 (owner 2026-11-27; cutex r299 `personal-assistants-agent-v1`): assistants are normal agents now — any runtime,
// each runtime's 自动 mode by default, 完全访问 optional — instead of the old assistant-tools-only kind. The create form
// offers the modes the host lists; 设置 changes the mode the agent starts in (`runtime` change at the shown revision;
// 完全访问 is confirmed in place). An old restricted assistant says so; a host without the feature shows nothing.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { ArmedButton } from "../../components/ArmedButton";
import { btnFace, btnShape } from "../../components/Button";
import { Button, RadioList, Section, SettingRow } from "../../components/settings/Form";
import type { PaPermissionMode, PaView } from "../../../../shared/personalAssistants";
import { paErrorCode, STALE_CODES } from "../../lib/personalAssistants";
import { refreshAssistant, updateAssistant } from "../../lib/personalAssistantStore";
import { paErrorText } from "./paHooks";

const MODES: readonly PaPermissionMode[] = ["auto", "fullAccess"];

export function PermissionModeChoice({ name, value, offered, disabled, onChange }: { name: string; value: PaPermissionMode; offered: readonly PaPermissionMode[]; disabled?: boolean; onChange(mode: PaPermissionMode): void }) {
  const { t } = useI18n();
  return (
    <div data-pa-permission-mode={value}>
      <RadioList
        name={name}
        value={value}
        label={t("personal-assistants.runtime.mode")}
        onChange={(v) => !disabled && onChange(v)}
        options={MODES.filter((m) => offered.includes(m)).map((m) => ({ value: m, label: t(m === "auto" ? "personal-assistants.runtime.auto" : "personal-assistants.runtime.fullAccess"), hint: t(m === "auto" ? "personal-assistants.runtime.autoHint" : "personal-assistants.runtime.fullAccessHint"), disabled }))}
      />
    </div>
  );
}

export function RuntimeCard({ hostId, view, readOnly }: { hostId: string; view: PaView; readOnly: boolean }) {
  const { t } = useI18n();
  const a = view.assistant;
  const runtime = view.runtime ?? null;
  const saved = runtime?.policy?.initialPermissionMode ?? "auto";
  const [mode, setMode] = useState<PaPermissionMode>(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  useEffect(() => setMode(saved), [saved, a.revision]);
  if (!runtime) return null;
  if (runtime.behavior !== "agent" || !runtime.policy) {
    return (
      <Section title={t("personal-assistants.runtime.title")}>
        <div className="py-1.5 text-ui/[inherit] text-muted" data-pa-runtime="legacy">{t("personal-assistants.runtime.legacy")}</div>
      </Section>
    );
  }
  const policy = runtime.policy;
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await updateAssistant(hostId, a, { kind: "runtime", policy: { ...policy, initialPermissionMode: mode } });
      setNote({ tone: "ok", text: t("personal-assistants.form.saved") });
    } catch (e) {
      if (STALE_CODES.has(paErrorCode(e) ?? "")) {
        await refreshAssistant(hostId, a.id).catch(() => {});
        setNote({ tone: "warn", text: t("personal-assistants.form.stale") });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const changed = mode !== saved;
  const action = mode === "fullAccess" && changed ? (
    <ArmedButton shape={btnShape()} idle={btnFace({ variant: "primary" })} hint={t("personal-assistants.runtime.fullAccessConfirm")} disabled={readOnly || busy} onConfirm={() => void save()} testId="pa-runtime-save">
      {t("personal-assistants.form.save")}
    </ArmedButton>
  ) : (
    <Button primary disabled={readOnly || busy || !changed} onClick={() => void save()}>{t("personal-assistants.form.save")}</Button>
  );
  return (
    <div data-pa-runtime="agent">
      <Section title={t("personal-assistants.runtime.title")} actions={action}>
        {note && <div className={`mb-2 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status">{note.text}</div>}
        <SettingRow agents="none" source="host" label={t("personal-assistants.runtime.mode")} hint={t("personal-assistants.runtime.modeHint")}>
          <PermissionModeChoice name={`pa-mode-${a.id}`} value={mode} offered={MODES} disabled={readOnly || busy} onChange={setMode} />
        </SettingRow>
        <div className="text-caption/[inherit] text-subtle" data-pa-runtime-now={runtime.permissionMode ?? "unknown"}>
          {runtime.permissionMode === "custom" ? t("personal-assistants.runtime.nowCustom")
            : runtime.permissionMode ? t("personal-assistants.runtime.now", { mode: t(runtime.permissionMode === "auto" ? "personal-assistants.runtime.auto" : "personal-assistants.runtime.fullAccess") })
            : t("personal-assistants.runtime.nowUnknown")}
          {runtime.workspace ? ` · ${t("personal-assistants.runtime.workspace", { path: runtime.workspace })}` : ""}
        </div>
      </Section>
    </div>
  );
}

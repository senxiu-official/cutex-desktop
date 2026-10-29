// Identity is always visible with its masked, revealable and copyable fingerprint.
// Only key material and cross-device import/export actions live in the collapsed disclosure.
// Main handles keys and clears copied secrets; the renderer only sees the fingerprint and results.
import { useEffect, useState } from "react";
import { groupFingerprint, type IdentityFileResult, type IdentityImportTexts } from "../../../../shared/personIdentity";
import { api } from "../../bridge";
import { useI18n } from "../../i18n";
import { usePersonIdentity } from "../../lib/personIdentity";
import { MaskedText } from "../MaskedText";
import { Button, ErrorNote, HintAction, SettingRow, SettingsGroup } from "./Form";
import { SettingsDisclosureRow } from "./SettingsDisclosureRow";
import { IdentityKeyDialog } from "./IdentityKeyDialog";

type Note = { text: string; tone: "info" | "warn" | "error"; until?: number };

export function PersonIdentityRows() {
  const { t } = useI18n();
  const identity = usePersonIdentity();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [pasting, setPasting] = useState(false);
  const [open, setOpen] = useState(false);
  // The copy notice goes when main clears the clipboard.
  useEffect(() => {
    if (!note?.until) return;
    const timer = setTimeout(() => setNote((n) => (n === note ? null : n)), Math.max(0, note.until - Date.now()));
    return () => clearTimeout(timer);
  }, [note]);
  if (!identity.loaded) return null;
  const importTexts = (title: string): IdentityImportTexts => ({ title, message: t("identity.person.importConfirm"), detail: t("identity.person.importDetail"), replace: t("identity.person.importReplace"), cancel: t("identity.person.importCancel") });
  const failed = (message: string) => setNote({ text: t("identity.person.failed", { message }), tone: "error" });
  const imported = (r: IdentityFileResult & { ok: true }) => setNote({ text: t(r.changed ? "identity.person.imported" : "identity.person.importSame"), tone: "info" });
  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (e) {
      failed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copyKey = () =>
    guard(async () => {
      const r = await api.copyIdentityKey();
      if (r.ok) setNote({ text: t("identity.person.keyCopied", { seconds: Math.round(r.clearAfterMs / 1000) }), tone: "warn", until: Date.now() + r.clearAfterMs });
      else failed(r.error ?? "");
    });
  const fileAction = (what: "export" | "import") =>
    guard(async () => {
      const r = what === "export" ? await api.exportIdentity(t("identity.person.export")) : await api.importIdentity(importTexts(t("identity.person.import")));
      if (r.ok) {
        if (what === "export") setNote({ text: t("identity.person.exported", { path: r.path ?? "" }), tone: "info" });
        else imported(r);
      } else if (!r.canceled) failed(r.error ?? "");
    });
  const hasKey = !!identity.fingerprint;
  // Open while a copy / paste / file note shows (it explains what just happened).
  const expanded = open || !!note || pasting;
  return (
    <div className="border-b border-border/60 last:border-b-0" data-testid="identity-key-row">
      <SettingRow agents="access" source="local" readOnly label={t("identity.person.title")} hint={t("identity.person.hint")}>
        {identity.fingerprint ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-subtle">
            {t("identity.person.fingerprint")}
            <MaskedText
              value={identity.fingerprint}
              shown={groupFingerprint(identity.fingerprint)}
              title={identity.publicKey ?? undefined}
              className="font-mono text-xs"
              copy
              copyLabel={t("identity.person.copy")}
              testId="identity-fingerprint"
            />
          </span>
        ) : (
          <span className="shrink-0 text-xs text-danger">{t("identity.person.unavailable", { message: identity.error ?? "" })}</span>
        )}
      </SettingRow>
      <SettingsGroup agents="access" source="local">{decoration => <SettingsDisclosureRow
        decoration={decoration}
        title={t("identity.person.useElsewhere")}
        open={expanded}
        onOpenChange={next => { setOpen(next); if (!next) setNote(null); }}
      >
        <div className="space-y-2 pb-3 pl-5">
          <p className="text-xs text-warn">{t("identity.person.keyHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button primary disabled={busy || !hasKey} onClick={() => void copyKey()}>{t("identity.person.copyKey")}</Button>
            <Button disabled={busy} onClick={() => (setNote(null), setPasting(true))}>{t("identity.person.pasteKey")}</Button>
          </div>
          <p className="text-xs text-subtle">
            {t("identity.person.legacyFile")}
            <HintAction disabled={busy} onClick={() => void fileAction("import")}>{t("identity.person.importLink")}</HintAction>
            <HintAction disabled={busy || !hasKey} onClick={() => void fileAction("export")}>{t("identity.person.exportLink")}</HintAction>
          </p>
          {note &&
            (note.tone === "error" ? (
              <ErrorNote>{note.text}</ErrorNote>
            ) : (
              <p role="status" className={`text-xs ${note.tone === "warn" ? "text-warn" : "text-subtle"}`}>
                {note.text}
              </p>
            ))}
        </div>
      </SettingsDisclosureRow>}</SettingsGroup>
      {pasting && <SettingsGroup agents="access" source="local">{decoration => (
        <IdentityKeyDialog decoration={decoration}
          texts={importTexts(t("identity.person.pasteTitle"))}
          onClose={() => setPasting(false)}
          onDone={(r) => {
            setPasting(false);
            imported(r);
          }}
        />
      )}</SettingsGroup>}
    </div>
  );
}

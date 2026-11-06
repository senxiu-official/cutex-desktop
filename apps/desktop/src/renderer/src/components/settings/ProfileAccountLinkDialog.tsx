import { useEffect, useRef, useState } from "react";
import type { ProfileItem } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { accountLinkHostReady, useProfileAccountLinks } from "../../lib/profileAccountLinks";
import { changeAccountLinks, newManualAccountLink, undoAccountLinks, type AccountLinkChange } from "../../lib/profileAccountLinkActions";
import { Button, Checkbox, FormFields, SettingsGroup } from "./Form";
import { isHTMLElement } from "../../lib/ownerWindow";
import { useOwnerDocument } from "../../lib/ownerContext";

export function ProfileAccountLinkDialog({ hostId, profile, unlink = false, onClose, onChanged }: { hostId: string; profile: ProfileItem; unlink?: boolean; onClose(): void; onChanged(): void }) {
  const doc = useOwnerDocument();
  const { t } = useI18n();
  const restoringAuto = unlink && profile.accountLinkState === "disabled";
  const manualUnlink = unlink && profile.link?.source === "manual";
  const { self, targets } = useProfileAccountLinks(hostId, profile);
  const [selected, setSelected] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<AccountLinkChange[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = doc.activeElement;
    panel.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => { if (isHTMLElement(before) && before.isConnected) before.focus(); };
  }, [doc]);
  const keyOf = (ref: typeof targets[number]) => `${ref.hostId}/${ref.profile.id}`;
  const picked = targets.filter((ref) => selected.includes(keyOf(ref)));
  const apply = async () => {
    if (!self || busy || (!unlink && !picked.length)) return;
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try {
      const result = await changeAccountLinks(unlink ? [self] : [self, ...picked], unlink ? (manualUnlink || restoringAuto ? null : "none") : newManualAccountLink());
      setChanges(result.changes);
      setMessage(result.failed.length ? t("settings.profile.link.partial", { hosts: result.failed.map((ref) => `${ref.hostName} · ${ref.profile.name}`).join(", ") }) : t(restoringAuto ? "settings.profile.link.autoRestored" : manualUnlink ? "settings.profile.link.manualCleared" : unlink ? "settings.profile.link.unlinked" : "settings.profile.link.linked"));
      setDone(true);
      onChanged();
    } catch { setMessage(t("settings.profile.link.failed")); }
    finally { setBusy(false); setArmed(false); }
  };
  const undo = async () => {
    setBusy(true);
    const result = await undoAccountLinks(changes);
    setChanges(changes.filter((change) => result.failed.some((ref) => keyOf(ref) === keyOf(change.ref))));
    setMessage(t(result.failed.length ? "settings.profile.link.undoFailed" : "settings.profile.link.undone"));
    setBusy(false);
    onChanged();
  };
  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && onClose()}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="profile-link-title" className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-e2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const buttons = [...(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id="profile-link-title" className="font-semibold">{t(restoringAuto ? "settings.profile.link.restoreAuto" : unlink ? "settings.profile.link.unlink" : "settings.profile.link.mark")}</h2>
      <p className="mt-2 text-xs text-muted">{t(restoringAuto ? "settings.profile.link.restoreAutoHint" : manualUnlink ? "settings.profile.link.manualUnlinkHint" : unlink ? "settings.profile.link.unlinkHint" : "settings.profile.link.hint", { name: profile.name })}</p>
      {!unlink && !done && <FormFields><SettingsGroup agents="none" source="host" allHosts><div className="my-4 max-h-64 space-y-2 overflow-auto">
        {targets.map((ref) => <div key={keyOf(ref)} className="flex items-center gap-2 text-sm"><Checkbox label={`${ref.hostName} · ${ref.profile.name}`} checked={selected.includes(keyOf(ref))} disabled={busy} onChange={(checked) => { setSelected((old) => checked ? [...old, keyOf(ref)] : old.filter((key) => key !== keyOf(ref))); setArmed(false); }} /><span>{ref.hostName} · {ref.profile.name}</span></div>)}
        {!targets.length && <p className="text-xs text-subtle">{t(accountLinkHostReady(hostId) ? "settings.profile.link.noTargets" : "settings.profile.link.notReady")}</p>}
      </div></SettingsGroup></FormFields>}
      {message && <p role="status" className="mt-3 text-xs text-muted">{message}</p>}
      {armed && <p className="mt-3 text-xs text-warn">{t("settings.profile.link.confirmHint")}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {changes.length > 0 && <Button disabled={busy} onClick={() => void undo()}>{t("settings.profile.link.undo")}</Button>}
        <Button disabled={busy} onClick={onClose}>{t(done ? "settings.profile.link.close" : "settings.profile.link.cancel")}</Button>
        {!done && <Button primary disabled={busy || !self?.connected || (!unlink && !picked.length)} onClick={() => void apply()}>{t(busy ? "settings.profile.link.saving" : armed ? "settings.profile.link.confirm" : restoringAuto ? "settings.profile.link.restoreAuto" : unlink ? "settings.profile.link.unlink" : "settings.profile.link.mark")}</Button>}
      </div>
    </section>
  </div>;
}

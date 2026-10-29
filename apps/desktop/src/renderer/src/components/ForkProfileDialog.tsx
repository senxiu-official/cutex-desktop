import { isImeComposing } from "../lib/ime";
import { loadProfileList } from "../lib/profileSnapshot";
import { useEffect, useRef, useState } from "react";
import type { SessionForkPreview } from "../../../shared/sessionFork";
import { FORK_PREVIEW_FEATURE } from "../../../shared/sessionFork";
import type { AutoPickPreview } from "../../../shared/profileAutoPick";
import { apiFor } from "../bridge";
import { useI18n } from "../i18n";
import { featuresOf, useApp } from "../store";
import { closeDialog } from "../lib/contextMenu";
import { captureHostAction, onHostReset } from "../lib/hostSwitch";
import { forkErrorKey, forkHistorySize, forkQuota, forkTargets } from "../lib/forkProfile";
import { Button } from "./Button";

/** One owner choice, then an inline second click for a different profile; never creates a preview fork. */
export function ForkProfileDialog({ sessionId, hostId, afterTurnId, resolve }: { sessionId: string; hostId: string; afterTurnId: string | null; resolve(value: null): void }) {
  const { t } = useI18n();
  const features = useApp((s) => featuresOf(s, hostId));
  const [profile, setProfile] = useState("");
  const [preview, setPreview] = useState<SessionForkPreview | null>(null);
  const [quota, setQuota] = useState<AutoPickPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const current = useRef(captureHostAction(hostId));
  const mounted = useRef(true);
  const quotaFamily = useRef<string | null>(null);
  const live = () => mounted.current && current.current();
  const done = () => { closeDialog(); resolve(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => onHostReset((host) => { if (host === hostId) done(); }), [hostId]);
  useEffect(() => {
    let active = true;
    if (!features.has(FORK_PREVIEW_FEATURE)) { setError(t("fork.error.unsupported")); return; }
    setLoading(true); setError(null); setDetail(null); setArmed(false);
    const api = apiFor(hostId);
    loadProfileList(hostId).then(() => { if (!active || !live()) return null; return api.forkPreview(sessionId, { afterTurnId, ...(profile ? { profile } : {}) }); }).then((value) => {
      if (!value || !active || !live()) return;
      if (value.cutexSessionId !== sessionId || value.afterTurnId !== afterTurnId || value.profile !== (profile || null)) throw new Error("fork preview response mismatch");
      setPreview(value);
      if (value.sourceProviderFamily && quotaFamily.current !== value.sourceProviderFamily && features.has("profile-auto-pick")) {
        const family = value.sourceProviderFamily;
        quotaFamily.current = family;
        setQuota(null);
        void api.profileAutoPick({ provider: family }).then((snapshot) => { if (live() && quotaFamily.current === family) setQuota(snapshot); }).catch(() => {});
      }
    }).catch((e: unknown) => { if (active && live()) { setPreview(null); setError(t(forkErrorKey(e) ?? "fork.error.unknown")); setDetail(e instanceof Error ? e.message : String(e)); } }).finally(() => { if (active && live()) setLoading(false); });
    return () => { active = false; };
  }, [sessionId, hostId, afterTurnId, profile, reload, features.has(FORK_PREVIEW_FEATURE)]);
  const choices = forkTargets(preview);
  const cross = !!profile;
  const matching = preview?.profile === (profile || null);
  const size = matching ? forkHistorySize(preview?.historyBytes) : null;
  const eligible = matching && !!preview?.eligible;
  const remaining = profile ? forkQuota(quota, profile) : null;
  const blocked = busy || (cross && (loading || !eligible));
  async function submit() {
    if (blocked || !live()) return;
    if (cross && !armed) { setArmed(true); return; }
    setBusy(true); setError(null); setDetail(null);
    try {
      await useApp.getState().forkSession(sessionId, afterTurnId, hostId, profile || undefined);
      if (live()) done();
    } catch (e) { if (live()) { setError(t(forkErrorKey(e) ?? "fork.error.unknown")); setDetail(e instanceof Error ? e.message : String(e)); setArmed(false); } }
    finally { if (live()) setBusy(false); }
  }
  return <form aria-label={t("fork.profile.title")} className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Escape" && !busy) { e.preventDefault(); done(); } }}>
    <h2 className="text-sm font-medium">{t("fork.profile.title")}</h2>
    <label className="block text-xs text-muted">{t("fork.profile.profileLabel")}
      <select autoFocus aria-label={t("fork.profile.profileLabel")} value={profile} disabled={busy} onChange={(e) => { setProfile(e.target.value); setArmed(false); setError(null); }} className="mt-1.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm">
        <option value="">{t("fork.profile.sameProfile")}{preview?.sourceProfile ? ` · ${preview.sourceProfile}` : ""}</option>
        {choices.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        {profile && !choices.some((p) => p.name === profile) && <option value={profile} disabled>{profile}</option>}
      </select>
    </label>
    <div className="flex justify-end"><Button size="sm" disabled={busy || loading} onClick={() => setReload(v => v + 1)}>{t("fork.profile.refresh")}</Button></div>
    {loading && <p role="status" className="text-xs text-subtle">{t("fork.profile.profilesLoading")}</p>}
    {!loading && preview && choices.length === 0 && <p className="text-xs text-subtle">{t("fork.profile.noAlternatives")}</p>}
    {cross && <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs" data-fork-confirm="">
      <p title={preview?.historyBytesMeaning}>{size ? t("fork.profile.historySize", { size }) : t("fork.profile.historyUnknown")}</p>
      <p className="text-subtle">{t("fork.profile.sizeEstimate")}</p>
      {preview?.coldCache !== false && <p>{t("fork.profile.coldCache")}</p>}
      {remaining !== null && <p>{t("fork.profile.quota", { n: Math.round(remaining) })}</p>}
      {!loading && matching && preview && !preview.eligible && <p role="alert" className="text-danger">{t(forkErrorKey(preview.reason?.code ?? "") ?? "fork.error.disallowed")}</p>}
    </div>}
    <p className="text-xs text-subtle">{t("fork.profile.boundary")}</p>
    {!cross && preview && !preview.eligible && <p role="status" className="text-xs text-subtle">{t(forkErrorKey(preview.reason?.code ?? "") ?? "fork.error.disallowed")}</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {detail && <details className="text-xs text-subtle"><summary>{t("fork.profile.errorDetails")}</summary><p className="selectable mt-1 break-all whitespace-pre-wrap">{detail}</p></details>}
    <div className="flex justify-end gap-2"><Button disabled={busy} onClick={done}>{t("dialog.cancel")}</Button><Button type="submit" variant="primary" disabled={blocked}>{t(busy ? "fork.profile.creating" : armed ? "fork.profile.confirm" : "fork.profile.create")}</Button></div>
  </form>;
}

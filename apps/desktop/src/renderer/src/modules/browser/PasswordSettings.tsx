// Settings → 浏览器 → 已保存的密码 of one identity (design browser-profiles v3 §8–§9, sketch passwords.png): the store's
// state said plainly (no Windows Hello, key lost after a Hello reset or on a new PC — those passwords cannot be
// recovered), the logins (显示 / 复制 after Hello in main, 删除), 从不保存 sites and the three switches.
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { Button, EmptyState, ListFilter, ListRow, Loading, Section, SettingRow, SettingsGroup, Toggle } from "../../components/settings/Form";
import { SettingsDevicePart } from "../../components/SettingsHostFrame";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";
import { matchesFilter } from "../../lib/listFilter";
import type { BrowserPasswordStoreStatus, BrowserSavedLoginView } from "../../../../shared/browserIdentity";
import { identityRequest, onBrowserIdentityEvent, setBrowserPrefs, useBrowserIdentities, useIdentity, useIdentityPage } from "./identities";
import { IdentityBadge } from "./IdentityBadge";
import { passwordErrorKey } from "./passwordUi";

/** What the store can do now, in one plain line (null: all fine). */
function StatusNote({ status }: { status: BrowserPasswordStoreStatus | null }) {
  const { t } = useI18n();
  if (!status) return null;
  const lines: string[] = [];
  if (!status.available) lines.push(t(status.reason === "noHello" ? "browser.password.status.noHello" : "browser.password.status.unavailable"));
  if (status.keyLost) lines.push(t("browser.password.status.keyLost"));
  else if (status.unreadable > 0) lines.push(t("browser.password.status.unreadable", { n: status.unreadable }));
  if (!lines.length) return null;
  return <div role="status" data-browser-password-status className="mb-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn-text">{lines.map((l) => <p key={l}>{l}</p>)}</div>;
}

export function BrowserPasswordsSubPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  const target = useIdentityPage((s) => s.id);
  const identity = useIdentity(target);
  const prefs = useBrowserIdentities((s) => s.prefs);
  const [logins, setLogins] = useState<BrowserSavedLoginView[] | null>(null);
  const [never, setNever] = useState<string[] | null>(null);
  const [status, setStatus] = useState<BrowserPasswordStoreStatus | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const id = identity?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    void identityRequest((ids) => ids.passwords(id)).then((l) => { if (live) setLogins(l); }, (e) => { if (live) { setLogins([]); setError(t(passwordErrorKey(e))); } });
    void identityRequest((ids) => ids.neverSave(id)).then((l) => { if (live) setNever(l); }, () => { if (live) setNever([]); });
    void identityRequest((ids) => ids.passwordStatus()).then((s) => { if (live) setStatus(s); }, () => {});
    return () => { live = false; };
  }, [id, reload, t]);
  useEffect(() => onBrowserIdentityEvent((e) => { if (e.kind === "passwords" && e.identityId === id) setReload((n) => n + 1); }), [id]);
  if (!identity) return <SettingsDevicePart title={t("browser.part.device")}><EmptyState>{t("browser.identity.page.missing")}</EmptyState></SettingsDevicePart>;

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key); setError(null);
    try { await run(); } catch (e) { setError(t(passwordErrorKey(e))); } finally { setBusy(null); }
  }
  const rows = (logins ?? []).filter((l) => matchesFilter(filter, `${l.origin} ${l.username}`));
  const site = (origin: string) => { try { return new URL(origin).host; } catch { return origin; } };
  return (
    <SettingsDevicePart title={t("browser.part.device")} hint={t("browser.part.deviceHint")}>
      <Section title={<span className="flex items-center gap-2"><IdentityBadge view={identity} size={20} />{t("browser.password.listTitle", { identity: identity.name })}</span>} hint={t("browser.password.listHint")}>
        <StatusNote status={status} />
        <SettingsGroup agents="none" source="local"><div data-browser-passwords={identity.id}>
          {!logins && <Loading rows={2} />}
          {logins && logins.length > 5 && <div role="search" className="contents"><ListFilter count={logins.length} value={filter} onChange={setFilter} /></div>}
          {logins && !logins.length && <EmptyState>{t("browser.password.empty")}</EmptyState>}
          {rows.map((l) => (
            <ListRow key={l.id} title={<span title={l.origin}>{site(l.origin)}</span>} detail={l.username || t("browser.password.noUsername")}
              actions={<span className="flex shrink-0 gap-1.5" data-browser-password-row={l.id}>
                <Button disabled={!!busy || !status?.available} onClick={() => void act(`show:${l.id}`, () => identityRequest((ids) => ids.passwordReveal(l.id)))}>{t("browser.password.show")}</Button>
                <Button disabled={!!busy || !status?.available} onClick={() => void act(`copy:${l.id}`, () => identityRequest((ids) => ids.passwordCopy(l.id)))}>{t("browser.password.copy")}</Button>
                <button type="button" data-browser-password-remove={l.id} disabled={!!busy} onClick={() => void act(`rm:${l.id}`, async () => { await identityRequest((ids) => ids.passwordRemove(l.id)); setReload((n) => n + 1); })}
                  className="rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40">{t("browser.password.remove")}</button>
              </span>} />
          ))}
          {error && <p role="alert" className="py-2 text-xs text-danger">{error}</p>}
          <p className="pt-2 text-xs text-subtle">{t("browser.password.helloNote")}</p>
        </div></SettingsGroup>
      </Section>
      <Section title={t("browser.password.neverTitle")} hint={t("browser.password.neverHint")}>
        <SettingsGroup agents="none" source="local"><div data-browser-password-never-list>
          {!never && <Loading rows={1} />}
          {never && !never.length && <EmptyState>{t("browser.password.neverEmpty")}</EmptyState>}
          {never?.map((origin) => (
            <ListRow key={origin} title={site(origin)} actions={<Button disabled={!!busy} onClick={() => void act(`never:${origin}`, async () => setNever(await identityRequest((ids) => ids.neverSave(identity.id, origin))))}>{t("browser.password.neverRemove")}</Button>} />
          ))}
        </div></SettingsGroup>
      </Section>
      <Section title={t("browser.password.switches")} hint={t("browser.password.switchesHint")}>
        <SettingRow agents="none" source="local" label={t("browser.password.offerSave")}>
          <Toggle checked={prefs.offerSavePasswords} label={t("browser.password.offerSave")} onChange={(v) => void setBrowserPrefs({ offerSavePasswords: v }).catch(() => {})} />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("browser.password.offerFill")}>
          <Toggle checked={prefs.offerFillPasswords} label={t("browser.password.offerFill")} onChange={(v) => void setBrowserPrefs({ offerFillPasswords: v }).catch(() => {})} />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("browser.password.grace")} hint={t("browser.password.graceHint")}>
          <Toggle checked={prefs.passwordHelloGrace} label={t("browser.password.grace")} onChange={(v) => void setBrowserPrefs({ passwordHelloGrace: v }).catch(() => {})} />
        </SettingRow>
      </Section>
    </SettingsDevicePart>
  );
}

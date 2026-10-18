// Profile editor → 代理 (cutex `profile-proxy`, owner-approved proxy v1): 继承主机 / 不使用代理 / 手动 for
// this Profile's runtimes (Codex and Claude), quota readers, model discovery and web search. Saved at
// once on its own (`PATCH /v2/profiles/{p} {proxy}`), never mixed into the editor's draft; the host's own
// setting is Settings → 网络代理. Hidden on a cutex without the capability.
import type { ProfileDetail } from "../../../../shared/ipc";
import { PROFILE_PROXY_FEATURE, type ProfileProxyMode, type ProfileProxyView } from "../../../../shared/proxy";
import { useI18n } from "../../i18n";
import { useHostPlatform } from "../../lib/codeBlockActions";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { Section, TextLink } from "./Form";
import { ProxyEditor } from "./ProxyEditor";

function effectiveText(view: ProfileProxyView, t: ReturnType<typeof useI18n>["t"]): string {
  return view.effective.mode === "none"
    ? t("proxy.profile.effectiveNone")
    : view.effective.mode === "manual"
      ? t("proxy.profile.effectiveManual", { url: view.effective.url ?? "" })
      : view.effective.url
        ? t("proxy.profile.effectiveSystem", { url: view.effective.url })
        : t("proxy.profile.effectiveSystemNone");
}

/**
 * The Profile overview card's 代理 line (r243 acceptance 5): the stored mode, the address cutex keeps
 * (redacted; under 不使用代理 the remembered one 手动 restores) and what is in effect. Click → the 代理 section.
 */
export function ProfileProxySummary({ detail }: { detail: ProfileDetail }) {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const view: ProfileProxyView | undefined = detail.proxy;
  if (!features.has(PROFILE_PROXY_FEATURE) || !view) return null;
  const parts = [t(`proxy.mode.${view.mode}`)];
  if (view.mode === "manual" && view.url) parts.push(view.url);
  if (view.mode === "none" && view.url) parts.push(t("proxy.profile.remembered", { url: view.url }));
  if (view.mode !== "manual") parts.push(t("proxy.profile.effective", { value: effectiveText(view, t) }));
  return (
    <>
      <span className="text-subtle">{t("proxy.profile.title")}</span>
      <button
        type="button"
        data-profile-proxy-summary={view.mode}
        onClick={() => document.getElementById("profile-proxy")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="min-w-0 truncate text-left font-mono hover:text-accent"
        title={parts.join(" · ")}
      >
        {parts.join(" · ")}
      </button>
    </>
  );
}

export function ProfileProxy({ profile, detail, onSaved }: { profile: string; detail: ProfileDetail; onSaved(next: ProfileDetail): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const features = useTargetFeatures();
  const windowsHost = useHostPlatform(useTargetHostId()) === "windows";
  const hostId = useTargetHostId();
  const view: ProfileProxyView | undefined = detail.proxy;
  if (!features.has(PROFILE_PROXY_FEATURE) || !view) return null;
  const effective = effectiveText(view, t);
  return (
    <Section id="profile-proxy" title={t("proxy.profile.title")} hint={t("proxy.profile.hint")}>
      <ProxyEditor<ProfileProxyMode>
        label={t("proxy.modeLabel")}
        modes={[
          { value: "inherit", label: t("proxy.mode.inherit") },
          { value: "none", label: t("proxy.mode.none") },
          { value: "manual", label: t("proxy.mode.manual") },
        ]}
        mode={view.mode}
        manual="manual"
        url={view.url}
        hasCredentials={view.urlHasCredentials}
        noProxy={view.noProxy}
        disabled={!view.editable}
        memoryKey={`profile:${hostId}:${detail.id || profile}`}
        modeHint={(m) => (
          <>
            {m === view.mode && <span className="font-mono text-xs">{t("proxy.profile.effective", { value: effective })}</span>}
            {m === "inherit" && (
              <span className="block">
                <TextLink onClick={() => useApp.getState().openSettings("proxy", { anchor: "hostProxy" })}>{t("proxy.profile.openHost")}</TextLink>
              </span>
            )}
            {m === "none" && windowsHost && <span className="block">{t("proxy.host.windowsNone")}</span>}
            {!view.editable && <span className="block">{t("proxy.host.readOnly")}</span>}
          </>
        )}
        onSave={async (value) => {
          try {
            onSaved(await api.patchProfile(profile, { proxy: value }));
          } catch (e) {
            const text = e instanceof Error ? e.message : String(e);
            throw new Error(/proxy_owner_credential_required/.test(text) ? t("proxy.host.ownerOnly") : text);
          }
        }}
      />
    </Section>
  );
}

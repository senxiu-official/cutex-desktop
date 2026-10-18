// Settings → 网络代理 (owner-approved proxy v1, docs/research/proxy-support-20261017.md Q8): this desktop's
// update proxy (本机, desktop-prefs.json via main) and the picked host's cutex proxy (`/v2/settings.proxy`,
// cutex `proxy-modes`) side by side — two separate settings, never synced (cutex may be another machine).
// Neither touches the desktop's own connection to cutex, which always goes direct.
import { useCallback, useEffect, useState } from "react";
import type { GlobalSettings, ShellState } from "../../../../shared/ipc";
import type { HostProxyMode, HostProxyView, UpdateProxyMode } from "../../../../shared/proxy";
import { bridge } from "../../bridge";
import { SettingsDevicePart, SettingsHostPart } from "../../components/SettingsHostFrame";
import { ProxyEditor } from "../../components/settings/ProxyEditor";
import { ErrorNote, Loading, Notice, Section } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useHostPlatform } from "../../lib/codeBlockActions";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetHostId } from "../../lib/targetHost";
import { SettingsSections } from "../Outlet";
import { useScrollToSettingsAnchor } from "../../lib/settingsFocus";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 本设备 half, then the host half with the Settings host picker (like 浏览器 / 通知). */
export function ProxyPage() {
  const { t } = useI18n();
  useScrollToSettingsAnchor();
  return (
    <>
      <SettingsDevicePart title={t("proxy.part.device")}>
        <SettingsSections page="proxy" only={["proxy.update"]} />
      </SettingsDevicePart>
      <SettingsHostPart title={t("proxy.part.host")}>
        <SettingsSections page="proxy" only={["proxy.host"]} />
      </SettingsHostPart>
    </>
  );
}

/** 本机更新代理: main keeps it (credentials with safeStorage) and applies it to the updater session only. */
export function UpdateProxySection() {
  const { t } = useI18n();
  const shell = bridge.shell;
  const [state, setState] = useState<ShellState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    shell?.state().then(setState, (e: unknown) => setError(errorText(e)));
  }, [shell]);
  const pref = state?.prefs.updateProxy;
  const mode: UpdateProxyMode = pref?.mode ?? "system";
  const available = !!shell?.setUpdateProxy;
  return (
    <Section id={settingsAnchorId("updateProxy")} source="local" title={t("proxy.update.title")} hint={t("proxy.update.hint")}>
      {!state && !error && <Loading rows={1} />}
      {state && (
        <ProxyEditor<UpdateProxyMode>
          label={t("proxy.modeLabel")}
          modes={[
            { value: "system", label: t("proxy.mode.system") },
            { value: "none", label: t("proxy.mode.none") },
            { value: "manual", label: t("proxy.mode.manual") },
          ]}
          mode={mode}
          manual="manual"
          url={pref?.url ?? null}
          hasCredentials={!!pref?.hasCredentials}
          disabled={!available}
          modeHint={(m) => (!available ? t("proxy.update.unavailable") : m === "system" ? t("proxy.update.systemHint") : m === "none" ? t("proxy.update.noneHint") : null)}
          onSave={async (value) => {
            try {
              setState(await shell!.setUpdateProxy!({ mode: value.mode, ...(value.url !== undefined ? { url: value.url } : {}) }));
            } catch (e) {
              throw new Error(/noKeyring/.test(errorText(e)) ? t("proxy.update.noKeyring") : errorText(e));
            }
          }}
        />
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}

/** 主机代理（cutex）of the settings target host. */
export function HostProxySection() {
  const { t } = useI18n();
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const windowsHost = useHostPlatform(hostId) === "windows";
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.getSettings().then(setSettings, (e: unknown) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);
  useEffect(() => {
    setSettings(null);
    load();
  }, [load]);
  const view = settings?.proxy && typeof settings.proxy === "object" && "mode" in settings.proxy ? (settings.proxy as HostProxyView) : null;
  return (
    <Section id={settingsAnchorId("hostProxy")} source="host" title={t("proxy.host.title")} hint={t("proxy.host.hint")}>
      {!settings && !error && <Loading rows={1} />}
      {view && (
        <>
          <ProxyEditor<HostProxyMode>
            label={t("proxy.modeLabel")}
            modes={[
              { value: "system", label: t("proxy.mode.system") },
              { value: "none", label: t("proxy.mode.none") },
              { value: "manual", label: t("proxy.mode.manual") },
            ]}
            mode={view.mode}
            manual="manual"
            url={view.url}
            hasCredentials={view.urlHasCredentials}
            noProxy={view.noProxy}
            disabled={!view.editable}
            memoryKey={`host:${hostId}`}
            modeHint={(m) =>
              m === "system" ? (
                <>
                  {t("proxy.host.systemHint")}
                  <span className="block font-mono text-xs">
                    {view.system ? t("proxy.host.detected", { url: view.system.url, source: t(`proxy.host.source.${view.system.source}`) }) : t("proxy.host.notDetected")}
                  </span>
                </>
              ) : m === "none" ? (
                <>
                  {t("proxy.host.noneHint")}
                  {windowsHost && <span className="block">{t("proxy.host.windowsNone")}</span>}
                </>
              ) : null
            }
            onSave={async (value) => {
              try {
                setSettings(await api.patchProxySettings(value));
              } catch (e) {
                throw new Error(/proxy_owner_credential_required/.test(errorText(e)) ? t("proxy.host.ownerOnly") : errorText(e));
              }
            }}
          />
          <p className="px-1 pb-2 text-xs text-subtle">{t("proxy.loopback")}</p>
          {!view.editable && <Notice tone="info">{t("proxy.host.readOnly")}</Notice>}
          {view.warning && <Notice>{view.warning}</Notice>}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}

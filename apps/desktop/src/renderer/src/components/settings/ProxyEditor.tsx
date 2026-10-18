// One proxy setting's rows (shared/proxy.ts): a mode switch (跟随系统 / 不使用代理 / 手动, or 继承主机 for a
// Profile) that saves at once, and for 手动 the URL (+ optional bypass list) with its own 保存. A stored URL
// is shown without credentials; leaving it unchanged keeps the stored login (cutex / main keep it).
// r243 acceptance 5.3: cutex keeps the manual address only through 不使用代理; 跟随系统 / 继承主机 store
// nothing, and the form's own draft was lost when the editor remounted (leaving the page and coming
// back). `memoryKey` keeps the last manual address of that setting for this window's lifetime, so 手动
// shows it again; it is sent as typed text then (a login it carried is gone with the stored URL).
import { useEffect, useState, type ReactNode } from "react";
import { isProxyParseError, normalizeNoProxy, parseProxyUrl } from "../../../../shared/proxy";
import { useI18n } from "../../i18n";
import { Button, ErrorNote, Segmented, SettingRow, TextInput } from "./Form";

/** Last manual address per setting (memoryKey), this renderer's lifetime only (never persisted). */
const rememberedManual = new Map<string, { url: string; noProxy: string | null }>();

/** Tests: forget every remembered address. */
export function resetRememberedProxyAddresses(): void {
  rememberedManual.clear();
}

export interface ProxyEditorSave<M extends string> {
  mode: M;
  /** Only for manual: undefined = keep the stored URL (and its credentials). */
  url?: string;
  /** Only for manual with a bypass field: null clears it. */
  noProxy?: string | null;
}

export function ProxyEditor<M extends string>({
  label,
  hint,
  modes,
  mode,
  manual,
  url,
  hasCredentials,
  noProxy,
  disabled,
  modeHint,
  memoryKey,
  onSave,
}: {
  label: string;
  hint?: ReactNode;
  modes: readonly { value: M; label: string }[];
  /** The stored mode. */
  mode: M;
  /** Which mode value means "manual URL". */
  manual: M;
  url: string | null;
  hasCredentials: boolean;
  /** Bypass list (undefined = no bypass field, e.g. the desktop update proxy). */
  noProxy?: string | null;
  disabled?: boolean;
  /** Text under the switch for the shown mode (detected proxy, Windows note, …). */
  modeHint?(mode: M): ReactNode;
  /** Remember the last manual address under this key across remounts (e.g. `profile:<host>:<name>`). */
  memoryKey?: string;
  onSave(value: ProxyEditorSave<M>): Promise<unknown>;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState<M>(mode);
  const remembered = memoryKey !== undefined && mode !== manual ? rememberedManual.get(memoryKey) : undefined;
  const [draftUrl, setDraftUrl] = useState(url ?? remembered?.url ?? "");
  const [draftBypass, setDraftBypass] = useState(noProxy ?? remembered?.noProxy ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setShown(mode);
    // cutex (with the Q16 ② fix) and the update proxy return the remembered manual URL outside 手动;
    // an older cutex answers null there, so keep the last one in the form (lost on reload, its login too).
    setDraftUrl((draft) => url ?? (mode === manual ? "" : draft));
    setDraftBypass((draft) => noProxy ?? (mode === manual ? "" : draft));
    if (memoryKey !== undefined && url) rememberedManual.set(memoryKey, { url, noProxy: noProxy ?? null });
  }, [mode, url, noProxy, manual, memoryKey]);

  const run = async (value: ProxyEditorSave<M>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(value);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setShown(mode);
    } finally {
      setBusy(false);
    }
  };
  const pick = (next: M) => {
    setShown(next);
    setError(null);
    setSaved(false);
    if (next !== manual) void run({ mode: next });
  };
  const urlChanged = draftUrl.trim() !== (url ?? "");
  const bypassChanged = noProxy !== undefined && (normalizeNoProxy(draftBypass) ?? "") !== (noProxy ?? "");
  const saveManual = () => {
    const text = draftUrl.trim();
    // An unchanged remembered URL is restored by a bare {mode: manual}, embedded login included (the
    // view's URL is redacted: sending it back would drop the login). Send the text only when the store has none.
    const sendUrl = urlChanged || (mode !== manual && !url);
    if (sendUrl) {
      const parsed = parseProxyUrl(text);
      if (isProxyParseError(parsed)) return setError(t(parsed.error === "scheme" ? "proxy.badScheme" : "proxy.badUrl"));
    }
    void run({
      mode: manual,
      ...(sendUrl ? { url: text } : {}),
      ...(noProxy !== undefined ? { noProxy: normalizeNoProxy(draftBypass) } : {}),
    });
  };
  const showManual = shown === manual;
  return (
    <>
      <SettingRow
        label={label}
        hint={
          <>
            {hint}
            {modeHint?.(shown) && <span className="block">{modeHint(shown)}</span>}
            {saved && !busy && <span className="block text-ok">{t("proxy.saved")}</span>}
          </>
        }
      >
        <Segmented<M> value={shown} options={[...modes]} onChange={pick} disabled={disabled || busy} label={label} />
      </SettingRow>
      {showManual && (
        <>
          <SettingRow
            label={t("proxy.url")}
            hint={
              <>
                {t("proxy.urlHint")}
                {hasCredentials && !urlChanged && <span className="block">{t("proxy.credentialsKept")}</span>}
                <span className="block">{t("proxy.pac")}</span>
              </>
            }
          >
            <TextInput value={draftUrl} onChange={setDraftUrl} placeholder={t("proxy.urlPlaceholder")} mono width="w-72" disabled={disabled || busy} label={t("proxy.url")} />
          </SettingRow>
          {noProxy !== undefined && (
            <SettingRow label={t("proxy.noProxy")} hint={t("proxy.noProxyHint")}>
              <TextInput value={draftBypass} onChange={setDraftBypass} placeholder={t("proxy.noProxyPlaceholder")} mono width="w-72" disabled={disabled || busy} label={t("proxy.noProxy")} />
            </SettingRow>
          )}
          <SettingRow label="">
            <Button primary disabled={disabled || busy || !draftUrl.trim() || (mode === manual && !urlChanged && !bypassChanged)} onClick={saveManual}>
              {t("proxy.save")}
            </Button>
          </SettingRow>
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

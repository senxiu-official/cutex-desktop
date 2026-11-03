import { useOwnerWindow } from "../../lib/ownerContext";
import { useState } from "react";
import { bridge } from "../../bridge";
import { useDebug, captureDebugError, flushDebugReports } from "../../lib/debugState";
import { useI18n } from "../../i18n";
import { Button, Section, SettingRow, Toggle } from "../../components/settings/Form";

export function DebugSection() {
  const { t } = useI18n();
  const win = useOwnerWindow();
  const state = useDebug(s => s.state), reactReady = useDebug(s => s.reactReady);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mac = bridge.platform === "darwin";
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(String(e)); captureDebugError(e, "settings.debug"); } finally { setBusy(false); }
  };
  return <Section title={t("debug.title")} hint={t("debug.hint")}>
    <SettingRow label={t("debug.title")} hint={t("debug.offHint")} agents="none" source="local">
      <Toggle checked={state.enabled} disabled={busy || !bridge.debug} onChange={value => void run(async () => { const state = await bridge.debug!.enable(value); useDebug.setState({ state }); })} />
    </SettingRow>
    {state.enabled && <>
      <SettingRow navigation label={t("debug.recording")} hint={t("debug.recordingHint", { shortcut: mac ? "⌘⌥⇧F" : "Ctrl+Alt+Shift+F" })} agents="none" source="local">
        <Button disabled={busy} onClick={() => void run(async () => { await flushDebugReports(); const state = await bridge.debug!.save(); useDebug.setState({ state }); })}>{t("debug.save")}</Button>
      </SettingRow>
      <SettingRow navigation label={t("debug.devtools")} hint={mac ? "⌘⌥I" : "Ctrl+Shift+I"} agents="none" source="local"><Button onClick={() => void run(() => bridge.debug!.devtools())}>{t("debug.open")}</Button></SettingRow>
      {!reactReady && <p className="py-2 text-xs text-muted">{t("debug.reloadHint")} <button className="text-accent" onClick={() => window.location.reload()}>{t("debug.reload")}</button></p>}
    </>}
    {state.lastBundle && <div className="space-y-2 py-3" data-debug-saved><pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs">{state.lastBundle}</pre><div className="flex gap-2"><Button onClick={() => void win.navigator.clipboard.writeText(state.lastBundle!).catch(e => captureDebugError(e, "debug.copyPath"))}>{t("debug.copyPath")}</Button><Button onClick={() => void run(() => bridge.debug!.reveal())}>{t(mac ? "debug.finder" : bridge.platform === "win32" ? "debug.explorer" : "debug.reveal")}</Button></div></div>}
    {(error || state.error) && <p role="alert" className="py-2 text-xs text-danger">{error || state.error}</p>}
  </Section>;
}

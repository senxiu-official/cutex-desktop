import { useEffect, useRef, useState } from "react";
import { DEFAULT_BROWSER_CURSOR_COLOR, isBrowserCursorColor } from "../../../../shared/browserCursor";
import { ResetButton, SettingRow } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { bridge } from "../../bridge";
import { browserErrorKey } from "./browserState";

export function BrowserCursorSettings() {
  const { t } = useI18n();
  const [color, setColor] = useState(DEFAULT_BROWSER_CURSOR_COLOR), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const edited = useRef(false);
  const saving = useRef(false), pending = useRef<string | null | undefined>(undefined), saved = useRef(DEFAULT_BROWSER_CURSOR_COLOR), live = useRef(true);
  useEffect(() => { live.current = true; let mounted = true; void bridge.browser?.cursorColor().then(view => { if (mounted && isBrowserCursorColor(view.color) && !edited.current) { saved.current = view.color; setColor(view.color); } }, () => {}); return () => { mounted = false; live.current = false; }; }, []);
  async function save(value: string | null) {
    if (!bridge.browser) return;
    edited.current = true; pending.current = value;
    setColor(value ?? DEFAULT_BROWSER_CURSOR_COLOR); setError(null);
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      while (pending.current !== undefined) {
        const next = pending.current; pending.current = undefined;
        try {
          const view = await bridge.browser.cursorColor(next); saved.current = view.color;
          if (live.current && pending.current === undefined) { setColor(view.color); setError(null); }
        } catch {
          if (live.current && pending.current === undefined) { setColor(saved.current); setError(t("browser.actionFailed", { reason: t(browserErrorKey("internal_error")) })); }
        }
      }
    } finally { saving.current = false; if (live.current) setBusy(false); }
  }
  return <><SettingRow agents="none" source="local" label={t("browser.cursorColor")} reset={<ResetButton disabled={busy || color === DEFAULT_BROWSER_CURSOR_COLOR || !bridge.browser} onClick={() => void save(null)} />}>
    <input type="color" aria-label={t("browser.cursorColor")} value={color} disabled={!bridge.browser} onChange={event => void save(event.currentTarget.value)} className="h-8 w-12 cursor-pointer rounded-md border border-border bg-surface p-1 disabled:opacity-40" />
  </SettingRow>{error && <p role="alert" className="text-xs text-danger">{error}</p>}</>;
}

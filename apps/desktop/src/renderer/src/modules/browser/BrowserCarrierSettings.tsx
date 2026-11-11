import { useEffect, useState } from "react";
import { BROWSER_CARRIER_FRAME_RATES, DEFAULT_BROWSER_CARRIER_FRAME_RATE, isBrowserCarrierFrameRate, type BrowserCarrierFrameRate } from "../../../../shared/browserCarrier";
import { ResetButton, Segmented, SettingRow } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { bridge } from "../../bridge";
import { browserError, browserErrorKey } from "./browserState";

/** 「后台网页帧率」: main stores it and applies it to the open background carriers; this row only shows the choice. */
export function BrowserCarrierSettings() {
  const { t } = useI18n();
  const [rate, setRate] = useState<BrowserCarrierFrameRate | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.browser?.carrierFrameRate().then(view => { if (live) setRate(isBrowserCarrierFrameRate(view?.frameRate) ? view.frameRate : DEFAULT_BROWSER_CARRIER_FRAME_RATE); }, reason => { if (live) setError(browserError(reason)); });
    return () => { live = false; };
  }, []);
  async function save(next: BrowserCarrierFrameRate) {
    if (!bridge.browser || busy) return;
    setBusy(true); setError(null);
    try { const view = await bridge.browser.carrierFrameRate(next); setRate(isBrowserCarrierFrameRate(view?.frameRate) ? view.frameRate : next); }
    catch (reason) { setError(browserError(reason)); }
    finally { setBusy(false); }
  }
  const shown = rate ?? DEFAULT_BROWSER_CARRIER_FRAME_RATE;
  return <><SettingRow agents="now" source="local" label={t("browser.carrierFrameRate")} hint={t("browser.carrierFrameRateHint")}
    reset={<ResetButton disabled={busy || !bridge.browser || shown === DEFAULT_BROWSER_CARRIER_FRAME_RATE} onClick={() => void save(DEFAULT_BROWSER_CARRIER_FRAME_RATE)} />}>
    <Segmented value={String(shown)} label={t("browser.carrierFrameRate")} disabled={!bridge.browser || rate === null || busy}
      options={BROWSER_CARRIER_FRAME_RATES.map(value => ({ value: String(value), label: `${value} fps`, title: t(value === 15 ? "browser.carrierFrameRate15" : "browser.carrierFrameRate30") }))}
      onChange={value => void save(Number(value) as BrowserCarrierFrameRate)} />
  </SettingRow>{error && <p role="alert" className="text-xs text-danger">{t("browser.actionFailed", { reason: t(browserErrorKey(error)) })}</p>}</>;
}

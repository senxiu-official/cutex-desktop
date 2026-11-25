// WhatsApp (module `whatsapp`): status, 打开 WhatsApp, reading / preview switches and 解除绑定 — main's watcher of
// one owner browser tab on this desktop. Moved from 服务通知 (owner 2026-11-26: not everyone uses WhatsApp).
import { useEffect, useState } from "react";
import { LOCAL_HOST_ID } from "../../../../shared/hosts";
import { Button, ErrorNote, Notice, Section, SettingRow, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import { services as moduleServices } from "../app";
import { WHATSAPP_TONE, whatsAppState } from "./model";
import { canUnbindWhatsApp, openWhatsApp, setWhatsAppEnabled, setWhatsAppPreview, unbindWhatsApp, useWhatsApp, watchWhatsApp } from "./whatsapp";

const TONE_DOT: Record<(typeof WHATSAPP_TONE)[keyof typeof WHATSAPP_TONE], string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  busy: "bg-accent animate-pulse",
  muted: "bg-subtle",
};

/** WhatsApp: status, 打开 WhatsApp, reading and preview switches (main's watcher on this desktop). */
export function WhatsAppCard({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const { watch, available, error, opening } = useWhatsApp();
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    watchWhatsApp(ctl.signal);
    return () => ctl.abort();
  }, []);
  if (hostId !== LOCAL_HOST_ID) {
    return <Section id={settingsAnchorId("whatsapp")} title={t("whatsapp.title")} hint={t("whatsapp.notHere")} />;
  }
  if (!available) return null;
  const state = whatsAppState(watch);
  const open = async () => {
    setOpenFailed(false);
    if (!(await openWhatsApp(moduleServices.side))) setOpenFailed(true);
  };
  return (
    <Section
      id={settingsAnchorId("whatsapp")}
      title={t("whatsapp.title")}
      hint={t("whatsapp.hint")}
      actions={
        <Button primary onClick={() => void open()} disabled={opening}>
          {opening ? t("whatsapp.opening") : t("whatsapp.open")}
        </Button>
      }
    >
      <SettingRow agents="none" source="local" readOnly label={t("whatsapp.status")} hint={t(`whatsapp.detail.${state}` as const)}>
        <span className="inline-flex items-center gap-1.5 text-sm" role="status" data-whatsapp-state={state}>
          <span aria-hidden className={`size-2 rounded-full ${TONE_DOT[WHATSAPP_TONE[state]]}`} />
          {t(`whatsapp.state.${state}` as const)}
        </span>
      </SettingRow>
      {watch?.tabKey && (
        <>
          <SettingRow agents="none" source="local" label={t("whatsapp.reading")} hint={t("whatsapp.readingHint")}>
            <Toggle checked={watch.enabled} onChange={(on) => void setWhatsAppEnabled(on)} />
          </SettingRow>
          <SettingRow agents="none" source="local" label={t("whatsapp.preview")} hint={t("whatsapp.previewHint")}>
            <Toggle checked={watch.preview} disabled={!watch.enabled} onChange={(on) => void setWhatsAppPreview(on)} />
          </SettingRow>
          {canUnbindWhatsApp() && (
            <SettingRow agents="none" source="local" label={t("whatsapp.unbind")} hint={t("whatsapp.unbindHint")}>
              <Button onClick={() => void unbindWhatsApp()}>{t("whatsapp.unbindAction")}</Button>
            </SettingRow>
          )}
        </>
      )}
      {openFailed && <ErrorNote>{t("whatsapp.openFailed")}</ErrorNote>}
      {error === "timeout" ? <Notice tone="info">{t("whatsapp.bindTimeout")}</Notice> : error ? <ErrorNote>{error}</ErrorNote> : null}
      <Notice tone="info">
        {t("whatsapp.keepAwake")} {t("whatsapp.noAgents")}
      </Notice>
    </Section>
  );
}

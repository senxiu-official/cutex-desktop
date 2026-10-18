import { Eye, LoaderCircle } from "lucide-react";
import { useI18n } from "../../i18n";
import { useBrowserThumbnail } from "./thumbnails";

/**
 * A background agent tab (main's offscreen carrier): its live thumbnail and the one control to bring
 * it to the front. The picture is display only (a bounded JPEG from main); input never goes through
 * it. Front = the page reopens in this card's webview after the agent's running action finished.
 */
export function BrowserBackgroundView(props: { hostId: string; tabKey: string; title: string; handover: boolean; operating: boolean; agentName?: string; onFront(): void }) {
  const { t } = useI18n();
  const image = useBrowserThumbnail(props.hostId, props.tabKey);
  return (
    <div className="absolute inset-0 flex flex-col bg-background" data-browser-background>
      <button type="button" className="relative min-h-0 flex-1 overflow-hidden disabled:cursor-wait" disabled={props.handover} onClick={props.onFront}
        title={t("browser.background.front")} aria-label={t("browser.background.front")}>
        {image
          ? <img src={image} alt={t("browser.background.thumbnailAlt", { title: props.title })} className="h-full w-full object-contain object-top" draggable={false} />
          : <span className="flex h-full items-center justify-center text-xs text-subtle">{t("browser.background.noThumbnail")}</span>}
      </button>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2 text-xs">
        {(props.handover || props.operating) && <LoaderCircle size={13} className="shrink-0 animate-spin text-subtle" aria-hidden="true" />}
        <p role="status" className="min-w-0 flex-1 text-subtle">
          {props.handover ? t("browser.background.handover") : props.agentName ? t("browser.background.statusAgent", { name: props.agentName }) : t("browser.background.status")}
        </p>
        <button type="button" data-browser-front disabled={props.handover} onClick={props.onFront}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-foreground enabled:hover:bg-hover disabled:opacity-40">
          <Eye size={13} aria-hidden="true" />{t("browser.background.front")}
        </button>
      </div>
    </div>
  );
}

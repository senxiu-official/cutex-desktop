import { useState } from "react";
import { AppWindow } from "lucide-react";
import { useI18n } from "../../i18n";
import { useHostServices } from "../../lib/serviceLinkView";
import { serviceSlugOf } from "../../lib/serviceLink";
import type { SideBodyProps, SideTabProps } from "../slots";
import { BrowserBody } from "./BrowserBody";
import { initBrowser, type BrowserState } from "./browserState";
import { useBrowserTab } from "./tabs";

/** Same guest implementation and main-process policy; only the empty service tab has a source picker. */
export function ServiceBody(props: SideBodyProps<BrowserState>) {
  return props.instance.state.url === "about:blank" ? <ServicePicker {...props} /> : <BrowserBody {...props} />;
}

function ServicePicker(props: SideBodyProps<BrowserState>) {
  const { t } = useI18n();
  const list = useHostServices(props.hostId);
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase();
  const services = (list ?? []).filter(s => !s.archived && !s.hidden && (!q || `${s.displayName} ${s.slug}`.toLocaleLowerCase().includes(q)));
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5" data-service-picker>
    <div className="flex items-center gap-2"><AppWindow size={20} /><h3 className="text-sm font-medium">{t("browser.service.choose")}</h3></div>
    <p className="text-xs text-muted">{t("browser.service.hint")}</p>
    <input type="search" aria-label={t("services.search")} placeholder={t("services.search")} value={query} onChange={e => setQuery(e.target.value)} className="h-8 rounded-md border border-card-border bg-surface px-2 text-sm" />
    <div className="flex flex-col gap-1">
      {services.map(service => <button type="button" key={service.slug} className="flex min-w-0 items-center gap-2 rounded-lg p-2 text-left hover:bg-hover"
        onClick={() => props.setState(initBrowser({ url: `cutex:service/${service.slug}/` }, props.instance.state))}>
        <AppWindow size={16} className="shrink-0 text-subtle" /><span className="min-w-0 truncate text-sm">{service.displayName || service.slug}</span>
      </button>)}
      {!services.length && <p className="text-xs text-subtle">{t(q ? "browser.service.noMatch" : "services.none")}</p>}
    </div>
  </div>;
}


export function useServiceTab(props: SideTabProps<BrowserState>) {
  const { t } = useI18n();
  const info = useBrowserTab(props);
  const list = useHostServices(props.hostId);
  const slug = serviceSlugOf(props.instance.state.url);
  const service = slug ? list?.find(s => s.slug === slug) : null;
  return { ...info, title: service?.displayName || slug || (props.instance.state.url === "about:blank" ? t("browser.service.title") : info.title) };
}

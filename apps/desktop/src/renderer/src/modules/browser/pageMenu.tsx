// The 地址行's ⋯ (browser card, owner plan A 2026-11-05): what the page offers beyond the row. 复制地址 and 在系统浏览器打开
// always; 前进 when the row is too narrow to show it; 放到后台运行 on a front agent tab; 重置页面缩放 when zoomed.
// A service (cutex:service/…) or any other non-web address never leaves the app: main opens http(s) only, and the
// disabled row says why (its ⓘ). A service tab copies the service's own address and port (lib/serviceAddress) and
// offers its cutex: link as 复制 cutex 链接.
import { ArrowRight, Copy, ExternalLink, EyeOff, ZoomIn } from "lucide-react";
import type { MenuEntry } from "../../lib/contextMenu";
import type { MessageKey } from "../../i18n";
import { browserExternalUrl } from "./browserState";
import { serviceCopyEntries, type ServiceAddress } from "../../lib/serviceAddress";

export interface BrowserPageMenuInput {
  url: string;
  /** The 地址行 hides 前进; it moves here. */
  narrow: boolean;
  canGoForward: boolean;
  /** Back / forward / background need an attached page and no action in flight. */
  ready: boolean;
  working: boolean;
  /** A front agent-pool tab that can go back to main's background carrier. */
  toBackground: { busy: boolean } | null;
  zoom: number | undefined;
  /** A service tab (`cutex:service/…`) whose service the host list knows. */
  service?: ServiceAddress | null;
}
export interface BrowserPageMenuActions { forward(): void; copy(): void; copyText(text: string): void; openExternal(url: string): void; toBackground(): void; resetZoom(): void }

export function browserPageMenu(input: BrowserPageMenuInput, act: BrowserPageMenuActions, t: (key: MessageKey, vars?: Record<string, string | number>) => string): MenuEntry[] {
  const external = browserExternalUrl(input.url);
  return [
    input.narrow && { label: t("browser.forward"), icon: <ArrowRight size={14} />, disabled: !input.ready || !input.canGoForward || input.working, onSelect: act.forward },
    ...(input.service ? serviceCopyEntries(input.service, t, act.copyText).map((entry, i) => i === 0 && typeof entry === "object" && entry ? { ...entry, icon: <Copy size={14} /> } : entry) : []),
    { label: t(input.service ? "browser.copyServiceLink" : "browser.copy"), icon: input.service ? undefined : <Copy size={14} />, onSelect: act.copy },
    { label: t("browser.external"), icon: <ExternalLink size={14} />, disabled: !external,
      info: external ? undefined : t(input.url.startsWith("cutex:service/") ? "browser.external.serviceNote" : "browser.external.webOnly"),
      onSelect: () => { if (external) act.openExternal(external); } },
    ...(input.toBackground ? ["separator" as const,
      { label: t("browser.background.send"), icon: <EyeOff size={14} />, disabled: input.working || input.toBackground.busy, onSelect: act.toBackground }] : []),
    ...(input.zoom && input.zoom !== 1 ? [{ label: t("browser.zoom.reset"), icon: <ZoomIn size={14} />, hint: `${Math.round(input.zoom * 100)}%`, onSelect: act.resetZoom }] : []),
  ];
}

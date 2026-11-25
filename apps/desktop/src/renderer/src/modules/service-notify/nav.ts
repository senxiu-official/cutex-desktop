// Which service the 服务通知 page shows (this window only): set by the 通知 page's rows before they open it.
import { create } from "zustand";
import { useApp } from "../../store";

export const SERVICE_NOTIFY_PAGE = "service-notifications";

export const useServiceNotifyNav = create<{ slug: string | null; historyService: string | null }>(() => ({ slug: null, historyService: null }));

export function openServiceNotifySettings(slug: string | null): void {
  useServiceNotifyNav.setState({ slug });
  useApp.getState().openSettings(SERVICE_NOTIFY_PAGE);
}

/** 全部记录: the history sub-page, filtered to `service` (null: every service). */
export function openServiceNotifyHistory(service: string | null): void {
  useServiceNotifyNav.setState({ historyService: service });
  useApp.getState().openSettings(SERVICE_NOTIFY_PAGE, { sub: "history" });
}

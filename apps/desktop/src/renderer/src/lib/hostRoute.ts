// The readable label of the route a host is on (Settings → 主机, the switcher's tip).
import type { HostView } from "../../../shared/hosts";
import type { MessageKey } from "../i18n";
import { currentRoute } from "./hosts";

type T = (key: MessageKey, values?: Record<string, string | number>) => string;

/** e.g. 「中继 · remote-work.例子.test（第 2 条，共 3 条）」; null: not a host with several routes. */
export function routeLabel(t: T, host: HostView): string | null {
  const route = currentRoute(host);
  if (!route) return null;
  const { address, position, total } = route;
  return route.kind ? t("host.route.label", { kind: t(`host.route.kind.${route.kind}`), address, position, total }) : t("host.route.labelPlain", { address, position, total });
}

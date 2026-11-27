// The 个人助理 title-bar button's small popover (owner 2026-11-27; right-click, like 快速启动's profiles — a click opens
// the default assistant's conversation): the default assistant's top pending confirmations, each with 发给主管 /
// 取消请求 (click twice, as on the card), what it just finished, 打开今日 and 切换默认助理.
import { Check, CheckCheck, Circle } from "lucide-react";
import { translate } from "../../i18n";
import { openMenuFrom, type MenuEntry } from "../../lib/contextMenu";
import { hostApi } from "../../lib/hostLists";
import { requestGroup } from "../../lib/personalAssistants";
import { cancelRequest, confirmRequest, usePa } from "../../lib/personalAssistantStore";
import type { PaAssistant, PaRequest, PaRequestDetail } from "../../../../shared/personalAssistants";
import { services } from "../app";
import { defaultRow, getDefaultAssistant, setDefaultAssistant } from "./defaultAssistant";
import { allAssistants } from "./todayModel";
import { hostLabel, openAssistant } from "./todayOpen";

/** How many waiting requests / finished ones the popover lists. */
export const MENU_DECIDE = 3;
export const MENU_DONE = 3;
/** "Just finished": completed within this long. */
export const DONE_WINDOW_MS = 24 * 3600_000;

const short = (text: string, n = 48) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** The default assistant's rows the popover shows (pure: tests). */
export function menuRows(requests: readonly PaRequest[], now = Date.now()): { decide: PaRequest[]; moreDecide: number; done: PaRequest[] } {
  const decide = requests.filter((r) => requestGroup(r.state) === "decide").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const done = requests
    .filter((r) => r.state === "completed" && now - Date.parse(r.updatedAt) < DONE_WINDOW_MS)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MENU_DONE);
  return { decide: decide.slice(0, MENU_DECIDE), moreDecide: Math.max(0, decide.length - MENU_DECIDE), done };
}

function requestEntry(hostId: string, a: PaAssistant, r: PaRequest): MenuEntry {
  const t = translate;
  let detail: PaRequestDetail | null = null;
  return {
    label: short(r.outcome),
    icon: <Circle size={10} className="text-attention" aria-hidden />,
    submenu: [
      {
        label: t("personal-assistants.card.send"),
        preparing: t("personal-assistants.rail.loading"),
        armedTone: "accent",
        prepare: async () => {
          detail = await hostApi(hostId).paRequest(a.id, r.id);
          const seat = detail.currentDirector;
          if (detail.request.state !== "awaitingOwner") return { empty: t("personal-assistants.menu.changed") };
          if (!seat?.sessionId) return { empty: t("personal-assistants.card.noDirector") };
          return { armed: t("personal-assistants.menu.sendArmed") };
        },
        onSelect: async () => {
          const d = detail;
          if (!d?.currentDirector?.sessionId) return;
          try {
            await confirmRequest(hostId, a.id, r.id, { expectedRevision: d.request.revision, expectedAssistantRevision: d.currentAssistantRevision, director: d.currentDirector });
            services.ui.toast(t("personal-assistants.menu.sent"));
          } catch {
            services.ui.notice(t("personal-assistants.menu.failed"), "error");
          }
        },
      },
      {
        label: t("personal-assistants.card.cancel"),
        armed: t("personal-assistants.menu.cancelArmed"),
        onSelect: async () => {
          try {
            await cancelRequest(hostId, a.id, r.id, { expectedRevision: r.revision });
            services.ui.toast(t("personal-assistants.state.cancelled"));
          } catch {
            services.ui.notice(t("personal-assistants.menu.failed"), "error");
          }
        },
      },
      "separator",
      { label: t("personal-assistants.menu.openCard"), onSelect: () => void openAssistant(hostId, a) },
    ],
    onSelect: () => {},
  };
}

/** The popover's entries now (outside React: read from the stores). */
export function todayMenuEntries(now = Date.now()): MenuEntry[] {
  const t = translate;
  const byHost = usePa.getState().byHost;
  const all = allAssistants(byHost);
  const d = defaultRow(all, getDefaultAssistant());
  if (!d) {
    return [
      { label: t("personal-assistants.menu.none"), note: true, disabled: true, onSelect: () => {} },
      { label: t("personal-assistants.todayView.create"), onSelect: () => services.ui.openPage("personal-assistants.page", {}) },
    ];
  }
  const { hostId, assistant: a } = d;
  const rows = menuRows(byHost[hostId]?.requests[a.id] ?? [], now);
  const multiHost = new Set(all.map((x) => x.hostId)).size > 1;
  const where = (x: { hostId: string; assistant: PaAssistant }) => (multiHost ? `${x.assistant.config.name} · ${hostLabel(x.hostId)}` : x.assistant.config.name);
  return [
    { label: t("personal-assistants.menu.header", { name: where(d) }), note: true, disabled: true, onSelect: () => {} },
    rows.decide.length === 0
      ? { label: t("personal-assistants.todayView.decideNone"), note: true, disabled: true, onSelect: () => {} }
      : null,
    ...rows.decide.map((r) => requestEntry(hostId, a, r)),
    rows.moreDecide > 0 && { label: t("personal-assistants.menu.moreDecide", { n: rows.moreDecide }), onSelect: () => void openAssistant(hostId, a) },
    rows.done.length > 0 && "separator",
    rows.done.length > 0 && { label: t("personal-assistants.menu.doneHeader"), note: true, disabled: true, onSelect: () => {} },
    ...rows.done.map((r): MenuEntry => ({ label: short(r.outcome), icon: <CheckCheck size={12} className="text-ok" aria-hidden />, onSelect: () => void openAssistant(hostId, a) })),
    "separator",
    { label: t("personal-assistants.menu.openToday"), onSelect: () => void openAssistant(hostId, a) },
    all.length > 1 && {
      label: t("personal-assistants.menu.switchDefault"),
      onSelect: () => {},
      submenu: all.map((x): MenuEntry => {
        const on = x.hostId === hostId && x.assistant.id === a.id;
        return { label: where(x), icon: on ? <Check size={12} aria-hidden /> : <span className="inline-block w-3" />, onSelect: () => setDefaultAssistant({ hostId: x.hostId, assistantId: x.assistant.id }) };
      }),
    },
    { label: t("personal-assistants.menu.settings"), onSelect: () => services.ui.openPage("personal-assistants.page", { host: hostId, id: a.id, tab: "settings" }) },
  ];
}

export function openTodayMenu(anchor: HTMLElement): void {
  openMenuFrom(anchor, todayMenuEntries(), { owner: "personal-assistants.today" });
}

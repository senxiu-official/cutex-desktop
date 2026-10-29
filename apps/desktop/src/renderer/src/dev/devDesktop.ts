// Preview entry points for the desktop layer (contract 1.18 `pane.desktop`, docs/desktop-modules.md §25),
// started by dev/mockBridge.ts after the first render: `?desktop` = 显示桌面, `?homeprofile` = the 个人页
// pane, `?homeedit` = the desktop with 编辑主页 on (its button, by DOM), `?services` = 服务 cards,
// `?services&servicesDetails` = its detailed list; `?autoapproval` = Eva with the Cutex rules chip;
// `?autoapprovalSettings` = the rules and audit settings. Through the shell's services only — no module code
// is imported here. `?homeAt=<ms>`: when (default 1500 ms after start).
import { revealDesktop } from "../lib/paneActions";
import { services } from "../modules/app";
import { useApp } from "../store";

export function installDevDesktop(q: URLSearchParams): void {
  const at = Number(q.get("homeAt")) || 1500;
  if (q.has("desktop") || q.has("homeedit")) setTimeout(() => revealDesktop(), at);
  if (q.has("homeedit")) setTimeout(() => document.querySelector<HTMLElement>("[data-home-editbtn]")?.click(), at + 400);
  if (q.has("homeprofile")) setTimeout(() => services.panes.open("home.profile", {}, { focus: true }), at + 400);
  if (q.has("services")) {
    localStorage.setItem("cutex.services.view.v1", q.has("servicesDetails") ? "details" : "cards");
    setTimeout(() => services.ui.openPage("services.page"), at + 400);
  }
  if (q.has("autoapproval")) setTimeout(() => void useApp.getState().openAgent("eva", "local"), at);
  if (q.has("autoapprovalSettings")) setTimeout(() => useApp.getState().openSettings("collab"), at + 400);
}

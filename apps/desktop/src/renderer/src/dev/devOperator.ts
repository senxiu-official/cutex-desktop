// Deterministic Operator preview; imported by the projects mock only.
// ?operator[=overview|agents|menu|sidebar|idle]&perf=quiet
import { services } from "../modules/app";
import { useApp } from "../store";
import { setUiPref } from "../lib/prefs";
import { translate } from "../i18n";
import type { MockCore } from "./mockTypes";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const skipGuides = () => {
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (/跳过引导|全部跳过|Skip/.test(button.textContent ?? "")) button.click();
  }
};

export function installDevOperator(q: URLSearchParams, core: MockCore): void {
  const scene = q.get("operator") || "overview";
  const id = scene === "idle" ? "mika" : "alden";
  const show = async (view: string) => {
    for (let attempt = 0; attempt < 40 && !useApp.getState().sidebar; attempt++) await wait(100);
    const app = useApp.getState();
    if (!app.sidebar) throw Error("operator_preview_not_ready");
    const host = app.hosts?.active ?? "local";
    await app.refreshHostSidebar(host);
    skipGuides();
    setUiPref("runningAgents", "compact");
    setUiPref("foldIdleAgents", false);
    if (view === "sidebar") await useApp.getState().select(id, host);
    else services.ui.openPage("projects.page", { project: "desktop", tab: view === "agents" || view === "menu" ? "agents" : "overview" });
    await wait(300);
    skipGuides();
    if (view === "menu") {
      const rows = [...document.querySelectorAll<HTMLElement>(".agent-list [data-agent-row]")];
      const row = rows.find(row => row.textContent?.includes("Alden"));
      [...(row?.querySelectorAll<HTMLButtonElement>("button[title]") ?? [])].find(button => button.title === translate("menu.more"))?.click();
    }
    (window as unknown as { __operatorReady: boolean }).__operatorReady = true;
  };
  (window as unknown as { __operator: unknown }).__operator = {
    show,
    async finishBusy() {
      const session = core.projectRecords().active.find(s => s.cutexSessionId === id);
      if (session) session.runtime.activeTurnId = null;
      core.markIdle(id);
      await useApp.getState().refreshHostSidebar(useApp.getState().hosts?.active ?? "local");
    },
  };
  setTimeout(() => void show(scene), Number(q.get("operatorAt")) || 1000);
}

// Page routing (docs/desktop-modules.md §3.2 / §7, step 3): MainView = conversation | page,
// services.ui.openPage / closePage / openSettings, settings params, host switch.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { useApp, profilePageOf, pageOf, SETTINGS_PAGE, DRAFT_CHAT_PAGE } = await import("../src/renderer/src/store");
const { services } = await import("../src/renderer/src/modules/app");
const { settingsTab } = await import("../src/renderer/src/lib/settingsNav");

describe("openPage routing", () => {
  it("openPage shows a main.page with its params; closePage goes back to the conversation", () => {
    services.ui.openPage("jobs.page", { agent: "cutex.a", scope: "done" });
    expect(useApp.getState().view).toEqual({ kind: "page", page: "jobs.page", params: { agent: "cutex.a", scope: "done" } });
    expect(pageOf(useApp.getState().view)).toBe("jobs.page");
    services.ui.openPage("projects.page");
    expect(useApp.getState().view).toEqual({ kind: "page", page: "projects.page", params: {} });
    services.ui.closePage();
    expect(useApp.getState().view).toEqual({ kind: "conversation" });
    expect(pageOf(useApp.getState().view)).toBeNull();
  });

  it("openSettings is the shell.settings page; Profiles sub-pages travel as params", () => {
    services.ui.openSettings("about");
    expect(useApp.getState().view).toEqual({ kind: "page", page: SETTINGS_PAGE, params: { tab: "about" } });
    services.ui.openSettings("profiles", { profile: "work" });
    const view = useApp.getState().view;
    expect(view.kind === "page" && profilePageOf(view.params)).toEqual({ kind: "profile", name: "work" });
    services.ui.openSettings("profiles", { create: true });
    const created = useApp.getState().view;
    expect(created.kind === "page" && profilePageOf(created.params)).toEqual({ kind: "new" });
    // A profile focus on another tab is not a sub-page.
    services.ui.openSettings("general", { profile: "work" });
    const general = useApp.getState().view;
    expect(general.kind === "page" && profilePageOf(general.params)).toBeUndefined();
    expect(settingsTab({})).toBe("general");
  });

  it("接入 / 互联 links land on 主机; 用户 is its own page (连接 D plan 2026-10-19)", () => {
    for (const tab of ["remote", "peers"]) expect(settingsTab({ tab })).toBe("access");
    expect(settingsTab({ tab: "users" })).toBe("users");
    expect(settingsTab({ tab: "access" })).toBe("access");
    expect(settingsTab({ tab: "hosts" })).toBe("hosts");
  });

  it("newQuickChat opens the draft page", async () => {
    await useApp.getState().newQuickChat();
    expect(pageOf(useApp.getState().view)).toBe(DRAFT_CHAT_PAGE);
  });
});

// @vitest-environment jsdom
// The New Agent page's opening (owner 2026-11-27): provider columns, artwork or the name on top, Profile chips below.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";

const state = vi.hoisted(() => ({ module: true, display: true, art: {} as Record<string, { portrait: string; victory: string }> }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${Object.values(vars).join("|")}` : key), locale: "en" }) }));
vi.mock("../src/renderer/src/lib/profileAvatar", () => ({ useProfileAvatar: () => null }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useModuleEnabled: () => state.module }));
vi.mock("../src/renderer/src/lib/prefs", async (original) => ({ ...(await original<object>()), useUiPrefs: () => ({ timelineIntro: state.display }) }));
vi.mock("../src/renderer/src/lib/launchArt", async (original) => ({ ...(await original<object>()), useLaunchArtView: () => ({ art: state.art, imported: {}, ready: true }), useLaunchArt: () => state.art }));

const { LaunchProviderColumns, chipCapacity, columnChips, providerColumns } = await import("../src/renderer/src/components/LaunchProviderColumns");
const { LaunchIntro } = await import("../src/renderer/src/components/LaunchPage");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile = (id: string, extra: Partial<ProfileItem> = {}): ProfileItem => ({ id, name: id, authKind: "apiKey", baseUrl: null, planLabel: null, ...extra }) as unknown as ProfileItem;
const claude = (id: string) => profile(id, { authKind: "claude", cliKind: "claude" } as Partial<ProfileItem>);
const codex = (id: string) => profile(id, { authKind: "chatgpt" });
const PROFILES = [claude("ceobe"), codex("gamma"), claude("claude-work"), profile("relay", { baseUrl: "https://relay.example.net/v1" })];

let node: HTMLDivElement, root: Root;
beforeEach(() => { state.module = true; state.display = true; state.art = {}; node = document.createElement("div"); document.body.append(node); root = createRoot(node); });
afterEach(() => { act(() => root.unmount()); node.remove(); });

type Props = Parameters<typeof LaunchProviderColumns>[0];
async function render(props: Partial<Props> = {}) {
  const onSelect = vi.fn();
  await act(async () => root.render(h(LaunchProviderColumns, { hostId: "local", profiles: PROFILES, art: {}, profileId: "gamma", selected: false, auto: false, unavailable: () => null, disabled: false, onSelect, ...props })));
  return onSelect;
}
const column = (key: string) => node.querySelector<HTMLElement>(`[data-provider="${key}"]`)!;
const chips = (key: string) => [...column(key).querySelectorAll<HTMLButtonElement>(".launch-column-chip:not(.launch-column-more)")];

describe("providerColumns / chip fit", () => {
  it("portrait providers in the launcher's order, others after; Profiles in host order", () => {
    expect(providerColumns(PROFILES).map((c) => [c.key, c.profiles.map((p) => p.id)])).toEqual([["codex", ["gamma"]], ["claude", ["ceobe", "claude-work"]], ["other", ["relay"]]]);
  });
  it("slots from the measured room: chips and gaps that fit; not laid out = no limit", () => {
    expect(chipCapacity(300, 32, 5)).toBe(8); // 8 × 32 + 7 × 5 = 291
    expect(chipCapacity(100, 32, 5)).toBe(2);
    expect(chipCapacity(10, 32, 5)).toBe(1); // never less than one slot
    expect(chipCapacity(0, 32, 5)).toBeNull();
    expect(chipCapacity(300, 0, 5)).toBeNull();
  });

  it("fits: every chip, no 「+N」; overflow: the last slot is 「+N」 and the chosen Profile stays visible", () => {
    const list = ["a", "b", "c", "d", "e"].map((id) => codex(id));
    const ids = (r: { chips: ProfileItem[]; more: number }) => [r.chips.map((p) => p.id), r.more];
    expect(ids(columnChips(list.slice(0, 4), "b", 8))).toEqual([["a", "b", "c", "d"], 0]); // 4 Profiles at a normal size
    expect(ids(columnChips(list, "b", 5))).toEqual([["a", "b", "c", "d", "e"], 0]); // exactly fits
    expect(ids(columnChips(list, "b", null))).toEqual([["a", "b", "c", "d", "e"], 0]); // not measured yet
    expect(ids(columnChips(list, "b", 4))).toEqual([["a", "b", "c"], 2]);
    expect(ids(columnChips(list, "e", 4))).toEqual([["a", "b", "e"], 2]);
    expect(ids(columnChips(list, "e", 1))).toEqual([["e"], 4]);
  });
});

describe("LaunchProviderColumns", () => {
  it("no artwork: each column's name as text on top; the chosen Profile pressed; a pick calls onSelect", async () => {
    const onSelect = await render();
    expect(node.querySelector(".launch-columns-art")).toBeNull();
    expect([...node.querySelectorAll(".launch-column-title")].map((e) => e.textContent)).toEqual(["Codex", "Claude", "launch.columns.other"]);
    expect(chips("codex")[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(chips("claude").map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    await act(async () => chips("claude")[1]!.click());
    expect(onSelect).toHaveBeenCalledWith("claude-work");
  });

  it("artwork: the slot's portrait on top, the victory image on the picked column", async () => {
    const art = { claude: { portrait: "data:claude-portrait", victory: "data:claude-victory" } };
    await render({ art, profileId: "ceobe" });
    expect(node.querySelector(".launch-columns-art")).not.toBeNull();
    expect(column("claude").querySelector("img")!.getAttribute("src")).toBe("data:claude-portrait");
    // A column without artwork shows its name on top instead (no empty box).
    expect(column("codex").querySelector(".launch-column-top .launch-column-title")!.textContent).toBe("Codex");
    await render({ art, profileId: "ceobe", selected: true });
    expect(column("claude").querySelector("img")!.getAttribute("src")).toBe("data:claude-victory");
  });

  it("room for every Profile: all chips, no 「+N」", async () => {
    await render({ profiles: ["a", "b", "c", "d"].map((id) => codex(id)), profileId: "b" });
    expect(chips("codex").map((b) => b.textContent)).toEqual(["Aa", "Bb", "Cc", "Dd"]);
    expect(node.querySelector(".launch-column-more")).toBeNull();
  });

  it("an opening too short for the column: 「+N」 takes the last slot and lists the whole column", async () => {
    // Layout stubs: a 100px opening, 30px chips, nothing above them → 3 slots (2 chips + 「+N」).
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    Object.defineProperty(node, "clientHeight", { configurable: true, value: 100 });
    const many = ["a", "b", "c", "d", "e"].map((id) => codex(id));
    const onSelect = await render({ profiles: many, profileId: "e" });
    height.mockRestore();
    expect(chips("codex").map((b) => b.textContent)).toEqual(["Aa", "Ee"]);
    const more = column("codex").querySelector<HTMLButtonElement>(".launch-column-more")!;
    expect(more.textContent).toBe("+3");
    await act(async () => more.click());
    const listed = [...document.querySelectorAll<HTMLButtonElement>(".launch-profile-choice")];
    expect(listed.map((b) => b.textContent)).toEqual(["Aa", "Bb", "Cc", "Dd", "Ee"]);
    await act(async () => listed[3]!.click());
    expect(onSelect).toHaveBeenCalledWith("d");
  });

  it("自动 on: the marker on the column of the Profile auto uses, that Profile highlighted", async () => {
    await render({ auto: true, profileId: "claude-work" });
    expect(column("claude").querySelector(".launch-column-auto")?.textContent).toBe("autoPick.auto");
    expect(node.querySelectorAll(".launch-column-auto")).toHaveLength(1);
    expect(chips("claude")[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("unavailable Profiles are greyed with the reason; a column with none usable is greyed too", async () => {
    await render({ unavailable: (p) => (p.cliKind === "claude" ? "no Claude here" : null) });
    expect(chips("claude").every((b) => b.disabled && b.title === "no Claude here")).toBe(true);
    expect(column("claude").classList.contains("is-unavailable")).toBe(true);
    expect(column("claude").title).toBe("no Claude here");
    expect(chips("codex")[0]!.disabled).toBe(false);
  });

  it("locked: every chip disabled", async () => {
    await render({ disabled: true, profiles: ["a", "b", "c", "d"].map((id) => codex(id)) });
    expect([...node.querySelectorAll<HTMLButtonElement>("button")].every((b) => b.disabled)).toBe(true);
  });
});

describe("LaunchIntro with columns", () => {
  const columns = (profiles: ProfileItem[] | null) => ({ hostId: "local", profiles, profileId: "gamma", selected: false, auto: false, unavailable: () => null, disabled: false, onSelect: () => {} });
  const intro = (profiles: ProfileItem[] | null) => h(LaunchIntro, { icon: "icon", title: "New agent", hint: "help", columns: columns(profiles) });

  it("shows the columns in place of the welcome line; holds the frame while loading", async () => {
    await act(async () => root.render(intro(PROFILES)));
    expect(node.querySelector(".launch-intro-columns .launch-columns")).not.toBeNull();
    expect(node.textContent).not.toContain("help");
    await act(async () => root.render(intro(null)));
    expect(node.innerHTML).toBe("");
  });

  it("opening turned off, or no Profiles: the plain icon intro", async () => {
    state.module = false;
    await act(async () => root.render(intro(PROFILES)));
    expect(node.querySelector(".launch-columns")).toBeNull();
    expect(node.textContent).toContain("help");
    state.module = true;
    await act(async () => root.render(intro([])));
    expect(node.querySelector(".launch-columns")).toBeNull();
    expect(node.textContent).toContain("help");
  });
});

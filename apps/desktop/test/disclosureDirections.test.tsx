// @vitest-environment jsdom
import { act, createElement as h, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const home = vi.hoisted(() => ({ state: { editing: true, panel: false }, listeners: new Set<() => void>() }));
vi.mock("../src/renderer/src/modules/home/store", () => ({
  useHomeEdit: (selector: (state: typeof home.state) => unknown) => useSyncExternalStore(listener => { home.listeners.add(listener); return () => { home.listeners.delete(listener); }; }, () => selector(home.state)),
  setHomeEditing: (editing: boolean, panel = true) => { home.state = { editing, panel }; home.listeners.forEach(listener => listener()); },
}));
vi.mock("../src/renderer/src/modules/home/hooks", () => ({ useDeskBackdrop: () => null }));
vi.mock("../src/renderer/src/modules/home/Parts", () => ({ ArtCredit: () => null, DesktopBackdrop: () => null }));
vi.mock("../src/renderer/src/modules/home/EditPanel", () => ({ EditPanel: () => h("span", null, "Edit panel") }));
vi.mock("../src/renderer/src/modules/home/DeskSurface", () => ({ DeskSurface: () => null, deskMenu: {}, useDeskUi: (selector: (state: { canUndo: boolean }) => unknown) => selector({ canUndo: false }) }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => 0, formatWhen: () => "now", formatAbsolute: () => "now" }));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({ useHostOwnerNotes: () => ({}), focusOwnerNote: vi.fn() }));
vi.mock("../src/renderer/src/lib/ownerNotify", () => ({ canReply: () => true, noteFirstLine: (text: string) => text, openAgentPendingNotes: () => [{ notificationId: "note", text: "Question", createdAt: "2026-10-24T00:00:00Z" }], ownerNeedReason: () => "ownerReply", pendingNoteLabel: () => "awaitsReply" }));
vi.mock("../src/renderer/src/lib/statusChips", async (original) => ({ ...(await original<object>()), chipTone: () => "attention" }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: ({ text }: { text: string }) => h("p", null, text) }));
vi.mock("../src/renderer/src/components/OwnerReplyBox", () => ({ OwnerReplyBox: ({ onClose }: { onClose(): void }) => h("button", { onClick: onClose }, "Close reply") }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/resizeHub", () => ({ sharedResizeObserver: () => ({ observe() {}, disconnect() {} }) }));
vi.mock("../src/renderer/src/lib/settingsSearchView", () => ({ useOnSettingsReveal: () => {} }));
vi.mock("../src/renderer/src/lib/globalSettings", () => ({ useGlobalSettings: () => ({ settings: null }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetFeatures: () => new Set(), useTargetHostId: () => "local", useTargetApi: () => ({}), useTargetIsFocus: () => true }));
vi.mock("../src/renderer/src/modules/agent-bus/CleanupSection", () => ({ CleanupSection: () => null }));
vi.mock("../src/renderer/src/modules/claude-accounts/useClaudeAccounts", () => ({ useClaudeAccounts: () => ({ list: [], loading: false, quotas: {} }) }));
vi.mock("../src/renderer/src/modules/claude-accounts/hooks", () => ({ useAccountTitle: () => () => "Account", useRefusalText: () => () => "", errorText: String }));
vi.mock("../src/renderer/src/modules/claude-accounts/AccountFlow", () => ({ AccountGuide: () => null, AddForm: () => null }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentNotice: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Section: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => h("section", null, actions, children),
  IconButton: ({ children, label, onClick }: { children: ReactNode; label: string; onClick(): void }) => h("button", { "aria-label": label, onClick }, children),
  AddButton: ({ children, onClick }: { children: ReactNode; onClick(): void }) => h("button", { onClick }, children),
  useSettingsRowDecoration: () => undefined,
  RefreshButton: () => null, Loading: () => h("span", null, "Loading"), ErrorNote: () => null, Notice: () => null,
  NumberField: () => null, ResetButton: () => null, SettingRow: () => null, Toggle: () => null,
  ArmedRemove: () => null, Button: () => null, TextInput: () => null,
}));
import { DesktopLayer } from "../src/renderer/src/modules/home/Desktop";
import { PendingOwnerNotes } from "../src/renderer/src/components/PendingOwnerNotes";
import { ClampBox } from "../src/renderer/src/components/ClampBox";
import { StatusChip } from "../src/renderer/src/components/StatusChip";
import { AdvancedSection } from "../src/renderer/src/modules/agent-bus/BusSettings";
import { ClaudeAccountsSection } from "../src/renderer/src/modules/claude-accounts/ClaudeAccountsSection";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { home.state = { editing: true, panel: false }; home.listeners.clear(); localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const icon = (element: Element, direction: "right" | "down") => expect(element.querySelector(`.lucide-chevron-${direction}`)).not.toBeNull();

it("long text shows right when clamped, down when expanded, and restores its clamp", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);
  act(() => root.render(h(ClampBox, { lines: 2, children: "long text" })));
  const button = host.querySelector("button")!;
  icon(button, "right"); expect(host.querySelector("[data-clamped]")).not.toBeNull();
  act(() => button.click());
  icon(button, "down"); expect(button.getAttribute("aria-expanded")).toBe("true"); expect(host.querySelector("[data-clamped]")).toBeNull();
  act(() => button.click());
  icon(button, "right"); expect(host.querySelector("[data-clamped]")).not.toBeNull();
});

it("a floating status panel uses disclosure directions and still closes on Escape", () => {
  function Panel() { const [open, setOpen] = useState(false); return h(StatusChip, { label: "Plan", open, onOpenChange: setOpen, children: "details" }); }
  act(() => root.render(h(Panel)));
  const button = host.querySelector("button")!;
  icon(button, "right"); expect(host.querySelector("[data-popover]")).toBeNull();
  act(() => button.click()); icon(button, "down"); expect(host.querySelector("[data-popover]")?.textContent).toBe("details");
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  icon(button, "right"); expect(host.querySelector("[data-popover]")).toBeNull();
});

it("agent-bus advanced controls use right/down when their section opens and closes", () => {
  act(() => root.render(h(AdvancedSection)));
  const button = () => host.querySelector<HTMLButtonElement>('button[aria-label^="agent-bus.advanced"]')!;
  icon(button(), "right");
  act(() => button().click()); icon(button(), "down"); expect(host.textContent).toContain("Loading");
  act(() => button().click()); icon(button(), "right"); expect(host.textContent).not.toContain("Loading");
});

it("Claude accounts rotate their disclosure chevron and retain their open preference", () => {
  act(() => root.render(h(ClaudeAccountsSection)));
  const button = () => host.querySelector<HTMLButtonElement>('[data-settings-disclosure] button[aria-expanded]')!;
  const chevron = () => host.querySelector('[data-settings-disclosure] .lucide-chevron-right')!;
  expect(chevron().classList.contains("rotate-90")).toBe(false);
  act(() => button().click()); expect(chevron().classList.contains("rotate-90")).toBe(true); expect(button().getAttribute("aria-expanded")).toBe("true"); expect(localStorage.getItem("cutex-desktop.claude-accounts.open")).toBe("1");
  act(() => button().click()); expect(chevron().classList.contains("rotate-90")).toBe(false); expect(button().getAttribute("aria-expanded")).toBe("false"); expect(localStorage.getItem("cutex-desktop.claude-accounts.open")).toBe("0");
});

it("the pending reply composer uses right/down and closes through its existing close action", () => {
  act(() => root.render(h(PendingOwnerNotes, { sessionId: "s", hostId: "local" })));
  const button = host.querySelector<HTMLButtonElement>("[data-pending-reply]")!;
  icon(button, "right"); expect(host.querySelector("[data-pending-reply-panel]")).toBeNull();
  act(() => button.click()); icon(button, "down"); expect(button.getAttribute("aria-expanded")).toBe("true");
  act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Close reply")!.click());
  icon(button, "right"); expect(host.querySelector("[data-pending-reply-panel]")).toBeNull();
});

it("the desktop edit panel uses right/down while preserving its edit mode", () => {
  act(() => root.render(h(DesktopLayer, { reason: "empty", hostId: "local", tray: false })));
  const button = host.querySelector<HTMLButtonElement>("[data-home-openpanel]")!;
  icon(button, "right"); expect(host.querySelector("[data-home-editpanel]")).toBeNull();
  act(() => button.click()); icon(button, "down"); expect(host.querySelector("[data-home-editpanel]")).not.toBeNull();
  act(() => button.click()); icon(button, "right"); expect(host.querySelector("[data-home-editpanel]")).toBeNull();
  expect(home.state.editing).toBe(true);
});

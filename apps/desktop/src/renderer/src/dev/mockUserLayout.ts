import type { DesktopApi } from "../../../shared/ipc";
import { emptySidebar } from "../lib/userLayoutModel";

export const MOCK_LAYOUT_INSTANCE = `ci-${"a".repeat(32)}`;
const scene = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("layoutMemory");
export function mockLayoutInstance(id: string): string {
  if (id === "local") return MOCK_LAYOUT_INSTANCE;
  return `ci-${[...id].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(32, "0").slice(0, 32)}`;
}
const memoryHost = { instanceId: scene === "missing" ? `ci-${"f".repeat(32)}` : MOCK_LAYOUT_INSTANCE, label: scene === "missing" ? "HOME-HOST" : "HOST-A" };
// Each host's person document: one entry per section (the sidebar, and settings sync's settings-<category>).
const views = new Map<string, Map<string, { revision: number; data: Record<string, unknown> | null }>>();
// `?settingsSync=differs`: synced settings another computer wrote (dark theme, indigo accent, the desk pet on),
// so Settings → 你 shows 本机设置 vs 同步设置 and the 「保留哪一份？」 question.
const syncScene = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("settingsSync");
const field = (v: unknown) => ({ v, t: 1_790_000_000_000 });
function seededSettings(): [string, Record<string, unknown>][] {
  if (syncScene !== "differs") return [];
  return [
    ["settings-appearance", { fields: { theme: field("dark"), accent: field("indigo"), contrast: field("standard"), lightPalette: field("plain"), darkPalette: field("graphite") } }],
    ["settings-modules", { fields: { "desk-pet": field(true), jobs: field(false) } }],
  ];
}
export function prepareMockLayout() {
  if (!scene) return;
  const confirmed = { ...emptySidebar(), sections: scene === "migration" ? [{ id: "remote-work", name: "Remote work", collapsed: false, members: [] }] : [] };
  localStorage.setItem("cutex-desktop.userLayout.v1", JSON.stringify({ memoryHost, hosts: { local: MOCK_LAYOUT_INSTANCE }, entries: scene === "migration" ? {} : { [memoryHost.instanceId]: { docKey: "owner", revision: 0, confirmed, operations: [], migratedAt: 1 } } }));
}
export function mockUserLayoutApi(id: string, changed: (section: string, revision: number) => void): Pick<DesktopApi, "userLayout" | "putUserLayout" | "putLayoutPointer"> {
  if (!views.has(id)) views.set(id, new Map<string, { revision: number; data: Record<string, unknown> | null }>([
    ["sidebar", { revision: 0, data: scene === "migration" ? { ...emptySidebar(), sections: [{ id: "remote-work", name: "Remote work", collapsed: false, members: [] }] } : null }],
    ...seededSettings().map(([section, data]) => [section, { revision: 1, data }] as const),
  ]));
  const doc = views.get(id)!;
  return {
    async userLayout(): ReturnType<DesktopApi["userLayout"]> {
      if (scene === "offline" && id === "local") throw new Error("Memory host offline (mock)");
      const sections = Object.fromEntries([...doc].filter(([, e]) => e.data).map(([name, e]) => [name, { ...e, updatedAt: null, updatedBy: "owner" }]));
      return { ok: true, value: { docKey: "owner", userId: "owner", displayName: "Sam", ownerPersonConfirmed: scene !== "shared", pointer: scene ? { memoryHost: memoryHost.instanceId, label: memoryHost.label, setAt: "2026-11-03T00:00:00Z" } : null, sections } };
    },
    async putUserLayout(section, revision, data) {
      const e = doc.get(section) ?? { revision: 0, data: null };
      doc.set(section, e);
      if (revision !== e.revision) return { ok: false, error: { code: "layout_revision_conflict", message: "Changed", revision: e.revision } };
      e.revision++; e.data = structuredClone(data); changed(section, e.revision);
      return { ok: true, value: { revision: e.revision, updatedAt: "2026-11-03T00:00:00Z" } };
    },
    async putLayoutPointer(pointer) { return { ok: true, value: { memoryHost: pointer.instanceId, label: pointer.label, setAt: "2026-11-03T00:00:00Z" } }; },
  };
}

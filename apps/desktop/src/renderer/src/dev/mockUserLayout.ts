import type { DesktopApi } from "../../../shared/ipc";
import { emptySidebar } from "../lib/userLayoutModel";

export const MOCK_LAYOUT_INSTANCE = `ci-${"a".repeat(32)}`;
const scene = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("layoutMemory");
export function mockLayoutInstance(id: string): string {
  if (id === "local") return MOCK_LAYOUT_INSTANCE;
  return `ci-${[...id].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(32, "0").slice(0, 32)}`;
}
const memoryHost = { instanceId: scene === "missing" ? `ci-${"f".repeat(32)}` : MOCK_LAYOUT_INSTANCE, label: scene === "missing" ? "HOME-HOST" : "HOST-A" };
const views = new Map<string, { revision: number; data: Record<string, unknown> | null }>();
export function prepareMockLayout() {
  if (!scene) return;
  const confirmed = { ...emptySidebar(), sections: scene === "migration" ? [{ id: "remote-work", name: "Remote work", collapsed: false, members: [] }] : [] };
  localStorage.setItem("cutex-desktop.userLayout.v1", JSON.stringify({ memoryHost, hosts: { local: MOCK_LAYOUT_INSTANCE }, entries: scene === "migration" ? {} : { [memoryHost.instanceId]: { docKey: "owner", revision: 0, confirmed, operations: [], migratedAt: 1 } } }));
}
export function mockUserLayoutApi(id: string, changed: (section: string, revision: number) => void): Pick<DesktopApi, "userLayout" | "putUserLayout" | "putLayoutPointer"> {
  if (!views.has(id)) views.set(id, { revision: 0, data: scene === "migration" ? { ...emptySidebar(), sections: [{ id: "remote-work", name: "Remote work", collapsed: false, members: [] }] } : null });
  return {
    async userLayout(): ReturnType<DesktopApi["userLayout"]> {
      if (scene === "offline" && id === "local") throw new Error("Memory host offline (mock)");
      const e = views.get(id)!;
      return { ok: true, value: { docKey: "owner", userId: "owner", displayName: "Sam", ownerPersonConfirmed: scene !== "shared", pointer: scene ? { memoryHost: memoryHost.instanceId, label: memoryHost.label, setAt: "2026-11-03T00:00:00Z" } : null, sections: e.data ? { sidebar: { ...e, updatedAt: null, updatedBy: "owner" } } : {} } };
    },
    async putUserLayout(section, revision, data) {
      const e = views.get(id)!;
      if (revision !== e.revision) return { ok: false, error: { code: "layout_revision_conflict", message: "Changed", revision: e.revision } };
      e.revision++; e.data = structuredClone(data); changed(section, e.revision);
      return { ok: true, value: { revision: e.revision, updatedAt: "2026-11-03T00:00:00Z" } };
    },
    async putLayoutPointer(pointer) { return { ok: true, value: { memoryHost: pointer.instanceId, label: pointer.label, setAt: "2026-11-03T00:00:00Z" } }; },
  };
}

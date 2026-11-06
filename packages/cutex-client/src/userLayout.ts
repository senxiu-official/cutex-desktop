/** Personal layout, cutex `user-layout` (design 056 phase 1). Sections are opaque JSON. */
export const USER_LAYOUT_FEATURE = "user-layout";
export interface MemoryHost { instanceId: string; label: string }
export interface LayoutPointer { memoryHost: string; label: string; setAt: string }
export interface LayoutSection { revision: number; data: Record<string, unknown> | null; updatedAt: string | null; updatedBy: string | null }
export interface UserLayout { docKey: string; userId: string; displayName: string; ownerPersonConfirmed: boolean; pointer: LayoutPointer | null; sections: Record<string, LayoutSection> }
export interface LayoutWritten { revision: number; updatedAt: string | null }
export const isInstanceId = (v: unknown): v is string => typeof v === "string" && /^ci-[a-f0-9]{32}$/.test(v);
export function readMemoryHost(v: unknown): MemoryHost | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<MemoryHost>;
  return isInstanceId(r.instanceId) && typeof r.label === "string" && r.label.trim() && [...r.label].length <= 200 ? { instanceId: r.instanceId, label: r.label } : null;
}

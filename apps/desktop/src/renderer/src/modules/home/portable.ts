import type { HomeDoc } from "../../../../shared/home";
import type { LayoutHost } from "../../lib/userLayoutModel";

const LEGACY = "__deviceLayoutLegacyHostId";
type Ref = Record<string, unknown> & { hostId: string; host?: string };
function refs(doc: HomeDoc, transform: (ref: Ref, foreign: boolean) => Ref, foreign = false): HomeDoc {
  const pin = (v: unknown): unknown => {
    if (!v || typeof v !== "object") return v;
    const r = v as Record<string, unknown>;
    const next = { ...r, ...(Array.isArray(r.members) ? { members: r.members.map(pin) } : {}) };
    return typeof r.hostId === "string" && (typeof r.key === "string" || typeof r.sessionId === "string") ? transform(next as Ref, foreign) : next;
  };
  return { ...doc, ...(Array.isArray(doc.pins) ? { pins: doc.pins.map(pin) as HomeDoc["pins"] } : {}), ...(Array.isArray(doc.deskIcons) ? { deskIcons: doc.deskIcons.map(pin) } : {}) } as HomeDoc;
}
/** Foreign `local` is ambiguous. A portable host is always authoritative over legacy hostId. */
export function readPortableHome(doc: HomeDoc, hosts: readonly LayoutHost[]): HomeDoc {
  const local = hosts.find(h => h.id === "local")?.instanceId;
  let foreign = false;
  refs(doc, r => { if (r.host && r.host !== local) foreign = true; return r; });
  return refs(doc, r => {
    const legacy = typeof r[LEGACY] === "string" ? r[LEGACY] as string : r.hostId;
    const mapped = r.host ? hosts.find(h => h.instanceId === r.host) : hosts.find(h => h.id === legacy);
    const unknown = r.host ? !mapped : legacy === "local" && foreign;
    return { ...r, [LEGACY]: legacy, hostId: unknown ? `unknown:${r.host ?? "local"}` : mapped?.id ?? legacy,
      ...(!r.host && !unknown && mapped?.instanceId ? { host: mapped.instanceId } : {}) };
  }, foreign);
}
/** Strip device-only projection metadata; keep the original legacy id for older desktops. */
export function writePortableHome(doc: HomeDoc, hosts: readonly LayoutHost[]): HomeDoc {
  return refs(doc, r => {
    const { [LEGACY]: original, ...rest } = r;
    const host = typeof r.host === "string" ? r.host : hosts.find(h => h.id === r.hostId)?.instanceId;
    return { ...rest, hostId: typeof original === "string" ? original : r.hostId, ...(host ? { host } : {}) };
  });
}

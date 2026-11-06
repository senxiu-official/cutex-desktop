// Portable sidebar JSON and serialisable edits. Only this boundary translates device host keys.
import type { SidebarSection } from "./sidebarSections";
import { readFolderLookChoice, type FolderLookChoice } from "./folderLook";
import { hostKey, parseHostKey } from "./hostKeys";

export interface LayoutHost { id: string; instanceId?: string; label: string; online: boolean; supported: boolean; eligible: boolean; known?: boolean }
/** Main's host connection is authoritative. During a focus switch the renderer's top-level
 * daemon/capabilities may still describe the previous host; never assign that identity to `local`. */
export function describeLayoutHost(id: string, label: string, connection: { kind: string; instanceId?: string } | undefined,
  data: { daemon: { kind: string; instanceId?: string }; featuresKnown: boolean; features: ReadonlySet<string> } | null, eligible: boolean): LayoutHost {
  const online = connection?.kind === "connected";
  const instanceId = online ? connection.instanceId : undefined;
  const known = !!instanceId && data?.daemon.kind === "connected" && data.daemon.instanceId === instanceId && data.featuresKnown;
  return { id, label, instanceId, online, known: !!known, supported: !!known && data!.features.has("user-layout"), eligible };
}
export interface LayoutRef { host?: string; id: string; hostLabel?: string; localId?: string }
/** `look`: the owner's icon / colour (lib/folderLook). Builds before it keep it untouched (unknown keys survive their edits). */
export interface PortableSection { id: string; name: string; collapsed: boolean; members: LayoutRef[]; look?: FolderLookChoice; [key: string]: unknown }
export const LAYOUT_LISTS = ["starredProjects", "projectOrder", "foldedProjects", "pinned"] as const;
export type LayoutList = typeof LAYOUT_LISTS[number];
export interface SidebarLocal { sidebarSections: SidebarSection[]; starredProjects: string[]; projectOrder: string[]; foldedProjects: string[]; pinned: string[]; navPins: string[] | null }
export interface SidebarDoc extends Record<string, unknown> {
  sections: PortableSection[];
  starredProjects: LayoutRef[]; projectOrder: LayoutRef[]; foldedProjects: LayoutRef[]; pinned: LayoutRef[];
  navPins: string[] | null;
  tombstones: { id: string; del: true; t: number }[];
}
export const emptySidebar = (): SidebarDoc => ({ sections: [], starredProjects: [], projectOrder: [], foldedProjects: [], pinned: [], navPins: null, tombstones: [] });
export const refId = (r: LayoutRef): string => JSON.stringify([r.host ?? `unknown:${r.localId ?? ""}`, r.id]);
export function portableRef(key: string, hosts: readonly LayoutHost[], focus: string): LayoutRef {
  const [localId, id] = parseHostKey(key) ?? [focus, key];
  const h = hosts.find(h => h.id === localId);
  return h?.instanceId ? { host: h.instanceId, id } : { id, localId, hostLabel: h?.label ?? localId };
}
export function localRef(r: LayoutRef, hosts: readonly LayoutHost[]): string | null {
  // An unresolved old local id is never trusted on another device.
  const h = r.host ? hosts.find(h => h.instanceId === r.host) : null;
  return h ? hostKey(h.id, r.id) : null;
}
export function encodeSidebar(local: SidebarLocal, hosts: readonly LayoutHost[], focus: string): SidebarDoc {
  const ref = (k: string) => portableRef(k, hosts, focus);
  return { ...emptySidebar(), sections: local.sidebarSections.map(s => ({ ...s, members: s.members.map(ref) })),
    ...Object.fromEntries(LAYOUT_LISTS.map(k => [k, local[k].map(ref)])), navPins: local.navPins };
}
export function decodeSidebar(doc: SidebarDoc, hosts: readonly LayoutHost[]): SidebarLocal {
  const refs = (rs: LayoutRef[]) => rs.map(r => localRef(r, hosts)).filter((r): r is string => r !== null);
  return { sidebarSections: doc.sections.map(s => { const look = readFolderLookChoice(s.look); return { id: s.id, name: s.name, collapsed: s.collapsed, members: refs(s.members), ...(look && { look }) }; }),
    starredProjects: refs(doc.starredProjects), projectOrder: refs(doc.projectOrder), foldedProjects: refs(doc.foldedProjects), pinned: refs(doc.pinned), navPins: doc.navPins };
}
export function readSidebar(raw: Record<string, unknown> | null | undefined): SidebarDoc {
  const d = { ...emptySidebar(), ...raw };
  const refs = (v: unknown): LayoutRef[] => Array.isArray(v) ? v.filter((r): r is LayoutRef => !!r && typeof r === "object" && typeof r.id === "string" && (typeof r.host === "string" || typeof r.localId === "string")) : [];
  for (const k of LAYOUT_LISTS) d[k] = refs(d[k]);
  d.sections = Array.isArray(d.sections) ? d.sections.filter(s => s && typeof s.id === "string" && typeof s.name === "string").map(s => ({ ...s, collapsed: s.collapsed === true, members: refs(s.members) })) : [];
  d.navPins = Array.isArray(d.navPins) ? d.navPins.filter((v): v is string => typeof v === "string") : null;
  d.tombstones = Array.isArray(d.tombstones) ? d.tombstones.filter(t => t && typeof t.id === "string" && typeof t.t === "number" && t.del === true) : [];
  return d;
}
export type LayoutOp =
  | { kind: "import"; data: SidebarDoc; t: number }
  | { kind: "section"; id: string; value: Omit<PortableSection, "members"> | null; t: number; add?: boolean; knownMembers?: string[] }
  /** `look` null: back to automatic (the key is removed). */
  | { kind: "sectionField"; id: string; field: "name" | "collapsed" | "look"; value: string | boolean | FolderLookChoice | null; t: number }
  | { kind: "member"; ref: LayoutRef; to: string | null; before: string | null; t: number; visible?: string[] }
  | { kind: "list"; list: LayoutList; ref: LayoutRef; present: boolean; before: string | null; t: number; visible?: string[] }
  | { kind: "sectionOrder"; id: string; before: string | null; t: number }
  | { kind: "nav"; id: string; present: boolean; before: string | null; t: number }
  | { kind: "navDefault"; t: number };

function insert<T>(items: T[], value: T, id: (v: T) => string, before: string | null): T[] {
  const rest = items.filter(x => id(x) !== id(value));
  const at = before === null ? rest.length : rest.findIndex(x => id(x) === before);
  rest.splice(at < 0 ? rest.length : at, 0, value);
  return rest;
}
function anchored<T>(items: T[], value: T, id: (v: T) => string, before: string | null, visible?: string[]): T[] {
  if (!visible || !items.some(x => id(x) === id(value))) return insert(items, value, id, before);
  const known = new Set(visible);
  const reordered = insert(items.filter(x => known.has(id(x))), value, id, before);
  let at = 0;
  return items.map(x => known.has(id(x)) ? reordered[at++]! : x);
}
/** Replays one intent against the latest document, retaining unknown keys and hidden references. */
export function applyLayoutOp(base: SidebarDoc, op: LayoutOp): SidebarDoc {
  const recent = (d: SidebarDoc) => ({ ...d, tombstones: d.tombstones.filter(t => t.t >= op.t - 30 * 24 * 60 * 60 * 1000) });
  if (op.kind === "import") return recent(mergeSidebar(base, op.data));
  const d = readSidebar(base);
  const tombId = op.kind === "section" ? `section:${op.id}` : op.kind === "list" ? `${op.list}:${refId(op.ref)}` : op.kind === "member" ? `member:${refId(op.ref)}` : op.kind === "nav" ? `nav:${op.id}` : "";
  if (tombId && d.tombstones.some(t => t.id === tombId && t.t >= op.t)) return base;
  const remove = () => { d.tombstones = [...d.tombstones.filter(t => t.id !== tombId), { id: tombId, del: true, t: op.t }]; };
  switch (op.kind) {
    case "section":
      if (!op.value) {
        // A helper may drop a section after its last visible member is moved. Members this
        // device cannot see remain in their section, rather than disappearing with its header.
        const keep = d.sections.find(s => s.id === op.id)?.members.filter(r => !op.knownMembers?.includes(refId(r))) ?? [];
        if (op.knownMembers && keep.length) d.sections = d.sections.map(s => s.id === op.id ? { ...s, members: keep } : s);
        else { d.sections = d.sections.filter(s => s.id !== op.id); remove(); }
      }
      else if (!d.sections.some(s => s.id === op.id)) d.sections = [...d.sections, { ...op.value, id: op.id, name: String(op.value.name), collapsed: op.value.collapsed === true, members: [] }];
      break;
    case "sectionField": d.sections = d.sections.map(s => {
      if (s.id !== op.id) return s;
      if (op.value !== null) return { ...s, [op.field]: op.value };
      const { [op.field]: _gone, ...rest } = s;
      return rest as PortableSection;
    }); break;
    case "sectionOrder": {
      const s = d.sections.find(s => s.id === op.id);
      if (s) d.sections = insert(d.sections, s, s => s.id, op.before);
      break;
    }
    case "member": {
      if (op.to && !d.sections.some(s => s.id === op.to)) break;
      d.sections = d.sections.map(s => ({ ...s, members: s.id === op.to ? anchored(s.members, op.ref, refId, op.before, op.visible) : s.members.filter(r => refId(r) !== refId(op.ref)) }));
      if (!op.to) remove();
      break;
    }
    case "list": d[op.list] = op.present ? anchored(d[op.list], op.ref, refId, op.before, op.visible) : d[op.list].filter(r => refId(r) !== refId(op.ref)); if (!op.present) remove(); break;
    case "nav": d.navPins = op.present ? insert(d.navPins ?? [], op.id, s => s, op.before) : (d.navPins ?? []).filter(id => id !== op.id); if (!op.present) remove(); break;
    case "navDefault": d.navPins = null; break;
  }
  return recent(d);
}

/** Diff only the edited, visible entries. Each order change names its next visible neighbour. */
export function sidebarEdits(before: SidebarDoc, after: SidebarDoc, t = Date.now()): LayoutOp[] {
  const out: LayoutOp[] = [];
  for (const s of before.sections) if (!after.sections.some(n => n.id === s.id)) out.push({ kind: "section", id: s.id, value: null, knownMembers: s.members.map(refId), t });
  for (const s of after.sections) {
    const old = before.sections.find(n => n.id === s.id);
    if (!old) out.push({ kind: "section", id: s.id, value: { id: s.id, name: s.name, collapsed: s.collapsed, ...(s.look && { look: s.look }) }, add: true, t });
    else {
      for (const field of ["name", "collapsed"] as const) if (old[field] !== s[field]) out.push({ kind: "sectionField", id: s.id, field, value: s[field], t });
      if (JSON.stringify(readFolderLookChoice(old.look) ?? null) !== JSON.stringify(readFolderLookChoice(s.look) ?? null)) out.push({ kind: "sectionField", id: s.id, field: "look", value: readFolderLookChoice(s.look) ?? null, t });
    }
  }
  for (const [i, s] of [...after.sections.entries()].reverse()) {
    const old = before.sections.find(n => n.id === s.id);
    if (!old || before.sections[before.sections.indexOf(old) + 1]?.id !== after.sections[i + 1]?.id) out.push({ kind: "sectionOrder", id: s.id, before: after.sections[i + 1]?.id ?? null, t });
  }
  const members = new Map(before.sections.flatMap(s => s.members.map(r => [refId(r), { section: s.id, ref: r }] as const)));
  for (const s of after.sections) for (const [i, r] of [...s.members.entries()].reverse()) {
    const old = members.get(refId(r));
    const oldMembers = before.sections.find(s => s.id === old?.section)?.members ?? [];
    if (!old || old.section !== s.id || (oldMembers[oldMembers.findIndex(x => refId(x) === refId(r)) + 1] ? refId(oldMembers[oldMembers.findIndex(x => refId(x) === refId(r)) + 1]!) : null) !== (s.members[i + 1] ? refId(s.members[i + 1]!) : null)) out.push({ kind: "member", ref: r, to: s.id, before: s.members[i + 1] ? refId(s.members[i + 1]!) : null, visible: [...new Set([...oldMembers, ...s.members].map(refId))], t });
    members.delete(refId(r));
  }
  for (const { ref } of members.values()) out.push({ kind: "member", ref, to: null, before: null, t });
  for (const list of LAYOUT_LISTS) {
    for (const r of before[list]) if (!after[list].some(n => refId(n) === refId(r))) out.push({ kind: "list", list, ref: r, present: false, before: null, t });
    let working = before[list].filter(r => after[list].some(n => refId(n) === refId(r)));
    // Right to left ensures newly inserted neighbours exist before their predecessors replay.
    for (let i = after[list].length - 1; i >= 0; i--) {
      const r = after[list][i]!;
      const at = working.findIndex(n => refId(n) === refId(r));
      const next = after[list][i + 1];
      if (at < 0 || (working[at + 1] ? refId(working[at + 1]!) : null) !== (next ? refId(next) : null)) {
        out.push({ kind: "list", list, ref: r, present: true, before: next ? refId(next) : null, visible: [...new Set([...before[list], ...after[list]].map(refId))], t });
        working = insert(working, r, refId, next ? refId(next) : null);
      }
    }
  }
  if (JSON.stringify(before.navPins) !== JSON.stringify(after.navPins)) {
    if (after.navPins === null) out.push({ kind: "navDefault", t });
    else {
      for (const id of before.navPins ?? []) if (!after.navPins.includes(id)) out.push({ kind: "nav", id, present: false, before: null, t });
      for (let i = after.navPins.length - 1; i >= 0; i--) out.push({ kind: "nav", id: after.navPins[i]!, present: true, before: after.navPins[i + 1] ?? null, t });
    }
  }
  return out;
}
export function mergeSidebar(remote: SidebarDoc, local: SidebarDoc): SidebarDoc {
  const d = readSidebar({ ...local, ...remote });
  const tombstones = new Map<string, SidebarDoc["tombstones"][number]>();
  for (const t of [...remote.tombstones, ...local.tombstones]) if (!tombstones.has(t.id) || tombstones.get(t.id)!.t < t.t) tombstones.set(t.id, t);
  d.tombstones = [...tombstones.values()];
  for (const s of local.sections) {
    const match = d.sections.find(r => r.name === s.name);
    if (match) d.sections = d.sections.map(r => r.id === match.id ? { ...r, members: [...r.members, ...s.members.filter(m => !d.sections.some(n => n.members.some(v => refId(v) === refId(m))))] } : r);
    else d.sections.push({ ...s, members: s.members.filter(m => !d.sections.some(n => n.members.some(v => refId(v) === refId(m)))) });
  }
  for (const k of LAYOUT_LISTS) d[k] = [...d[k], ...local[k].filter(r => !d[k].some(n => refId(n) === refId(r)))];
  if (local.navPins) d.navPins = [...new Set([...(d.navPins ?? []), ...local.navPins])];
  return d;
}

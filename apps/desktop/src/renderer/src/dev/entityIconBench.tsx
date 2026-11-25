// Entity icon cost (dev only, delegation-e57707 / .claude/reports/entity-icons-perf-20261124.md): mounts N rows naming
// agents, projects or Profiles of the current mock host, with and without their icon, and times mount + layout and a
// scripted scroll. Loaded from the measuring script with `await import("/src/dev/entityIconBench.tsx")` on a preview
// started with `?rosterscale&entityscale&perf=quiet`.
import { createElement as h, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Avatar } from "../components/Avatar";
import { ProjectBadge } from "../components/ProjectBadge";
import { ProfileAvatar, type AvatarProfile } from "../components/ProfileAvatar";
import { projectIcon } from "../lib/projectIcons";
import { useProjectIcons } from "../lib/projectIconSync";
import { sidebarOf, useApp } from "../store";
import { apiFor } from "../bridge";

type Kind = "agent" | "project" | "profile";
type Item = { id: string; name: string; hostId: string; badge?: string; color?: string };

async function items(kind: Kind): Promise<{ items: Item[]; profiles: AvatarProfile[] }> {
  const s = useApp.getState();
  const hostId = s.hosts?.active ?? "";
  const sidebar = sidebarOf(s, hostId);
  if (kind === "agent") return { items: (sidebar?.active ?? []).map((a) => ({ id: a.cutexSessionId, name: a.displayName ?? a.cutexSessionId, hostId })), profiles: [] };
  if (kind === "project") return { items: (sidebar?.projects?.projects ?? []).map((p) => ({ id: p.project_id, name: p.presentation.display_name, hostId, badge: p.presentation.badge_label, color: p.presentation.color })), profiles: [] };
  const list = await apiFor(hostId).listProfiles();
  const profiles = (list?.profiles ?? []) as AvatarProfile[];
  return { items: profiles.map((p) => ({ id: p.id, name: p.name, hostId })), profiles };
}

function ProjectRowIcon({ item }: { item: Item }) {
  const icons = useProjectIcons();
  return h(ProjectBadge, { icon: projectIcon(icons, item.hostId, item.id), badge: item.badge ?? "?", color: item.color ?? "blue", size: "md" });
}

function Row({ kind, item, icon, profile }: { kind: Kind; item: Item; icon: boolean; profile?: AvatarProfile }): ReactNode {
  const glyph = !icon ? null
    : kind === "agent" ? h(Avatar, { name: item.name, seed: item.id, size: 18 })
    : kind === "project" ? h(ProjectRowIcon, { item })
    : profile ? h(ProfileAvatar, { profile, size: 18, host: item.hostId }) : null;
  return h("div", { className: "flex h-7 items-center gap-2 px-2 text-sm", "data-bench-row": "" }, glyph, h("span", { className: "truncate" }, item.name));
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;

/** Mount `rows` rows (cycling the host's items) `runs` times; median / P95 ms of render + layout, and DOM / image counts. */
export async function mountBench(kind: Kind, icon: boolean, rows: number, runs = 15) {
  const { items: list, profiles } = await items(kind);
  if (!list.length) throw new Error(`no ${kind}s`);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const times: number[] = [];
  let nodes = 0, images = 0;
  for (let r = 0; r < runs + 3; r++) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:360px;height:600px;overflow:auto;opacity:0.01;z-index:-1";
    document.body.append(host);
    const root = createRoot(host);
    const t0 = performance.now();
    flushSync(() => root.render(h("div", null, Array.from({ length: rows }, (_, i) => { const item = list[i % list.length]!; return h(Row, { key: i, kind, item, icon, profile: byId.get(item.id) }); }))));
    void host.getBoundingClientRect().height; // style + layout
    void (host.firstElementChild as HTMLElement).offsetHeight;
    const dt = performance.now() - t0;
    if (r >= 3) times.push(dt);
    nodes = host.querySelectorAll("*").length; images = host.querySelectorAll("img").length;
    root.unmount(); host.remove();
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return { kind, icon, rows, distinct: list.length, medianMs: +median(times).toFixed(2), p95Ms: +p95(times).toFixed(2), domNodes: nodes, images };
}

/** A non-virtualized list of `rows` rows scrolled top to bottom in `steps` frames: frame time median / P95 / max (ms). */
export async function scrollBench(kind: Kind, icon: boolean, rows: number, steps = 120) {
  const { items: list, profiles } = await items(kind);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:360px;height:600px;overflow:auto;z-index:99999;background:var(--bg)";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(h("div", null, Array.from({ length: rows }, (_, i) => { const item = list[i % list.length]!; return h(Row, { key: i, kind, item, icon, profile: byId.get(item.id) }); }))));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const max = host.scrollHeight - host.clientHeight;
  const frames: number[] = [];
  let last = performance.now();
  for (let i = 1; i <= steps; i++) {
    host.scrollTop = (max * i) / steps;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const now = performance.now(); frames.push(now - last); last = now;
  }
  root.unmount(); host.remove();
  return { kind, icon, rows, frameMedianMs: +median(frames).toFixed(2), frameP95Ms: +p95(frames).toFixed(2), frameMaxMs: +Math.max(...frames).toFixed(2) };
}

/** JS heap (Chromium `performance.memory`) after mounting `rows` rows and keeping them, minus before. */
export async function heapBench(kind: Kind, icon: boolean, rows: number) {
  const mem = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  const { items: list, profiles } = await items(kind);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  (globalThis as { gc?: () => void }).gc?.();
  const before = mem();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:360px;height:600px;overflow:auto;opacity:0.01;z-index:-1";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(h("div", null, Array.from({ length: rows }, (_, i) => { const item = list[i % list.length]!; return h(Row, { key: i, kind, item, icon, profile: byId.get(item.id) }); }))));
  await new Promise((resolve) => setTimeout(resolve, 500));
  (globalThis as { gc?: () => void }).gc?.();
  const after = mem();
  root.unmount(); host.remove();
  return { kind, icon, rows, heapKiB: Math.round((after - before) / 1024) };
}

/**
 * An agent picker as the app opens it (SearchablePickerBody over agentPickerOptions of every agent, archived included):
 * `text` strips the entities (before), `icon` keeps them (after: the first rows' icons mount with the list, the rest in
 * chunks over the next frames). Open = mount + layout (median / P95 ms); deferred = the React commits adding the rest
 * (sum, and the median run's largest single commit).
 */
export async function pickerBench(mode: "text" | "icon", runs = 12) {
  const [{ SearchablePickerBody }, { agentPickerOptions, sidebarPickerRows }, { Profiler }] = await Promise.all([
    import("../components/SearchablePicker"), import("../lib/agentPickerOptions"), import("react"),
  ]);
  const s = useApp.getState();
  const sidebar = sidebarOf(s, s.hosts?.active ?? "");
  const all = agentPickerOptions(sidebarPickerRows(sidebar, { include: "all" }), { top: "当前与最近", independent: "独立", archived: "已归档", chats: "快速对话" });
  const options = mode === "text" ? all.map(({ entity: _entity, ...o }) => o) : all;
  const open: number[] = [], deferred: number[] = [], deferredMax: number[] = [];
  let rows = 0, images = 0;
  for (let r = 0; r < runs + 3; r++) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:320px;max-height:600px;overflow:hidden;opacity:0.01;z-index:-1";
    document.body.append(host);
    const root = createRoot(host);
    const commits: { phase: string; ms: number }[] = [];
    const t0 = performance.now();
    flushSync(() => root.render(h(Profiler, { id: "picker", onRender: (_id: string, phase: string, actual: number) => commits.push({ phase, ms: actual }) }, h(SearchablePickerBody, { options, onPick: () => {}, placeholder: "", emptyLabel: "" }))));
    void host.getBoundingClientRect().height;
    const dt = performance.now() - t0;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const updates = commits.filter((c) => c.phase !== "mount").map((c) => c.ms);
    if (r >= 3) { open.push(dt); deferred.push(updates.reduce((a, ms) => a + ms, 0)); deferredMax.push(Math.max(0, ...updates)); }
    rows = host.querySelectorAll("[role=menuitem]").length; images = host.querySelectorAll("[data-entity-icon]").length;
    root.unmount(); host.remove();
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return { mode, options: options.length, rows, icons: images, openMedianMs: +median(open).toFixed(2), openP95Ms: +p95(open).toFixed(2), deferredMedianMs: +median(deferred).toFixed(2), deferredMaxCommitMs: +median(deferredMax).toFixed(2) };
}

/** The same picker kept open and its list scrolled top to bottom in `steps` frames: frame median / P95 / max (ms). */
export async function pickerScrollBench(mode: "text" | "icon", steps = 120) {
  const [{ SearchablePickerBody }, { agentPickerOptions, sidebarPickerRows }] = await Promise.all([import("../components/SearchablePicker"), import("../lib/agentPickerOptions")]);
  const s = useApp.getState();
  const all = agentPickerOptions(sidebarPickerRows(sidebarOf(s, s.hosts?.active ?? ""), { include: "all" }), { top: "当前与最近", independent: "独立", archived: "已归档", chats: "快速对话" });
  const options = mode === "text" ? all.map(({ entity: _entity, ...o }) => o) : all;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:320px;z-index:99999;background:var(--surface)";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(h(SearchablePickerBody, { options, onPick: () => {}, placeholder: "", emptyLabel: "" })));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const list = host.querySelector("[role=group] > div:last-child") as HTMLElement;
  const max = list.scrollHeight - list.clientHeight;
  const frames: number[] = [];
  let last = performance.now();
  for (let i = 1; i <= steps; i++) {
    list.scrollTop = (max * i) / steps;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const now = performance.now(); frames.push(now - last); last = now;
  }
  root.unmount(); host.remove();
  return { mode, scrollPx: max, frameMedianMs: +median(frames).toFixed(2), frameP95Ms: +p95(frames).toFixed(2), frameMaxMs: +Math.max(...frames).toFixed(2) };
}

/** Layout check of SearchableSelect triggers carrying an entity: a bare-class 「+ 添加」 trigger and the default one. */
export async function triggerProbe() {
  const { SearchableSelect } = await import("../components/SearchablePicker");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:20px;top:20px;z-index:99999;background:var(--surface);padding:12px;display:flex;flex-direction:column;gap:12px;align-items:flex-start";
  document.body.append(host);
  const opts = [{ value: "s1", label: "Alice", group: "g", entity: { kind: "agent" as const, id: "s1", name: "Alice" } }];
  const root = createRoot(host);
  flushSync(() => root.render(h("div", { style: { display: "flex", flexDirection: "column", gap: 12 } },
    h("span", { "data-t": "add" }, h(SearchableSelect, { value: "", options: opts, onChange() {}, label: "添加", triggerText: "+ 添加", placeholder: "", emptyLabel: "", triggerClassName: "press inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs text-accent hover:bg-hover" })),
    h("span", { "data-t": "sel" }, h(SearchableSelect, { value: "s1", options: opts, onChange() {}, label: "x", placeholder: "", emptyLabel: "" })))));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const box = (sel: string) => { const b = host.querySelector(`${sel} button`)!; const r = b.getBoundingClientRect(); const svg = b.querySelector("svg")!.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), chevronTop: Math.round(svg.top - r.top) }; };
  return { add: box("[data-t=add]"), sel: box("[data-t=sel]") };
}

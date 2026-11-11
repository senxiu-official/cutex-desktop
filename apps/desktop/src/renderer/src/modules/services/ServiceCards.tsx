// Dense, directly-organised service cards. Drag state is local and transient; only the
// owner fields on the service records (purpose, groupName and sortOrder) are persisted.
import { isImeComposing } from "../../lib/ime";
import { DROP_TINT, dropTint } from "../../lib/dropTint";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Star } from "lucide-react";
import type { ServicePatch, ServiceView } from "../../../../shared/ipc";
import { readServiceTile } from "../../../../shared/home";
import { apiFor } from "../../bridge";
import { openMenuFrom, type MenuEntry } from "../../lib/contextMenu";
import { openService } from "../../lib/services";
import { isWorker, serviceHealthKey } from "../../lib/serviceWorker";
import { WorkerBadge } from "../../components/WorkerBadge";
import { useI18n, type MessageKey } from "../../i18n";
import {
  isOrganizeUnsupported,
  organizedServiceSections,
  serviceOrganizationError,
  serviceSectionOrder,
  type OrganizedServiceGroup,
  type OrganizedServiceSection,
  type ServiceSection,
} from "./model";

export interface ServiceCardRow {
  hostId: string;
  key: string;
  item: ServiceView;
}

interface Props {
  rows: ServiceCardRow[];
  ownerName(row: ServiceCardRow): string;
  /** Tooltip of the card's owner line (a project service: project, Director and registrant). */
  ownerTitle?(row: ServiceCardRow): string | undefined;
  /** The host's name in messages (「这台主机需要升级…」). */
  hostName(row: ServiceCardRow): string;
  stale(row: ServiceCardRow): boolean;
  tileEnabled(row: ServiceCardRow): boolean;
  organizable(row: ServiceCardRow): boolean;
  menu(row: ServiceCardRow, organization: MenuEntry[]): MenuEntry[];
  /** The logs opened from a card's menu (shown under its group; a background service's main view). */
  logs?(row: ServiceCardRow): ReactNode;
  refresh(): Promise<void>;
  error(message: string): void;
}

type ServiceDrag = { kind: "service"; key: string };
type GroupDrag = { kind: "group"; section: ServiceSection; name: string };
type Dragged = ServiceDrag | GroupDrag;
type KeepTarget = { rowKey: string; section: ServiceSection; group: string; targetKey?: string; after: boolean };
type NewGroupTarget = { rowKey: string; section: ServiceSection };

const cloneSections = (sections: readonly OrganizedServiceSection<ServiceCardRow>[]) => sections.map((section) => ({
  section: section.section,
  groups: section.groups.map((group) => ({ ...group, rows: [...group.rows] })),
}));

function sectionOf(sections: OrganizedServiceSection<ServiceCardRow>[], section: ServiceSection) {
  let found = sections.find((candidate) => candidate.section === section);
  if (!found) {
    found = { section, groups: [] };
    sections.push(found);
    sections.sort((a, b) => serviceSectionOrder.indexOf(a.section) - serviceSectionOrder.indexOf(b.section));
  }
  return found;
}

function groupOf(section: OrganizedServiceSection<ServiceCardRow>, name: string) {
  let found = section.groups.find((candidate) => candidate.name === name);
  if (!found) {
    found = { key: `${section.section}\u0000${name}`, name, rows: [] };
    section.groups.push(found);
  }
  return found;
}

function CompactServiceCard({ row, ownerName, ownerTitle, stale, tileEnabled, canDrag, blocked, highlighted, menu, beginDrag, finishDrag, dragOver, drop, error }: {
  row: ServiceCardRow;
  ownerName: string;
  ownerTitle?: string;
  stale: boolean;
  tileEnabled: boolean;
  canDrag: boolean;
  /** Why it cannot be moved (an old or offline host): its tooltip; dragging it says so too. */
  blocked: string | null;
  highlighted: boolean;
  menu(): MenuEntry[];
  beginDrag(event: DragEvent<HTMLDivElement>): void;
  finishDrag(): void;
  dragOver(event: DragEvent<HTMLDivElement>): void;
  drop(event: DragEvent<HTMLDivElement>): void;
  error(message: string): void;
}) {
  const { t } = useI18n();
  const [tile, setTile] = useState<ReturnType<typeof readServiceTile>>(null);
  useEffect(() => {
    let active = true;
    if (row.item.archived || !tileEnabled) return;
    void apiFor(row.hostId).serviceTile(row.item.slug).then((answer) => active && setTile(readServiceTile(answer?.tile))).catch(() => {});
    return () => { active = false; };
  }, [row.hostId, row.item.slug, row.item.archived, tileEnabled]);
  const service = row.item;
  const title = tile?.title || service.displayName || service.slug;
  const worker = isWorker(service);
  const health = t(serviceHealthKey(service)) + (service.health === "stoppedIdle" && service.stoppedIdleAt ? ` · ${new Date(service.stoppedIdleAt).toLocaleString()}` : "");
  const cardRef = useRef<HTMLDivElement>(null);
  // A background service has no page: the card opens its menu (start / stop / restart / logs) instead.
  const open = () => {
    if (stale || service.archived) return;
    if (worker) { if (cardRef.current) openMenuFrom(cardRef.current, menu()); return; }
    void openService(service, row.hostId).catch((reason: unknown) => error(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <div
      ref={cardRef}
      role="button"
      data-service-worker={worker || undefined}
      tabIndex={stale || service.archived ? -1 : 0}
      draggable={canDrag}
      data-service-card={row.key}
      aria-label={`${title} · ${health} · ${ownerName}`}
      title={blocked ?? undefined}
      onDragStart={beginDrag}
      onDragEnd={finishDrag}
      onDragOver={dragOver}
      onDrop={drop}
      onClick={open}
      onKeyDown={(event) => { if (!isImeComposing(event) && event.key === "Enter") open(); }}
      className={`group relative min-h-16 min-w-0 rounded-lg border bg-surface-1 px-2.5 py-2 shadow-sm transition ${highlighted ? "border-accent ring-2 ring-accent/20" : "border-border"} ${stale || service.archived ? "opacity-60" : "cursor-pointer hover:border-accent/50 hover:bg-surface-2/40"}`}
    >
      <button type="button" aria-label={t("services.more")} onClick={(event) => { event.stopPropagation(); openMenuFrom(event.currentTarget, menu()); }} className="absolute top-1.5 right-1.5 rounded p-1 text-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-2 hover:text-foreground"><MoreHorizontal size={14} /></button>
      <div className="flex min-w-0 items-center gap-1.5 pr-6">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${service.health === "reachable" ? "bg-ok" : service.health === "starting" ? "bg-warn" : service.health === "crashLooped" ? "bg-danger" : "bg-subtle"}`} />
        <span className="truncate text-sm font-medium">{title}</span>
        {service.starred ? <Star size={12} className="shrink-0 fill-current text-warn-text" /> : null}
        {worker ? <WorkerBadge /> : null}
        {tile?.badge ? <span className="max-w-20 truncate rounded bg-accent/10 px-1 py-0.5 text-caption/[inherit] text-accent">{tile.badge}</span> : null}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-3.5 text-caption/[inherit] text-subtle"><span className="truncate" title={health}>{health}</span><span aria-hidden="true">·</span><span className="truncate" title={ownerTitle} data-service-scope={ownerTitle ? "project" : undefined}>{ownerName}</span></div>
    </div>
  );
}

export function ServiceCards({ rows, ownerName, ownerTitle, hostName, stale, tileEnabled, organizable, menu, logs, refresh, error }: Props) {
  const { t } = useI18n();
  const sections = useMemo(() => organizedServiceSections(rows), [rows]);
  const dragRef = useRef<Dragged | null>(null);
  const hintRef = useRef("");
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [dropHint, setDropHintState] = useState("");
  const tint = dropTint("var(--accent)", 5);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<NewGroupTarget | null>(null);
  const [pendingKeep, setPendingKeep] = useState<KeepTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const setDropHint = (next: string) => {
    if (hintRef.current === next) return;
    hintRef.current = next;
    setDropHintState(next);
  };
  const finishDrag = () => { dragRef.current = null; setDragged(null); setDropHint(""); };
  /** Why this card cannot be moved, or null: a host without the owner fields, or one that is not connected. */
  const blockedReason = (row: ServiceCardRow) => !organizable(row) ? t("services.organize.upgrade", { host: hostName(row) }) : stale(row) ? t("services.organize.offline", { host: hostName(row) }) : null;
  const beginService = (row: ServiceCardRow, event: DragEvent<HTMLDivElement>) => {
    const blocked = blockedReason(row);
    // Not silently: an old / offline host's card starts no drag and says why.
    if (blocked) { event.preventDefault(); error(blocked); return; }
    if (busy) { event.preventDefault(); return; }
    const value: ServiceDrag = { kind: "service", key: row.key };
    dragRef.current = value; setDragged(value);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-cutex-service", row.key);
  };
  const beginGroup = (section: ServiceSection, name: string, event: DragEvent<HTMLButtonElement>) => {
    if (busy || !name) { event.preventDefault(); return; }
    const value: GroupDrag = { kind: "group", section, name };
    dragRef.current = value; setDragged(value);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-cutex-service-group", `${section}\u0000${name}`);
  };

  const save = async (changes: Map<string, { row: ServiceCardRow; patch: ServicePatch }>) => {
    if (!changes.size) return;
    setBusy(true);
    try {
      const entries = [...changes.values()];
      const results = await Promise.allSettled(entries.map(({ row, patch }) => apiFor(row.hostId).patchService(row.item.slug, patch)));
      await refresh();
      const failed = results.findIndex((result) => result.status === "rejected");
      if (failed >= 0) {
        const reason = (results[failed] as PromiseRejectedResult).reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        error(isOrganizeUnsupported(message) ? t("services.organize.upgrade", { host: hostName(entries[failed]!.row) }) : message);
      }
    } catch (reason) {
      error(serviceOrganizationError(reason, t("services.organize.upgrade")));
    } finally {
      setBusy(false);
    }
  };
  const merge = (changes: Map<string, { row: ServiceCardRow; patch: ServicePatch }>, row: ServiceCardRow, patch: ServicePatch) => {
    const old = changes.get(row.key);
    changes.set(row.key, { row, patch: { ...(old?.patch ?? {}), ...patch } });
  };
  const orderSection = (changes: Map<string, { row: ServiceCardRow; patch: ServicePatch }>, section: OrganizedServiceSection<ServiceCardRow>) => {
    let index = 1;
    for (const group of section.groups) for (const row of group.rows) {
      const sortOrder = index++ * 100;
      if (blockedReason(row)) continue;
      if ((row.item.sortOrder ?? 0) !== sortOrder) merge(changes, row, { sortOrder });
    }
  };

  const moveService = async (rowKey: string, targetSection: ServiceSection, targetGroup: string, targetKey?: string, after = false, keep = false) => {
    const row = rows.find((candidate) => candidate.key === rowKey);
    if (!row || busy) return;
    const blocked = blockedReason(row);
    if (blocked) { error(blocked); return; }
    const persistent = row.item.lifetime === "persistent";
    if ((targetSection === "temporary" ? persistent : !persistent) && !keep) {
      setPendingKeep({ rowKey, section: targetSection, group: targetGroup, targetKey, after });
      finishDrag();
      return;
    }
    const next = cloneSections(sections);
    const source = next.find((candidate) => candidate.groups.some((group) => group.rows.some((candidateRow) => candidateRow.key === rowKey)));
    const sourceGroup = source?.groups.find((group) => group.rows.some((candidateRow) => candidateRow.key === rowKey));
    if (!source || !sourceGroup) return;
    sourceGroup.rows = sourceGroup.rows.filter((candidate) => candidate.key !== rowKey);
    source.groups = source.groups.filter((group) => group.rows.length > 0);
    const destination = sectionOf(next, targetSection);
    const group = groupOf(destination, targetGroup);
    const targetIndex = targetKey ? group.rows.findIndex((candidate) => candidate.key === targetKey) : -1;
    group.rows.splice(targetIndex < 0 ? group.rows.length : targetIndex + Number(after), 0, row);
    const changes = new Map<string, { row: ServiceCardRow; patch: ServicePatch }>();
    merge(changes, row, {
      groupName: targetGroup || null,
      ...(targetSection === "temporary" ? persistent ? { lifetime: "ephemeral", purpose: null } : {} : persistent
        ? { purpose: targetSection === "unknown" ? null : targetSection }
        : { lifetime: "persistent", purpose: targetSection === "unknown" ? null : targetSection }),
    });
    orderSection(changes, source);
    if (destination !== source) orderSection(changes, destination);
    await save(changes);
    setPendingKeep(null); setNewGroup(null); finishDrag();
  };

  const reorderGroup = async (sectionName: ServiceSection, sourceName: string, targetName: string, after = false) => {
    if (!sourceName || sourceName === targetName || busy) return;
    const next = cloneSections(sections);
    const section = next.find((candidate) => candidate.section === sectionName);
    if (!section) return;
    const sourceIndex = section.groups.findIndex((group) => group.name === sourceName);
    const targetIndex = section.groups.findIndex((group) => group.name === targetName);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [group] = section.groups.splice(sourceIndex, 1);
    const adjusted = section.groups.findIndex((candidate) => candidate.name === targetName);
    section.groups.splice(adjusted + Number(after), 0, group!);
    const changes = new Map<string, { row: ServiceCardRow; patch: ServicePatch }>();
    orderSection(changes, section);
    await save(changes);
    finishDrag();
  };

  const renameGroup = async (sectionName: ServiceSection, oldName: string, value: string) => {
    const name = value.trim();
    setRenaming(null);
    if (!name || name === oldName || busy) return;
    const group = sections.find((section) => section.section === sectionName)?.groups.find((candidate) => candidate.name === oldName);
    if (!group) return;
    const changes = new Map<string, { row: ServiceCardRow; patch: ServicePatch }>();
    for (const row of group.rows) if (!blockedReason(row)) merge(changes, row, { groupName: name });
    await save(changes);
  };

  const moveRowBy = (row: ServiceCardRow, delta: -1 | 1) => {
    const section = sections.find((candidate) => candidate.groups.some((group) => group.rows.some((entry) => entry.key === row.key)));
    const group = section?.groups.find((candidate) => candidate.rows.some((entry) => entry.key === row.key));
    if (!section || !group) return;
    const index = group.rows.findIndex((entry) => entry.key === row.key);
    const target = group.rows[index + delta];
    if (target) void moveService(row.key, section.section, group.name, target.key, delta > 0);
  };

  const startNewGroup = (rowKey: string, section: ServiceSection) => { setNewGroup({ rowKey, section }); setPendingKeep(null); };
  const organizationEntries = (row: ServiceCardRow): MenuEntry[] => {
    const blocked = blockedReason(row);
    if (blocked) return [{ label: blocked, disabled: true, onSelect: () => {} }];
    const currentSection = sections.find((section) => section.groups.some((group) => group.rows.some((candidate) => candidate.key === row.key)));
    const currentGroup = currentSection?.groups.find((group) => group.rows.some((candidate) => candidate.key === row.key));
    const index = currentGroup?.rows.findIndex((candidate) => candidate.key === row.key) ?? -1;
    const allowed = serviceSectionOrder;
    const targets: MenuEntry[] = allowed.flatMap((sectionName) => {
      const section = sections.find((candidate) => candidate.section === sectionName);
      return [
        { label: t("services.move.section", { section: t(`services.purpose.${sectionName}` as MessageKey) }), onSelect: () => void moveService(row.key, sectionName, "") },
        ...(section?.groups.filter((group) => !!group.name).map((group) => ({ label: t("services.move.group", { section: t(`services.purpose.${sectionName}` as MessageKey), group: group.name }), onSelect: () => void moveService(row.key, sectionName, group.name) })) ?? []),
        { label: t("services.group.newIn", { section: t(`services.purpose.${sectionName}` as MessageKey) }), onSelect: () => startNewGroup(row.key, sectionName) },
      ];
    });
    return [
      { label: t("services.move.up"), disabled: index <= 0, onSelect: () => moveRowBy(row, -1) },
      { label: t("services.move.down"), disabled: !currentGroup || index < 0 || index >= currentGroup.rows.length - 1, onSelect: () => moveRowBy(row, 1) },
      { label: t("services.move.to"), submenu: targets, onSelect: () => {} },
    ];
  };

  const visibleSections = serviceSectionOrder.filter((sectionName) => sections.some((section) => section.section === sectionName) || dragged?.kind === "service");
  return (
    <div className="space-y-4" data-service-cards="dense-direct">
      {rows.some((row) => !organizable(row)) && <p role="status" className="text-xs text-muted">{t("services.organize.upgrade", { host: hostName(rows.find((row) => !organizable(row))!) })}</p>}
      {pendingKeep ? <div data-service-lifetime-confirm="" role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs"><span className="mr-auto">{pendingKeep.section === "temporary" ? t("services.temporary.confirm") : t("services.keep.confirm", { section: t(`services.purpose.${pendingKeep.section}`) })}</span><button type="button" disabled={busy} onClick={() => void moveService(pendingKeep.rowKey, pendingKeep.section, pendingKeep.group, pendingKeep.targetKey, pendingKeep.after, true)} className="rounded bg-accent px-2 py-1 text-accent-foreground">{t(pendingKeep.section === "temporary" ? "services.temporary.confirmAction" : "services.keep.confirmAction")}</button><button type="button" disabled={busy} onClick={() => setPendingKeep(null)} className="rounded border border-border px-2 py-1">{t("dialog.cancel")}</button></div> : null}
      {visibleSections.map((sectionName) => {
        const section = sections.find((candidate) => candidate.section === sectionName) ?? { section: sectionName, groups: [] };
        const sectionHint = `section:${sectionName}`;
        return <section key={sectionName} data-service-section={sectionName} className={`rounded-xl border px-3 py-2 ${dropHint === sectionHint ? `border-accent ${DROP_TINT}` : "border-transparent"}`} style={dropHint === sectionHint ? tint : undefined} onDragOver={(event) => { if (dragRef.current?.kind === "service") { event.preventDefault(); setDropHint(sectionHint); } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const drag = dragRef.current; if (drag?.kind === "service") void moveService(drag.key, sectionName, ""); }}>
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted"><span>{t(`services.purpose.${sectionName}` as MessageKey)}</span><span className="font-normal text-subtle">{section.groups.reduce((count, group) => count + group.rows.length, 0)}</span><span className="font-normal text-subtle">{t("services.drop.section")}</span></h2>
          <div className="space-y-3">
            {section.groups.map((group, groupIndex) => {
              const folded = collapsed.has(group.key);
              const groupHint = `group:${group.key}`;
              return <div key={group.key} data-service-group={group.name} className={`rounded-lg ${dropHint === groupHint ? "ring-2 ring-accent/30" : ""}`} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDropHint(groupHint); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const drag = dragRef.current; if (drag?.kind === "service") void moveService(drag.key, sectionName, group.name); else if (drag?.kind === "group" && drag.section === sectionName) void reorderGroup(sectionName, drag.name, group.name, event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2); }}>
                <div tabIndex={0} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if (isImeComposing(event)) return; if (event.key === "F2" && group.name) { event.preventDefault(); setRenaming(group.key); } else if (event.altKey && event.key === "ArrowUp" && group.name && groupIndex > 0) { event.preventDefault(); void reorderGroup(sectionName, group.name, section.groups[groupIndex - 1]!.name); } else if (event.altKey && event.key === "ArrowDown" && group.name && groupIndex < section.groups.length - 1) { event.preventDefault(); void reorderGroup(sectionName, group.name, section.groups[groupIndex + 1]!.name, true); } }} onClick={() => setCollapsed((old) => { const next = new Set(old); if (!next.delete(group.key)) next.add(group.key); return next; })} className="mb-1 flex min-h-7 items-center gap-1 rounded px-1 text-xs text-muted hover:bg-surface-2/60">
                  <span aria-hidden="true">{folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</span>
                  {group.name ? <button type="button" onClick={(event) => { event.stopPropagation(); setRenaming(group.key); }} className="min-w-0 truncate font-medium hover:underline">{group.name}</button> : <span className="font-medium">{t("services.group.ungrouped")}</span>}
                  <span className="text-subtle">{group.rows.length}</span>
                  {group.name ? <button type="button" draggable disabled={busy} aria-label={t("services.group.drag", { name: group.name })} onClick={(event) => event.stopPropagation()} onDragStart={(event) => beginGroup(sectionName, group.name, event)} onDragEnd={finishDrag} className="ml-auto cursor-grab rounded p-1 text-subtle hover:bg-surface-2 active:cursor-grabbing"><GripVertical size={13} /></button> : null}
                </div>
                {renaming === group.key ? <form className="mb-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (isImeComposing(event)) return; const input = new FormData(event.currentTarget).get("name"); void renameGroup(sectionName, group.name, typeof input === "string" ? input : ""); }}><input name="name" autoFocus defaultValue={group.name} maxLength={80} onKeyDown={(event) => { if (!isImeComposing(event) && event.key === "Escape") setRenaming(null); }} onBlur={(event) => { if (!isImeComposing(event)) setRenaming(null); }} className="min-w-0 flex-1 rounded border border-accent bg-background px-2 py-1 text-xs outline-none" /><span className="self-center text-caption/[inherit] text-subtle">{t("services.group.renameHint")}</span></form> : null}
                {!folded ? <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">{group.rows.map((row) => <CompactServiceCard key={row.key} row={row} ownerName={ownerName(row)} ownerTitle={ownerTitle?.(row)} stale={stale(row)} tileEnabled={tileEnabled(row)} canDrag={!busy} blocked={blockedReason(row)} highlighted={dropHint.startsWith(`card:${row.key}:`)} menu={() => menu(row, organizationEntries(row))} beginDrag={(event) => beginService(row, event)} finishDrag={finishDrag} dragOver={(event) => { const drag = dragRef.current; if (drag?.kind !== "service" || drag.key === row.key) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; const rect = event.currentTarget.getBoundingClientRect(); const after = event.clientY > rect.top + rect.height / 2 || (Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height / 4 && event.clientX > rect.left + rect.width / 2); setDropHint(`card:${row.key}:${after ? "after" : "before"}`); }} drop={(event) => { event.preventDefault(); event.stopPropagation(); const drag = dragRef.current; if (drag?.kind !== "service" || drag.key === row.key) return; const after = dropHint === `card:${row.key}:after`; void moveService(drag.key, sectionName, group.name, row.key, after); }} error={error} />)}</div> : null}
                {!folded && logs ? group.rows.map((row) => { const body = logs(row); return body ? <div key={`logs:${row.key}`} data-service-card-logs={row.key} className="mt-2 rounded-lg border border-border bg-surface-1 px-2.5 py-2"><div className="mb-1 truncate text-xs font-medium text-muted">{row.item.displayName || row.item.slug}</div>{body}</div> : null; }) : null}
              </div>;
            })}
            <div className={`rounded-lg border border-dashed px-2 py-1.5 text-xs ${dropHint === `new:${sectionName}` ? `border-accent text-accent ${DROP_TINT}` : "border-border text-subtle"}`} style={dropHint === `new:${sectionName}` ? tint : undefined} onDragOver={(event) => { if (dragRef.current?.kind === "service") { event.preventDefault(); event.stopPropagation(); setDropHint(`new:${sectionName}`); } }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const drag = dragRef.current; if (drag?.kind === "service") startNewGroup(drag.key, sectionName); }}>{newGroup?.section === sectionName ? <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (isImeComposing(event)) return; const name = new FormData(event.currentTarget).get("name"); if (typeof name === "string" && name.trim()) { const target = newGroup; setNewGroup(null); void moveService(target.rowKey, sectionName, name.trim()); } }}><input name="name" autoFocus maxLength={80} placeholder={t("services.group.namePlaceholder")} onKeyDown={(event) => { if (!isImeComposing(event) && event.key === "Escape") setNewGroup(null); }} className="min-w-0 flex-1 rounded border border-accent bg-background px-2 py-1 text-foreground outline-none" /><button type="submit" className="rounded bg-accent px-2 py-1 text-accent-foreground">{t("services.group.create")}</button></form> : <span>＋ {t("services.group.new")}</span>}</div>
          </div>
        </section>;
      })}
    </div>
  );
}

// Settings → 主机 → 分组 (multi-host P2, RFC §7.5): create / rename / recolor / reorder / delete host
// groups and edit their members. Every edit sends the whole list (`saveHostGroups`, main validates
// with the same shared rules; lib/hostGroups checks first so errors show inline). Not folded (owner
// rule): one row per group, in switcher order.
import { useState } from "react";
import { ArrowDown, ArrowUp, Layers } from "lucide-react";
import { HOST_PALETTE, sameScope, type HostGroup, type HostGroupError } from "../../../../shared/hosts";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, ARMED_FRAME, useArmed } from "../../lib/armedConfirm";
import { applyGroupEdit, checkGroupDrafts, freeGroupName, type GroupEdit } from "../../lib/hostGroups";
import type { HostLook } from "../../lib/hostScope";
import { settingsAnchorId } from "../../lib/settingsNav";
import { saveHostGroups, setViewScope, useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { HostDot } from "../HostMark";
import { Button, Section, TextInput } from "./Form";

/** DOM id of a group's row (host card tags scroll here). */
export const hostGroupRowId = (groupId: string) => `${settingsAnchorId("hostGroups")}-${groupId}`;

const RING = "ring-2 ring-foreground ring-offset-2 ring-offset-surface";

/** Palette swatches + a custom color; `onNone` adds a "no color" swatch first. */
export function SwatchPicker({ value, onChange, onNone, label, customLabel, noneLabel }: { value: string | null; onChange(color: string): void; onNone?(): void; label: string; customLabel: string; noneLabel?: string }) {
  const current = value?.toLowerCase() ?? null;
  const custom = current !== null && !(HOST_PALETTE as readonly string[]).includes(current);
  return (
    <span className="flex items-center gap-1.5">
      {onNone && <button type="button" onClick={onNone} title={noneLabel} aria-label={noneLabel} aria-pressed={current === null} className={`h-4 w-4 rounded-full border border-subtle bg-[linear-gradient(135deg,transparent_45%,var(--color-subtle)_45%,var(--color-subtle)_55%,transparent_55%)] ${current === null ? RING : ""}`} />}
      {HOST_PALETTE.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} aria-label={`${label} ${c}`} aria-pressed={current === c} className={`h-4 w-4 rounded-full ${current === c ? RING : ""}`} style={{ background: c }} />
      ))}
      <label title={customLabel} className={`relative h-4 w-4 cursor-pointer overflow-hidden rounded-full border border-dashed border-subtle ${custom ? RING : ""}`} style={custom ? { background: current! } : undefined}>
        <input type="color" aria-label={customLabel} value={current ?? "#888888"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
    </span>
  );
}

/** Member toggles: one chip per host (dot + name), pressed = member. */
function MemberChips({ hosts, members, onToggle }: { hosts: readonly HostLook[]; members: readonly string[]; onToggle(hostId: string): void }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {hosts.map((h) => {
        const on = members.includes(h.id);
        return (
          <button
            key={h.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(h.id)}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${on ? "border-accent/60 bg-accent/10 text-foreground" : "border-border text-subtle hover:text-foreground"}`}
          >
            <HostDot color={h.color} status={h.indicator.status} size={7} />
            <span className="max-w-32 truncate">{h.label}</span>
          </button>
        );
      })}
    </span>
  );
}

function useGroupEdits() {
  const hostsState = useApp((s) => s.hosts);
  const scope = useHostScope();
  const groups = hostsState?.groups ?? [];
  const hostIds = scope.hosts.map((h) => h.id);
  /** Apply an edit: null = sent (or nothing to do), else the inline error. */
  const apply = async (edit: GroupEdit): Promise<{ error: HostGroupError; index: number } | null> => {
    const drafts = applyGroupEdit(groups, edit, hostIds);
    const check = checkGroupDrafts(drafts, hostIds);
    if (!check.ok) return check;
    await saveHostGroups(drafts);
    return null;
  };
  return { groups, scope, apply };
}

function GroupRow({ group, index, count, apply }: { group: HostGroup; index: number; count: number; apply(edit: GroupEdit): Promise<{ error: HostGroupError; index: number } | null> }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<HostGroupError | null>(null);
  const [armed, setArmed] = useArmed(group.id);
  const shown = sameScope(scope.scope, { kind: "group", id: group.id });
  const known = group.hosts.filter((id) => scope.host(id));
  const run = async (edit: GroupEdit) => {
    const r = await apply(edit);
    setError(r && r.index === index ? r.error : null);
    return r;
  };
  const commitName = async () => {
    if (name.trim() === group.name) return setName(group.name);
    await run({ kind: "rename", id: group.id, name });
  };
  return (
    <div id={hostGroupRowId(group.id)} className={`-mx-4 scroll-mt-4 border-b border-border px-4 py-3 last:border-b-0 ${armed ? ARMED_FRAME : ""}`}>
      <div className="flex items-center gap-2">
        <Layers size={14} className="shrink-0 text-muted" style={group.color ? { color: group.color } : undefined} />
        <TextInput
          width="w-48"
          value={name}
          label={t("hostGroups.name")}
          maxLength={64}
          onChange={(v) => {
            setName(v);
            setError(null);
          }}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commitName();
            else if (e.key === "Escape") {
              setName(group.name);
              setError(null);
            }
          }}
        />
        {shown && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("host.active")}</span>}
        {known.length === 0 && <span className="text-[11px] text-subtle">{t("hostGroups.noMembers")}</span>}
        <span className="flex-1" />
        {armed ? (
          <>
            <span className="text-xs text-danger">{t("hostGroups.deleteArmed")}</span>
            <button className={ARMED_FORM_BUTTON} onClick={() => void run({ kind: "delete", id: group.id })}>
              {t("hostGroups.delete")}
            </button>
          </>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" title={t("hostGroups.moveUp")} aria-label={t("hostGroups.moveUp")} disabled={index === 0} onClick={() => void run({ kind: "move", id: group.id, delta: -1 })} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-30">
              <ArrowUp size={13} />
            </button>
            <button type="button" title={t("hostGroups.moveDown")} aria-label={t("hostGroups.moveDown")} disabled={index === count - 1} onClick={() => void run({ kind: "move", id: group.id, delta: 1 })} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-30">
              <ArrowDown size={13} />
            </button>
            <Button onClick={() => setArmed(true)}>{t("hostGroups.delete")}</Button>
            {!shown && (
              <Button primary disabled={known.length === 0} onClick={() => void setViewScope({ kind: "group", id: group.id })}>
                {t("hostGroups.show")}
              </Button>
            )}
          </div>
        )}
      </div>
      {error && <div className="mt-1 pl-6 text-xs text-danger">{t(`hostGroups.error.${error}` as MessageKey)}</div>}
      <div className="mt-2 flex flex-col gap-2 pl-6 text-xs text-muted">
        <span className="flex items-start gap-2">
          <span className="shrink-0 pt-0.5">{t("hostGroups.members")}</span>
          <MemberChips hosts={scope.hosts} members={group.hosts} onToggle={(hostId) => void run({ kind: "toggleMember", id: group.id, hostId })} />
        </span>
        <span className="flex items-center gap-2">
          {t("hostGroups.color")}
          <SwatchPicker
            value={group.color ?? null}
            label={t("hostGroups.color")}
            customLabel={t("host.colorCustom")}
            noneLabel={t("hostGroups.colorNone")}
            onNone={() => void run({ kind: "recolor", id: group.id, color: null })}
            onChange={(color) => void run({ kind: "recolor", id: group.id, color })}
          />
        </span>
      </div>
    </div>
  );
}

function NewGroupForm({ groups, apply, onDone }: { groups: readonly HostGroup[]; apply(edit: GroupEdit): Promise<{ error: HostGroupError; index: number } | null>; onDone(): void }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const [name, setName] = useState(() => freeGroupName(groups, t("hostGroups.defaultName")));
  const [members, setMembers] = useState<string[]>([]);
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<HostGroupError | null>(null);
  const create = async () => {
    const r = await apply({ kind: "create", name, hosts: members, color });
    if (r) setError(r.error);
    else onDone();
  };
  return (
    <div className="-mx-4 border-b border-border bg-surface-2/40 px-4 py-3">
      <div className="flex items-center gap-2">
        <Layers size={14} className="shrink-0 text-muted" style={color ? { color } : undefined} />
        <TextInput
          width="w-48"
          autoFocus
          value={name}
          label={t("hostGroups.name")}
          maxLength={64}
          onChange={(v) => {
            setName(v);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
            else if (e.key === "Escape") onDone();
          }}
        />
        <span className="flex-1" />
        <Button onClick={onDone}>{t("dialog.cancel")}</Button>
        <Button primary disabled={!name.trim()} onClick={() => void create()}>
          {t("hostGroups.create")}
        </Button>
      </div>
      {error && <div className="mt-1 pl-6 text-xs text-danger">{t(`hostGroups.error.${error}` as MessageKey)}</div>}
      <div className="mt-2 flex flex-col gap-2 pl-6 text-xs text-muted">
        <span className="flex items-start gap-2">
          <span className="shrink-0 pt-0.5">{t("hostGroups.members")}</span>
          <MemberChips hosts={scope.hosts} members={members} onToggle={(id) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))} />
        </span>
        <span className="flex items-center gap-2">
          {t("hostGroups.color")}
          <SwatchPicker value={color} label={t("hostGroups.color")} customLabel={t("host.colorCustom")} noneLabel={t("hostGroups.colorNone")} onNone={() => setColor(null)} onChange={setColor} />
        </span>
      </div>
    </div>
  );
}

export function HostGroupsSection() {
  const { t } = useI18n();
  const { groups, apply } = useGroupEdits();
  const [adding, setAdding] = useState(false);
  return (
    <Section
      id={settingsAnchorId("hostGroups")}
      title={t("hostGroups.title")}
      hint={t("hostGroups.hint")}
      actions={
        <Button disabled={adding} onClick={() => setAdding(true)}>
          {t("hostGroups.new")}
        </Button>
      }
    >
      {adding && <NewGroupForm groups={groups} apply={apply} onDone={() => setAdding(false)} />}
      {groups.map((g, i) => (
        // Keyed by id + name: a rename from elsewhere resets the row's draft name.
        <GroupRow key={`${g.id}:${g.name}`} group={g} index={i} count={groups.length} apply={apply} />
      ))}
      {groups.length === 0 && !adding && <p className="py-2 text-xs text-subtle">{t("hostGroups.empty")}</p>}
    </Section>
  );
}

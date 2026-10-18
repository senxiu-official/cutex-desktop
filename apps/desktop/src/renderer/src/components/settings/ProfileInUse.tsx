// Settings → Profile → 删除 refused with `profile_in_use`, in the overview card. cutex counts every
// agent configured on the profile or launched on it, archived ones included (lib/profileRefs). One
// row per agent: 打开 (in use) / 查看历史 (archived; the archive page's path) and a click-twice
// permanent delete; two or more archived: delete them all at once. Agents the desktop doesn't list
// can't be opened, only deleted. A deleted row goes away; when none are left the card offers 删除
// right here (no auto-retry). cutex `profile-delete-detach-archived`: archived agents don't have to
// be deleted (one in a project can't be) — when only archived ones are left, 改用默认 Profile 并删除
// deletes the profile with ?archived=detach (cutex clears their profile; a restore uses the default).
import { useState } from "react";
import type { CutexRefusal } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { deleteAgentResult, SESSION_FEATURES } from "../../lib/menus";
import { refusalText } from "../../lib/profileCreate";
import { bulkArchivedRefs, canDetachArchived, PROFILE_DETACH_ARCHIVED_FEATURE, profileInUseCount, profileInUseMessage, profileRefs, type DeleteProfileOptions, type ProfileRef } from "../../lib/profileRefs";
import { Avatar } from "../Avatar";
import { ArmedRemove, Button, ListRow } from "./Form";
import { useTargetFeatures, useTargetHostId, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";

const without = <V,>(record: Record<string, V>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export function ProfileInUse({ refusal, color, profile, onDeleteProfile }: { refusal: CutexRefusal; color?: string | null; profile: string; onDeleteProfile(options?: DeleteProfileOptions): Promise<void> }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  // The profile's host (the settings host): its agents are deleted there.
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const canDelete = features.has(SESSION_FEATURES.delete);
  const canDetach = features.has(PROFILE_DETACH_ARCHIVED_FEATURE);
  // Per refusal (a new delete attempt starts over): deleted here, per-row refusals, rows in flight.
  const [shownFor, setShownFor] = useState(refusal);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  if (shownFor !== refusal) {
    setShownFor(refusal);
    setGone(new Set());
    setErrors({});
  }
  if (!refusal.sessions) return <p className="text-danger">{refusalText(refusal, t)}</p>;
  const refs = profileRefs(refusal.sessions, sidebar, gone);
  const bulk = bulkArchivedRefs(refs, canDelete);

  const remove = async (ref: ProfileRef) => {
    setBusy((b) => new Set(b).add(ref.id));
    setErrors((e) => without(e, ref.id));
    try {
      const result = await deleteAgentResult({ cutexSessionId: ref.id, displayName: ref.name }, t, ref.session?.revision, hostId);
      if (result?.ok) setGone((g) => new Set(g).add(ref.id));
      else if (result) setErrors((e) => ({ ...e, [ref.id]: refusalText(result.error, t) }));
    } catch (e) {
      setErrors((prev) => ({ ...prev, [ref.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(ref.id);
        return next;
      });
    }
  };
  const removeAll = async () => {
    for (const ref of bulk) await remove(ref);
  };

  if (refs.length === 0)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-accent">{t(profileInUseMessage(refs, canDelete))}</p>
        <ArmedButton label={t("settings.profile.refs.deleteNow", { name: profile })} armedLabel={t("settings.profile.refs.deleteNowArmed", { name: profile })} disabled={busy.size > 0} onConfirm={() => onDeleteProfile()} />
      </div>
    );
  const detach = canDetachArchived(refs, canDetach);
  return (
    <div>
      <p className="mb-1 text-danger">{t(profileInUseMessage(refs, canDelete, canDetach), { n: profileInUseCount(refs, canDetach) })}</p>
      {refs.map((ref) => (
        <RefRow key={ref.id} entry={ref} color={color} canDelete={canDelete} busy={busy.has(ref.id)} error={errors[ref.id]} onDelete={() => void remove(ref)} />
      ))}
      {(bulk.length > 0 || detach) && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {bulk.length > 0 && <BulkDelete n={bulk.length} disabled={busy.size > 0} onConfirm={() => void removeAll()} />}
          {detach && (
            <ArmedButton
              label={t("settings.profile.refs.detachDelete", { name: profile })}
              armedLabel={t("settings.profile.refs.detachDeleteArmed", { name: profile })}
              title={t("settings.profile.refs.detachHint")}
              disabled={busy.size > 0}
              onConfirm={() => onDeleteProfile({ archived: "detach" })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Deletes the profile itself (click twice); disabled while it runs. */
function ArmedButton({ label, armedLabel, title, disabled, onConfirm }: { label: string; armedLabel: string; title?: string; disabled: boolean; onConfirm(): Promise<void> }) {
  const [armed, setArmed] = useArmed();
  const [running, setRunning] = useState(false);
  return armed ? (
    <button disabled={disabled || running} onClick={() => (setRunning(true), void onConfirm().finally(() => (setRunning(false), setArmed(false))))} className={ARMED_FORM_BUTTON}>
      {armedLabel}
    </button>
  ) : (
    <Button disabled={disabled || running} title={title} onClick={() => setArmed(true)}>
      {label}
    </Button>
  );
}

function RefRow({ entry, color, canDelete, busy, error, onDelete }: { entry: ProfileRef; color?: string | null; canDelete: boolean; busy: boolean; error?: string; onDelete(): void }) {
  const { t } = useI18n();
  const select = useTargetSelect();
  const tag = entry.archived ? t("settings.profile.refs.tagArchived") : t("settings.profile.refs.tagActive");
  return (
    <ListRow
      leading={<Avatar name={entry.name} avatar={entry.session?.avatar} seed={entry.id} color={color} size={20} minor />}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{entry.name}</span>
          <span className={`shrink-0 rounded px-1.5 text-[11px] leading-4 ${entry.archived ? "bg-surface-2 text-subtle" : "bg-accent/15 text-accent"}`}>{tag}</span>
        </span>
      }
      detail={entry.session ? undefined : t("settings.profile.refs.unlisted")}
      actions={
        <>
          {/* Only agents the desktop lists: select() of any other id opens an empty conversation. */}
          {entry.session && (
            <Button disabled={busy} onClick={() => void select(entry.id)}>
              {entry.archived ? t("settings.profile.refs.history") : t("settings.profile.refs.open")}
            </Button>
          )}
          {canDelete && <ArmedRemove title={t("settings.profile.refs.delete")} armedLabel={t("settings.profile.refs.deleteArmed")} disabled={busy} onRemove={onDelete} />}
        </>
      }
      below={error ? <p className="mt-1 text-xs text-danger">{error}</p> : undefined}
    />
  );
}

/** 删除这 N 个已归档的, click twice. */
function BulkDelete({ n, disabled, onConfirm }: { n: number; disabled: boolean; onConfirm(): void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  return armed ? (
    <button disabled={disabled} onClick={() => (setArmed(false), onConfirm())} className={ARMED_FORM_BUTTON}>
      {t("settings.profile.refs.deleteArchivedArmed", { n })}
    </button>
  ) : (
    <Button disabled={disabled} onClick={() => setArmed(true)}>
      {t("settings.profile.refs.deleteArchived", { n })}
    </Button>
  );
}

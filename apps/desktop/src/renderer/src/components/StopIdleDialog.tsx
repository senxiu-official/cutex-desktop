import { isImeComposing } from "../lib/ime";
// 下线空闲的智能体 (design 031, refined owner 2026-10-25): one dialog for any scope — the entry decides the first
// (所有项目 / a project / 独立), the dropdown changes it. cutex lists every online agent of the scope; the idle time
// only pre-ticks, and the owner can tick any agent that is not blocked. Rows grouped by project (all projects),
// notes as icons (🔒 only the owner can start it again, said once under 下线; services), the never-stopped ones folded
// into 「未列入」. Then the mode (下线（可唤醒）/ 停止（不自动唤醒）) and the result with 撤销. Mounted once
// (components/Overlays); state in lib/stopIdle.
import { useEffect, useState } from "react";
import { Check, Loader2, Lock, Minus, Power, Server } from "lucide-react";
import type { IdleReason } from "../../../shared/stopIdle";
import { useI18n, type MessageKey } from "../i18n";
import { formatSpan } from "../lib/delegations";
import {
  blockingReasons, closeStopIdle, confirmStopIdle, customIdleSecs, hostLabel, IDLE_PRESETS, presetKey, resetIdleTicks, scopeKey, setIdleThreshold, setIdleTicks, setStopIdleMode, setStopIdleScope, stopIdleScopes, toggleIdleRow, undoStopIdle, useStopIdle, type IdleRow,
} from "../lib/stopIdle";
import { sidebarOf, useApp } from "../store";
import { Checkbox } from "./settings/Form";
import { btn } from "./Button";
import { useOwnerWindow } from "../lib/ownerContext";

const reasonKey = (reason: IdleReason) => `stopIdle.reason.${reason}` as MessageKey;
/** Notes: shown as icons, not as reasons. */
const NOTES: ReadonlySet<IdleReason> = new Set<IdleReason>(["ownerStartOnly", "ownsServices"]);

function Row({ row, checked, under }: { row: IdleRow; checked: boolean; under: boolean }) {
  const { t } = useI18n();
  const idle = row.idleSecs === null ? t("stopIdle.idleUnknown") : t("stopIdle.idleFor", { t: formatSpan(row.idleSecs) });
  const cautions = row.reasons.filter((reason) => !NOTES.has(reason));
  const name = row.name ?? row.cutexSessionId;
  return (
    <li data-testid="stop-idle-row" data-verdict={row.verdict} data-under={under ? "" : undefined}>
      <label className="flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1 pl-6 hover:bg-surface-2">
        <Checkbox checked={checked} onChange={() => toggleIdleRow(row.cutexSessionId)} label={name} />
        <span className={`min-w-0 truncate text-sm ${under ? "text-muted" : ""}`}>{name}</span>
        {row.reasons.includes("ownerStartOnly") && (
          <span data-stop-idle-lock="" title={t("stopIdle.reason.ownerStartOnly")} className="shrink-0 text-subtle">
            <Lock size={12} aria-label={t("stopIdle.reason.ownerStartOnly")} />
          </span>
        )}
        {row.reasons.includes("ownsServices") && (
          <span title={t("stopIdle.reason.ownsServices")} className="shrink-0 text-subtle">
            <Server size={12} aria-label={t("stopIdle.reason.ownsServices")} />
          </span>
        )}
        {cautions.length > 0 && <span className="min-w-0 truncate text-xs text-warn-text">{cautions.map((reason) => t(reasonKey(reason))).join(" · ")}</span>}
        <span className={`ml-auto shrink-0 text-xs tabular-nums ${under ? "text-subtle/70" : "text-subtle"}`}>{idle}</span>
      </label>
    </li>
  );
}

/** A project's box: all, none or some of its rows ticked; a click ticks all (or, all ticked, none). */
function GroupBox({ rows, selected, label }: { rows: IdleRow[]; selected: ReadonlySet<string>; label: string }) {
  const n = rows.filter((row) => selected.has(row.cutexSessionId)).length;
  const all = n === rows.length;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={all ? true : n > 0 ? "mixed" : false}
      aria-label={label}
      onClick={() => setIdleTicks(rows.map((row) => row.cutexSessionId), !all)}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${n > 0 ? "border-accent bg-accent text-white" : "border-border bg-background hover:border-accent/70"}`}
    >
      {all ? <Check size={11} strokeWidth={3} /> : n > 0 ? <Minus size={11} strokeWidth={3} /> : null}
    </button>
  );
}

const chip = (on: boolean) => `rounded-md border px-2 py-0.5 text-xs disabled:opacity-50 ${on ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted hover:bg-surface-2 hover:text-foreground"}`;

/** 空闲超过: 全部 (0) and the presets, or a number of minutes / hours / days of the owner's own — applied as typed. */
function ThresholdPicker({ secs, disabled }: { secs: number; disabled: boolean }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<"m" | "h" | "d">("m");
  const custom = customIdleSecs(amount, unit);
  const own = amount.trim() !== "" && custom === secs;
  const apply = (value: string, u: "m" | "h" | "d") => {
    const next = customIdleSecs(value, u);
    if (next !== null) setIdleThreshold(next);
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("stopIdle.thresholdLabel")} data-testid="stop-idle-threshold">
      <span className="w-14 shrink-0 text-xs text-muted">{t("stopIdle.thresholdLabel")}</span>
      {IDLE_PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          className={chip(!own && secs === p)}
          aria-pressed={!own && secs === p}
          onClick={() => {
            setAmount("");
            setIdleThreshold(p);
          }}
        >
          {t(presetKey(p))}
        </button>
      ))}
      <span className={`flex items-center overflow-hidden rounded-md border ${own ? "border-accent" : "border-border"}`}>
        <input
          value={amount}
          inputMode="numeric"
          disabled={disabled}
          placeholder={t("stopIdle.custom")}
          aria-label={t("stopIdle.custom")}
          data-testid="stop-idle-custom"
          onChange={(e) => {
            setAmount(e.target.value);
            apply(e.target.value, unit);
          }}
          onKeyDown={(e) => !isImeComposing(e) && e.key === "Enter" && apply(amount, unit)}
          className="w-16 bg-surface px-1.5 py-0.5 text-right text-xs outline-none"
        />
        <select
          value={unit}
          disabled={disabled}
          onChange={(e) => {
            const u = e.target.value as "m" | "h" | "d";
            setUnit(u);
            apply(amount, u);
          }}
          aria-label={t("stopIdle.customUnit")}
          className="border-l border-border bg-surface-2 px-1 py-0.5 text-xs"
        >
          <option value="m">{t("stopIdle.unit.m")}</option>
          <option value="h">{t("stopIdle.unit.h")}</option>
          <option value="d">{t("stopIdle.unit.d")}</option>
        </select>
      </span>
    </div>
  );
}

/** 范围: 所有项目 / each project / 独立 — where the dialog was opened from is the first choice. */
function ScopePicker({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const scope = useStopIdle((s) => s.scope);
  const projects = useApp((app) => (scope ? sidebarOf(app, scope.hostId)?.projects?.projects : undefined));
  if (!scope) return null;
  const scopes = stopIdleScopes(scope.hostId, projects ?? [], t);
  // A project the sidebar does not list (yet): still the current choice.
  if (!scopes.some((s) => scopeKey(s) === scopeKey(scope))) scopes.splice(1, 0, scope);
  return (
    <div className="mt-3 flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-xs text-muted">{t("stopIdle.scopeLabel")}</span>
      <select
        value={scopeKey(scope)}
        disabled={disabled}
        aria-label={t("stopIdle.scopeLabel")}
        data-testid="stop-idle-scope"
        onChange={(e) => {
          const next = scopes.find((s) => scopeKey(s) === e.target.value);
          if (next) setStopIdleScope(next);
        }}
        className="max-w-[16rem] rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs"
      >
        {scopes.map((s) => (
          <option key={scopeKey(s)} value={scopeKey(s)}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Renders nothing (and needs no providers) until opened. */
export function StopIdleDialog() {
  const open = useStopIdle((s) => s.open);
  return open ? <OpenStopIdleDialog /> : null;
}

function OpenStopIdleDialog() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const s = useStopIdle();
  const projects = useApp((app) => (s.scope ? sidebarOf(app, s.scope.hostId)?.projects?.projects : undefined));
  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => !isImeComposing(e) && (e.key === "Escape" && s.phase !== "stopping" && closeStopIdle());
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [s.open, s.phase]);
  if (!s.open || !s.scope) return null;
  const projectName = (id: string | null) => (id ? (projects?.find((p) => p.project_id === id)?.presentation.display_name || id) : t("stopIdle.scope.independent"));
  const listed = s.rows.filter((row) => row.selectable);
  const blocked = s.rows.filter((row) => !row.selectable);
  // All projects: a group per project (the sidebar's order), 独立 last; one project or 独立: no headers.
  const byProject = !s.scope.projectId && !s.scope.independent;
  const order = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : (projects?.findIndex((p) => p.project_id === id) ?? -1) + 1 || Number.MAX_SAFE_INTEGER - 1);
  const groups = byProject
    ? [...new Set(listed.map((row) => row.projectId))].sort((a, b) => order(a) - order(b)).map((id) => ({ id, rows: listed.filter((row) => row.projectId === id) }))
    : [{ id: null as string | null, rows: listed }];
  const chosen = listed.filter((row) => s.selected.has(row.cutexSessionId));
  const count = chosen.length;
  const startOnly = chosen.filter((row) => row.reasons.includes("ownerStartOnly")).length;
  const skippedBy = new Map<IdleReason, number>();
  for (const row of blocked) {
    const reason = blockingReasons(row)[0] ?? row.reasons[0];
    if (reason) skippedBy.set(reason, (skippedBy.get(reason) ?? 0) + 1);
  }
  const under = (row: IdleRow) => s.minIdleSecs > 0 && (row.idleSecs === null || row.idleSecs < s.minIdleSecs);
  const done = s.phase === "done";
  const stopped = s.results.filter((r) => r.result === "stopped");
  const skipped = s.results.filter((r) => r.result === "skipped");
  const failed = s.results.filter((r) => r.result === "failed");
  const nameOf = (id: string) => s.rows.find((row) => row.cutexSessionId === id)?.name ?? id;
  const busy = s.phase === "stopping";
  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeStopIdle()}>
      <div role="dialog" aria-modal="true" aria-label={t("stopIdle.title")} className="flex max-h-[80vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-surface p-4 shadow-2xl" data-testid="stop-idle-dialog">
        <div className="flex items-center gap-2">
          <Power size={15} className="shrink-0 text-muted" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t("stopIdle.title")} · <span className="font-normal text-muted">{hostLabel(s.scope.hostId)}</span>
          </h2>
        </div>
        {!done && <ScopePicker disabled={busy} />}
        {!done && <ThresholdPicker secs={s.minIdleSecs} disabled={busy} />}
        {!done && <p className="mt-1 pl-[3.875rem] text-xs text-subtle">{t("stopIdle.thresholdHint")}</p>}
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-y border-border" data-testid="stop-idle-list">
          {s.phase === "loading" && (
            <p className="flex items-center gap-2 px-1 py-4 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("stopIdle.loading")}
            </p>
          )}
          {s.phase === "error" && <p className="px-1 py-3 text-sm text-danger">{t("stopIdle.failed", { error: s.error ?? "" })}</p>}
          {(s.phase === "review" || busy) && (
            <>
              {listed.length > 0 && (
                <div className="sticky top-0 z-[2] flex h-7 items-center gap-3 border-b border-border bg-surface px-1 text-xs text-muted" data-testid="stop-idle-bar">
                  <span>{t("stopIdle.ticked", { n: count, total: listed.length })}</span>
                  <button type="button" disabled={busy} className="text-accent hover:underline" onClick={() => setIdleTicks(listed.map((row) => row.cutexSessionId), true)}>
                    {t("stopIdle.all")}
                  </button>
                  <button type="button" disabled={busy} className="text-accent hover:underline" onClick={() => setIdleTicks(listed.map((row) => row.cutexSessionId), false)}>
                    {t("stopIdle.noneTicked")}
                  </button>
                  <button type="button" disabled={busy} className="text-accent hover:underline" onClick={resetIdleTicks}>
                    {t("stopIdle.retick")}
                  </button>
                </div>
              )}
              {listed.length === 0 && <p className="px-1 py-3 text-sm text-muted">{t("stopIdle.none")}</p>}
              {groups.map((group) => (
                <section key={group.id ?? "-"} data-testid="stop-idle-group" data-project={group.id ?? ""}>
                  {byProject && (
                    <h3 className="sticky top-7 z-[1] flex items-center gap-2 bg-surface-2 px-1 py-1 text-xs font-semibold">
                      <GroupBox rows={group.rows} selected={s.selected} label={projectName(group.id)} />
                      <span className="min-w-0 truncate">{projectName(group.id)}</span>
                      <span className="ml-auto font-normal text-muted tabular-nums">
                        {group.rows.filter((row) => s.selected.has(row.cutexSessionId)).length} / {group.rows.length}
                      </span>
                    </h3>
                  )}
                  <ul>
                    {group.rows.map((row) => (
                      <Row key={row.cutexSessionId} row={row} checked={s.selected.has(row.cutexSessionId)} under={under(row)} />
                    ))}
                  </ul>
                </section>
              ))}
              {blocked.length > 0 && (
                <details className="px-1 py-2 text-xs text-muted" data-testid="stop-idle-skipped">
                  <summary className="cursor-pointer">
                    {t("stopIdle.notListed", { n: blocked.length })}
                    {[...skippedBy].map(([reason, n]) => `${t(reasonKey(reason))} ${n}`).join(" · ")}
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {blocked.map((row) => (
                      <li key={row.cutexSessionId}>
                        {row.name ?? row.cutexSessionId}
                        <span className="text-subtle">
                          {byProject ? ` · ${projectName(row.projectId)}` : ""} · {blockingReasons(row).map((x) => t(reasonKey(x))).join("、")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {done && (
            <div className="px-1 py-2 text-sm" data-testid="stop-idle-result">
              <p>{t(s.mode === "stopped" ? "stopIdle.doneStopped" : "stopIdle.done", { n: stopped.length })}</p>
              {skipped.length > 0 && (
                <ul className="mt-1 text-xs text-muted">
                  <li>{t("stopIdle.skipped", { n: skipped.length })}</li>
                  {skipped.map((r) => (
                    <li key={r.cutexSessionId} className="pl-3">
                      {nameOf(r.cutexSessionId)} <span className="text-subtle">· {(r.reasons ?? []).map((x) => t(reasonKey(x))).join("、")}</span>
                    </li>
                  ))}
                </ul>
              )}
              {failed.length > 0 && <p className="mt-1 text-xs text-danger">{t("stopIdle.failedSome", { n: failed.length, error: failed.map((r) => `${nameOf(r.cutexSessionId)}: ${r.error ?? ""}`).join("; ") })}</p>}
              {s.undone !== null && <p className="mt-1 text-xs text-muted">{t("stopIdle.undone", { n: s.undone })}</p>}
            </div>
          )}
        </div>
        {(s.phase === "review" || busy) && (
          <fieldset className="mt-3 grid grid-cols-2 gap-2 text-sm" disabled={busy} data-testid="stop-idle-mode">
            {(["wakeable", "stopped"] as const).map((mode) => (
              <label key={mode} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 ${s.mode === mode ? "border-accent bg-accent/5" : "border-border hover:bg-surface-2"}`}>
                <input type="radio" name="stop-idle-mode" className="mt-1" checked={s.mode === mode} onChange={() => setStopIdleMode(mode)} />
                <span className="min-w-0">
                  {t(`stopIdle.mode.${mode}` as MessageKey)}
                  <span className="block text-xs text-subtle">{t(`stopIdle.mode.${mode}Hint` as MessageKey)}</span>
                  {mode === "wakeable" && startOnly > 0 && (
                    <span className="mt-0.5 flex items-start gap-1 text-xs text-warn-text" data-testid="stop-idle-start-only">
                      <Lock size={11} className="mt-0.5 shrink-0" />
                      {startOnly === count ? t("stopIdle.startOnlyAll") : t("stopIdle.startOnlySome", { n: startOnly })}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          {done ? (
            <>
              {stopped.length > 0 && s.undone === null && (
                <button onClick={() => void undoStopIdle()} disabled={s.undoing} className="flex items-center gap-1.5 rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-60" data-testid="stop-idle-undo">
                  {s.undoing && <Loader2 size={13} className="animate-spin" />}
                  {t("stopIdle.undo", { n: stopped.length })}
                </button>
              )}
              <button onClick={closeStopIdle} className={btn({ variant: "primary" })}>
                {t("stopIdle.close")}
              </button>
            </>
          ) : (
            <>
              <button onClick={closeStopIdle} disabled={busy} className="rounded-md px-3 py-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50">
                {t("stopIdle.cancel")}
              </button>
              {s.phase !== "error" && s.phase !== "loading" && (
                <button
                  onClick={() => void confirmStopIdle()}
                  disabled={count === 0 || busy}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-sm text-white disabled:opacity-40"
                  data-testid="stop-idle-confirm"
                >
                  {busy && <Loader2 size={13} className="animate-spin" />}
                  {t(s.mode === "stopped" ? "stopIdle.confirmStopped" : "stopIdle.confirmWakeable", { n: count })}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

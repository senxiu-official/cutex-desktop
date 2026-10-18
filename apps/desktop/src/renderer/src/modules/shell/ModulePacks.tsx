// Settings → 模块, signed module packs (docs/desktop-modules.md §23.9): the index status line, each
// optional module's source (内置 / 已下载 vX …), Download / Update / Remove / other versions, and the
// install progress + error in the same shape as 主机后端更新 (step rows, red error + 重试).
import { useEffect } from "react";
import { Check, CircleDashed, Loader2, MoreHorizontal } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { bridge } from "../../bridge";
import { confirmDialog, openMenuFrom } from "../../lib/contextMenu";
import { Button, ListRow } from "../../components/settings/Form";
import { applyPackView, packRow, usePackRuntime, type PackRow } from "../packs";
import type { ModulePacksView, PackStep } from "../../../../shared/modulePacks";

const STEPS: PackStep[] = ["download", "verify", "unpack"];

function Tag({ children, tone = "muted", title }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "danger" | "accent"; title?: string }) {
  const color = tone === "ok" ? "bg-ok/15 text-ok-text" : tone === "warn" ? "bg-warn/15 text-warn-text" : tone === "danger" ? "bg-danger/12 text-danger" : tone === "accent" ? "bg-accent/12 text-accent" : "bg-surface-2 text-muted";
  return (
    <span className={`shrink-0 truncate rounded px-1.5 py-0.5 text-[11px] ${color}`} title={title}>
      {children}
    </span>
  );
}

async function run(call: () => Promise<ModulePacksView> | undefined): Promise<void> {
  try {
    const view = await call();
    if (view) applyPackView(view);
  } catch (error) {
    console.warn("[module-packs]", error);
  }
}

/** The index status line at the top of Settings → 模块 (checks once when the page opens). */
export function PackIndexHeader() {
  const { t } = useI18n();
  const rt = usePackRuntime();
  const view = rt.view;
  const api = bridge.modulePacks;
  useEffect(() => {
    if (api && view && !view.index && !view.checking && !view.check) void run(() => api.check());
    // Once per page visit (view arrives asynchronously the first time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, !!view]);
  if (!api || !view) return null;
  const status = view.checking
    ? t("modules.pack.checking")
    : view.check?.kind === "noRelease"
      ? t("modules.pack.noRelease")
      : view.check
        ? t("modules.pack.checkFailed", { error: view.check.error })
        : view.index
          ? t("modules.pack.checkedAt", { time: new Date(view.index.checkedAt).toLocaleString() })
          : t("modules.pack.neverChecked");
  return (
    <ListRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{t("modules.pack.indexTitle")}</span>
          {view.testKey && (
            <Tag tone="warn" title={t("modules.pack.testKeyHint")}>
              {t("modules.pack.testKey")}
            </Tag>
          )}
        </span>
      }
      detail={<span className={view.check && view.check.kind !== "noRelease" ? "text-danger" : undefined} title={status}>{status}</span>}
      actions={
        <Button onClick={() => void run(() => api.check())} disabled={view.checking}>
          {view.checking ? <Loader2 size={13} className="animate-spin" /> : t("modules.pack.check")}
        </Button>
      }
    />
  );
}

function sourceTag(row: PackRow, t: ReturnType<typeof useI18n>["t"]): { text: string; tone: "muted" | "ok" | "warn" | "danger" | "accent" } | null {
  const d = row.decision;
  if (row.activeVersion) return { text: t("modules.pack.downloaded", { version: row.activeVersion }), tone: "accent" };
  if (row.installed && d && !d.use) {
    const version = row.installed.version;
    switch (d.reason) {
      case "notNewer":
        return { text: t("modules.pack.notNewer", { version }), tone: "muted" };
      case "needsNewerApp":
        return { text: t("modules.pack.needsNewerApp", { version }), tone: "warn" };
      case "needsNewerModule":
        return { text: t("modules.pack.needsNewerModule", { version }), tone: "warn" };
      case "failed":
        return { text: t(row.bundled ? "modules.pack.failed" : "modules.pack.failedNoBundled", { version, error: d.detail ?? "" }), tone: "danger" };
      case "notPackable":
        return null;
    }
  }
  if (row.broken) return { text: t("modules.pack.broken", { version: row.broken.version, error: row.broken.error }), tone: "danger" };
  if (row.bundled) return { text: row.bundledVersion ? t("modules.pack.bundledVersion", { version: row.bundledVersion }) : t("modules.pack.bundled"), tone: "muted" };
  if (row.available[0]) return { text: t("modules.pack.available", { version: row.available[0].version }), tone: "muted" };
  return null;
}

/** The source tag shown next to a module's name. */
export function PackSourceTag({ row }: { row: PackRow }) {
  const { t } = useI18n();
  const tag = sourceTag(row, t);
  return tag ? (
    <Tag tone={tag.tone} title={tag.text}>
      {tag.text}
    </Tag>
  ) : null;
}

/** Download / Update / ⋯ (other versions, Remove) for one module. */
export function PackActions({ row, name }: { row: PackRow; name: string }) {
  const { t } = useI18n();
  const api = bridge.modulePacks;
  const busy = !!usePackRuntime().view?.operation;
  if (!api) return null;
  const install = async (version: string, older: boolean) => {
    if (older && row.installed && !(await confirmDialog(t("modules.pack.downgradeConfirm", { name, version, current: row.installed.version }), true))) return;
    await run(() => api.install({ id: row.id, version, ...(older && row.installed ? { allowOlder: true } : {}) }));
  };
  const remove = async () => {
    if (!row.bundled && !(await confirmDialog(t("modules.pack.removeConfirm", { name }), true))) return;
    await run(() => api.remove({ id: row.id }));
  };
  const canRemove = !!row.installed || !!row.broken;
  const menu = [
    ...row.others.map((o) => ({ label: t(o.older ? "modules.pack.installVersionOlder" : "modules.pack.installVersion", { version: o.version }), onSelect: () => void install(o.version, o.older) })),
    ...(canRemove ? [row.others.length ? ("separator" as const) : null, { label: t("modules.pack.remove"), danger: true, onSelect: () => void remove() }] : []),
  ];
  return (
    <>
      {row.offer && !row.error && (
        <Button primary onClick={() => void install(row.offer!.version, false)} disabled={busy}>
          {row.offer.kind === "download" ? t("modules.pack.download") : t("modules.pack.update", { version: row.offer.version })}
        </Button>
      )}
      {menu.length > 0 && (
        <button
          type="button"
          className="rounded p-1 text-muted hover:bg-hover disabled:opacity-50"
          aria-label={t("modules.pack.otherVersions")}
          title={t("modules.pack.otherVersions")}
          disabled={busy}
          onClick={(e) => openMenuFrom(e.currentTarget, menu)}
        >
          <MoreHorizontal size={15} />
        </button>
      )}
    </>
  );
}

const stepKey = (step: PackStep) => `modules.pack.step.${step}` as MessageKey;

/** Progress (step rows) or the last error (+ 重试) under a module row. */
export function PackBelow({ row }: { row: PackRow }) {
  const { t } = useI18n();
  const api = bridge.modulePacks;
  if (row.operation) {
    if (row.operation.action === "remove") return <p className="pb-1 pl-[18px] text-xs text-subtle">{t("modules.pack.removing")}</p>;
    const current = row.operation.step ? STEPS.indexOf(row.operation.step) : -1;
    return (
      <ol className="space-y-1 pb-1 pl-[18px]">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2 text-xs">
            <span className="flex w-4 shrink-0 justify-center">
              {i < current ? <Check size={13} className="text-ok" /> : i === current ? <Loader2 size={13} className="animate-spin text-accent" /> : <CircleDashed size={13} className="text-subtle/60" />}
            </span>
            <span className={i > current ? "text-subtle" : undefined}>{t(stepKey(step))}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (row.error && api) {
    // The same request again (an explicitly chosen older version stays that version).
    const retry = () => void run(() => (row.error!.action === "remove" ? api.remove({ id: row.id }) : api.install({ id: row.id, ...row.error!.retry })));
    return (
      <div className="flex items-start gap-2 pb-1 pl-[18px]">
        <p className="min-w-0 flex-1 text-xs break-words text-danger">{t("modules.pack.error", { action: t(`modules.pack.action.${row.error.action}`), message: row.error.message })}</p>
        <Button onClick={retry}>{t("modules.pack.retry")}</Button>
      </div>
    );
  }
  return null;
}

/** Rows for modules that exist only as packs (in the index or installed, not built in and not loaded). */
export function PackOnlyRows({ known }: { known: ReadonlySet<string> }) {
  const { t, locale } = useI18n();
  const rt = usePackRuntime();
  const view = rt.view;
  if (!view) return null;
  const ids = [...new Set([...(view.index?.packs.map((p) => p.id) ?? []), ...view.installed.map((p) => p.id), ...view.broken.map((b) => b.id)])].filter((id) => !known.has(id)).sort();
  return (
    <>
      {ids.map((id) => {
        const row = packRow(id, rt, false, null);
        const texts = row.installed ?? row.available[0];
        const name = texts?.title?.[locale] ?? texts?.title?.en ?? id;
        const detail = texts?.description?.[locale] ?? texts?.description?.en;
        return (
          <ListRow
            key={id}
            leading={<span className="h-2 w-2 shrink-0 rounded-full border border-subtle/60" aria-hidden />}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{name}</span>
                <PackSourceTag row={row} />
              </span>
            }
            detail={detail}
            below={<PackBelow row={row} />}
            actions={<PackActions row={row} name={name} />}
          />
        );
      })}
    </>
  );
}


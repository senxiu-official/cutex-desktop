// Settings → 模块, signed module packs (docs/desktop-modules.md §23.9): the index status line, each
// module's tags (ModuleTags, modules/moduleTags.ts), Download / Update / Remove / other versions, and the
// install progress + error in the same shape as 主机后端更新 (step rows, red error + 重试).
import { useEffect } from "react";
import { Check, CircleDashed, Loader2, MoreHorizontal } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { bridge } from "../../bridge";
import { confirmDialog, openMenuFrom } from "../../lib/contextMenu";
import { Button, ListRow, ScopeChip, SettingsGroup } from "../../components/settings/Form";
import { applyPackView, usePackRuntime, type PackRow } from "../packs";
import type { ModuleFacts } from "../moduleTags";
import type { ModulePacksView, PackStep } from "../../../../shared/modulePacks";

const STEPS: PackStep[] = ["download", "verify", "unpack"];

function Tag({ children, tone = "muted", title }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" | "danger" | "accent"; title?: string }) {
  const color = tone === "ok" ? "bg-ok/15 text-ok-text" : tone === "warn" ? "bg-warn/15 text-warn-text" : tone === "danger" ? "bg-danger/12 text-danger" : tone === "accent" ? "bg-accent/12 text-accent" : "bg-surface-2 text-muted";
  return (
    <span className={`shrink-0 truncate rounded px-1.5 py-0.5 text-caption/[inherit] ${color}`} title={title}>
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
    <SettingsGroup agents="none" source="local"><ListRow
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
    /></SettingsGroup>
  );
}

/** Local modules (§23.14): the switch and the install both open main's own dialogs; this only asks. */
export function LocalPacksGroup() {
  const { t } = useI18n();
  const view = usePackRuntime().view;
  const api = bridge.modulePacks;
  if (!api || !view) return null;
  const { allowed, safeStart, held, error } = view.local;
  const busy = !!view.operation;
  const heldText = (h: (typeof held)[number]) =>
    h.reason === "failed" ? t("modules.pack.local.heldFailed", { version: h.version, error: h.detail ?? "" }) : t(h.reason === "off" ? "modules.pack.local.heldOff" : "modules.pack.local.heldSafe", { version: h.version });
  // Main asks in its own dialog, together with what to do about the module's data (§30.6).
  const remove = (id: string) => run(() => api.remove({ id }));
  return (
    <SettingsGroup agents="none" source="local">
      <ListRow
        title={t("modules.pack.local.title")}
        detail={t(allowed ? "modules.pack.local.onDetail" : "modules.pack.local.offDetail")}
        below={
          safeStart || error ? (
            <div className="space-y-1 pb-1 text-xs">
              {safeStart && <p className="text-warn-text">{t(safeStart.reason === "crashes" ? "modules.pack.local.safeCrashes" : "modules.pack.local.safeArgument")}</p>}
              {error && <p className="break-words text-danger">{t("modules.pack.local.error", { message: error })}</p>}
            </div>
          ) : undefined
        }
        actions={
          allowed ? (
            <>
              <Button onClick={() => void run(() => api.installLocal())} disabled={busy}>
                {t("modules.pack.local.install")}
              </Button>
              <Button onClick={() => void run(() => api.allowLocal({ allow: false }))} disabled={busy}>
                {t("modules.pack.local.turnOff")}
              </Button>
            </>
          ) : (
            <Button onClick={() => void run(() => api.allowLocal({ allow: true }))} disabled={busy}>
              {t("modules.pack.local.allow")}
            </Button>
          )
        }
      />
      {held.map((h) => (
        <ListRow
          key={h.id}
          title={
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{h.id}</span>
              <Tag tone={h.reason === "failed" ? "danger" : "warn"}>{t("modules.pack.local.badge")}</Tag>
            </span>
          }
          detail={heldText(h)}
          actions={<Button onClick={() => void remove(h.id)}>{t("modules.pack.remove")}</Button>}
        />
      ))}
    </SettingsGroup>
  );
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
    // A local module: main asks in its own dialog, together with what to do about its data (§30.6).
    if (!row.bundled && !row.installed?.local && !(await confirmDialog(t("modules.pack.removeConfirm", { name }), true))) return;
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


/**
 * A module row's tags after its name, in the one order (modules/moduleTags.ts): origin chip → version (muted text) →
 * trust / risk / state chips. Each chip is the settings ScopeChip: a click floats its explanation, Esc closes it.
 * `packable`: a bundled module with its own pack version; `bundled`: a failed pack falls back to the bundled copy;
 * `dev`: running from a developer folder.
 */
export function ModuleTags({ facts, packable = false, bundled = false, dev = false }: { facts: ModuleFacts; packable?: boolean; bundled?: boolean; dev?: boolean }) {
  const { t } = useI18n();
  const o = facts.origin;
  const originBody = o === "bundled" && packable ? t("modules.tag.bundledPack.body") : o === "local" && dev ? t("modules.tag.localDev.body") : t(`modules.tag.${o}.body` as MessageKey);
  const body = (kind: ModuleFacts["tags"][number]["kind"], error = ""): string => {
    if (kind === "internal") return t("modules.pack.internalHint");
    if (kind === "experimental") return t("modules.pack.experimentalHint");
    if (kind === "unverified") return t("modules.tag.unverified.body");
    if (kind === "failed") return t(bundled ? "modules.tag.failed.bundled" : "modules.tag.failed.body", { error });
    return t(`modules.tag.${kind}.body` as MessageKey, { error });
  };
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5" data-module-tags="">
      <span className="inline-flex" data-module-tag={o}>
        <ScopeChip tone="plain" icon={null} label={t(`modules.tag.${o}` as MessageKey)} title={t(`modules.tag.${o}.title` as MessageKey)} body={originBody} />
      </span>
      {facts.version && (
        <span className="shrink-0 text-caption text-subtle tabular-nums" data-module-version={facts.versionOf ?? ""} data-tip={t(facts.versionOf === "app" ? "modules.version.app" : "modules.version.module", { version: versionLabel(facts.version) })}>
          {versionLabel(facts.version)}
        </span>
      )}
      {facts.tags.map((tag) => (
        <span key={tag.kind} className="inline-flex" data-module-tag={tag.kind}>
          <ScopeChip tone={tag.tone} icon={null} label={t(`modules.tag.${tag.kind}` as MessageKey)} title={t(`modules.tag.${tag.kind}.title` as MessageKey, { version: tag.version ?? "" })} body={body(tag.kind, tag.error)} />
        </span>
      ))}
    </span>
  );
}

/** "v1.2.0"; a source build's commit (even "89c3643") stays as it is. */
const versionLabel = (v: string) => (/^\d+\.\d+/.test(v) ? `v${v}` : v);

/** A module that exists only as a pack (in the index or installed, not built in and not loaded): its names. */
export function packOnlyIds(view: ModulePacksView, known: ReadonlySet<string>): string[] {
  return [...new Set([...(view.index?.packs.map((p) => p.id) ?? []), ...view.installed.map((p) => p.id), ...view.broken.map((b) => b.id)])].filter((id) => !known.has(id)).sort();
}

/** One pack-only row (no switch: nothing is loaded to turn on). */
export function PackOnlyRow({ row, name, detail, facts }: { row: PackRow; name: string; detail?: string; facts: ModuleFacts }) {
  return (
    <SettingsGroup agents="none" source="local"><ListRow
      leading={<span className="h-2 w-2 shrink-0 rounded-full border border-subtle/60" aria-hidden />}
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate">{name}</span>
          <ModuleTags facts={facts} />
        </span>
      }
      detail={detail}
      below={<PackBelow row={row} />}
      actions={<PackActions row={row} name={name} />}
    /></SettingsGroup>
  );
}

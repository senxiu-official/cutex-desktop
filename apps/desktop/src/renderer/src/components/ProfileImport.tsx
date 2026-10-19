// Import profiles from CC Switch (cutex capability `profile-import-cc-switch`, owner only): the
// providers CC Switch has set up for Claude Code and Codex on one host, grouped by app, picked with
// checkboxes and imported in one call. cutex reads CC Switch's store and copies the keys itself; the
// list never carries a key and CC Switch is only read. Reusable: Settings → Profile (module
// profile-import, a `settings.section`) and the onboarding (`compact`, plus `useCcSwitchAvailable`).
// Without the capability (or on a cutex without the route) it renders nothing. Its strings are the
// profile-import module's (`profile-import.*`).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ccSwitchImportable, CC_SWITCH_APPS, CC_SWITCH_IMPORT_FEATURE, CC_SWITCH_IMPORT_MAX, type CcSwitchApp, type CcSwitchImportList, type CcSwitchImportResult, type CcSwitchProvider } from "../../../shared/ccSwitchImport";
import { useI18n } from "../i18n";
import { urlHost } from "../lib/profilePresets";
import { loadProfileList } from "../lib/profileSnapshot";
import { daemonApiOf, useFocusHostId } from "../lib/targetHost";
import { useHostData } from "../lib/useHostScope";
import { Button, ErrorNote, Loading, Notice } from "./settings/Form";

/** A row's key: CC Switch ids are unique per app only. */
const rowKey = (p: Pick<CcSwitchProvider, "app" | "id">) => `${p.app}\n${p.id}`;

/** Picked by default: importable and not imported before. */
export function ccSwitchDefaultPicked(p: CcSwitchProvider): boolean {
  return ccSwitchImportable(p) && !p.existingProfile;
}

/** The default selection of a list (at most CC_SWITCH_IMPORT_MAX). */
export function ccSwitchDefaultSelection(list: CcSwitchImportList | null): Set<string> {
  return new Set((list?.providers ?? []).filter(ccSwitchDefaultPicked).slice(0, CC_SWITCH_IMPORT_MAX).map(rowKey));
}

// One read per host shared by the hook and the component (an import or 重新读取 drops it).
const listCache = new Map<string, Promise<CcSwitchImportList | null>>();
function readList(hostId: string, focus: string, fresh = false): Promise<CcSwitchImportList | null> {
  let running = fresh ? undefined : listCache.get(hostId);
  if (!running) {
    running = daemonApiOf(hostId, focus).ccSwitchImportList();
    listCache.set(hostId, running);
    // A failed read is not kept: the next mount asks again.
    running.catch(() => listCache.get(hostId) === running && listCache.delete(hostId));
  }
  return running;
}

/** The host is connected and reports `profile-import-cc-switch`. */
function useHasCapability(hostId: string): boolean {
  const data = useHostData(hostId);
  return !!data && data.daemon.kind === "connected" && data.features.has(CC_SWITCH_IMPORT_FEATURE);
}

type ListState = { kind: "loading" } | { kind: "ready"; list: CcSwitchImportList | null } | { kind: "error"; message: string };

function useCcSwitchList(hostId: string, enabled: boolean): { state: ListState; reload(): void } {
  const focus = useFocusHostId();
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({ kind: "loading" });
    readList(hostId, focus, round > 0).then(
      (list) => live && setState({ kind: "ready", list }),
      (e: unknown) => live && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `focus` only picks the connection to ask; a focus switch does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, enabled, round]);
  return { state, reload: useCallback(() => setRound((r) => r + 1), []) };
}

/**
 * The onboarding's 「从 CC Switch 导入」 button: the host has the capability, CC Switch is there and it
 * has at least one provider to import (supported, with a key, not imported before).
 */
export function useCcSwitchAvailable(hostId: string): boolean {
  const capable = useHasCapability(hostId);
  const { state } = useCcSwitchList(hostId, capable);
  return capable && state.kind === "ready" && !!state.list?.found && state.list.providers.some(ccSwitchDefaultPicked);
}

export interface ProfileImportProps {
  hostId: string;
  /** After an import that created at least one profile, with the number created. */
  onDone?(created: number): void;
  /** Tighter layout (onboarding): no source path, a scrolling list. */
  compact?: boolean;
}

export function ProfileImport(props: ProfileImportProps) {
  const capable = useHasCapability(props.hostId);
  // Keyed by host: another host starts over (selection, result).
  return capable ? <ProfileImportBody key={props.hostId} {...props} /> : null;
}

const TAG = "inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] whitespace-nowrap";

function ProfileImportBody({ hostId, onDone, compact }: ProfileImportProps) {
  const { t } = useI18n();
  const focus = useFocusHostId();
  const { state, reload } = useCcSwitchList(hostId, true);
  const list = state.kind === "ready" ? state.list : null;
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CcSwitchImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Each new list starts from its default selection.
  useEffect(() => setPicked(ccSwitchDefaultSelection(list)), [list]);
  const groups = useMemo(() => CC_SWITCH_APPS.map((app) => [app, (list?.providers ?? []).filter((p) => p.app === app)] as const).filter(([, rows]) => rows.length > 0), [list]);

  // No route on this cutex: nothing to offer.
  if (state.kind === "ready" && list === null) return null;
  if (state.kind === "loading") return <Loading rows={compact ? 1 : 2} />;
  if (state.kind === "error") {
    return (
      <div className="flex items-center gap-3">
        <ErrorNote>{t("profile-import.error", { message: state.message })}</ErrorNote>
        <Button onClick={reload}>{t("profile-import.reload")}</Button>
      </div>
    );
  }
  if (!list!.found) {
    return (
      <div className="flex items-center gap-3 py-2">
        <p className="min-w-0 flex-1 text-xs text-subtle">{t("profile-import.notFound")}</p>
        <Button onClick={reload}>{t("profile-import.reload")}</Button>
      </div>
    );
  }
  if (list!.error) {
    return (
      <div className="flex items-center gap-3">
        <ErrorNote>{t("profile-import.error", { message: list!.error.message })}</ErrorNote>
        <Button onClick={reload}>{t("profile-import.reload")}</Button>
      </div>
    );
  }

  const providers = list!.providers;
  const chosen = providers.filter((p) => picked.has(rowKey(p)) && ccSwitchImportable(p));
  const toggle = (p: CcSwitchProvider, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowKey(p));
      else next.delete(rowKey(p));
      return next;
    });
  const nameOf = (app: CcSwitchApp, id: string) => providers.find((p) => p.app === app && p.id === id)?.name ?? id;

  const runImport = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    setImportError(null);
    setResult(null);
    try {
      const reply = await daemonApiOf(hostId, focus).ccSwitchImport(chosen.map((p) => ({ id: p.id, app: p.app })));
      setResult(reply);
      if (reply.created.length) {
        // The new profiles reach the shared profile list (names, looks); the list here re-reads (已有 Profile).
        void loadProfileList(hostId).catch(() => {});
        reload();
        onDone?.(reply.created.length);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-profile-import="" className="flex flex-col gap-2">
      {!providers.length ? (
        <p className="py-2 text-xs text-subtle">{t("profile-import.empty")}</p>
      ) : (
        <div className={compact ? "max-h-64 overflow-y-auto" : undefined}>
          {groups.map(([app, rows]) => (
            <div key={app} data-cc-switch-app={app} className="py-1">
              <div className="py-1 text-xs font-medium text-subtle">{t(`profile-import.app.${app}`)}</div>
              {rows.map((p) => (
                <ProviderRow key={rowKey(p)} provider={p} checked={picked.has(rowKey(p)) && ccSwitchImportable(p)} disabled={busy} onChange={(on) => toggle(p, on)} />
              ))}
            </div>
          ))}
        </div>
      )}
      <Notice tone="info">{t("profile-import.note")}</Notice>
      {!compact && list!.source && <p className="truncate font-mono text-[10px] text-subtle" title={list!.source.path}>{list!.source.path}</p>}
      {providers.length > 0 && (
        <div className="flex items-center gap-3">
          <Button primary disabled={busy || chosen.length === 0 || chosen.length > CC_SWITCH_IMPORT_MAX} onClick={() => void runImport()}>
            {busy ? t("profile-import.importing") : t("profile-import.import", { n: chosen.length })}
          </Button>
        </div>
      )}
      {importError && <ErrorNote>{importError}</ErrorNote>}
      {result && (
        <div data-cc-switch-result="" className="flex flex-col gap-1 text-xs">
          {result.created.length > 0 && <p className="text-ok-text">{t("profile-import.created", { n: result.created.length, names: result.created.map((c) => c.profile.name).join("、") })}</p>}
          {result.failed.length > 0 && (
            <div className="text-danger">
              <p>{t("profile-import.failed", { n: result.failed.length })}</p>
              <ul className="list-disc pl-5">
                {result.failed.map((f) => (
                  <li key={`${f.app}\n${f.id}`}>{t("profile-import.failedRow", { name: nameOf(f.app, f.id), message: f.message })}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderRow({ provider: p, checked, disabled, onChange }: { provider: CcSwitchProvider; checked: boolean; disabled: boolean; onChange(on: boolean): void }) {
  const { t } = useI18n();
  const importable = ccSwitchImportable(p);
  // Why a row cannot be picked: cutex's reason, else no key / not supported.
  const why = importable ? null : !p.supported ? (p.reason ?? t("profile-import.unsupported")) : t("profile-import.noKey");
  const host = urlHost(p.baseUrl);
  return (
    <label data-cc-switch-row={`${p.app}:${p.id}`} title={why ?? undefined} className={`flex items-center gap-2 border-b border-border py-1.5 last:border-b-0 ${importable ? "cursor-pointer" : "opacity-60"}`}>
      <input type="checkbox" className="shrink-0" checked={checked} disabled={disabled || !importable} onChange={(e) => onChange(e.target.checked)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm">{p.name}</span>
          {p.current && <span className={`${TAG} bg-accent/15 text-accent`}>{t("profile-import.current")}</span>}
          {p.existingProfile && <span className={`${TAG} bg-surface-2 text-subtle`}>{t("profile-import.existing", { name: p.existingProfile })}</span>}
        </div>
        <div className="truncate text-xs text-subtle">{[host, p.model].filter(Boolean).join(" · ")}</div>
        {why && <div className="truncate text-xs text-warn">{why}</div>}
      </div>
    </label>
  );
}

// Tests reset the shared read between cases.
export function resetCcSwitchListCache(): void {
  listCache.clear();
}

// The 更换负责人 flyout (owner bug 2026-10-28; lib/ownerPicker.ts is the pure half): a bounded, searchable
// list of the SERVICE'S OWN HOST's agents — the project's Director and members first, offline ones
// folded away, one-off chats hidden until searched — instead of a flat ~400-row menu of every session
// of the focus host. Shell code (the services/projects pages mount it as the 「更换负责人…」 row's flyout,
// lib/services serviceMenu); its keys live in the services module's catalog like the menu's own.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";
import type { ServiceView } from "../../../shared/ipc";
import { SERVICES_ELIGIBLE_OWNERS_FEATURE, type EligibleServiceOwners } from "../../../shared/serviceOwners";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { api, apiFor } from "../bridge";
import { useI18n } from "../i18n";
import { closeMenu } from "../lib/contextMenu";
import { useApp } from "../store";
import { useHostData } from "../lib/useHostScope";
import { eligibleOwnerChoices, filterOwnerChoices, ownerChoices, type OwnerChoice } from "../lib/ownerPicker";

const ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:opacity-40";
const TAG = "shrink-0 rounded bg-surface-2 px-1 py-0.5 text-caption/[inherit] text-subtle";

function OwnerRow({ choice, onPick, busy }: { choice: OwnerChoice; onPick(): void; busy: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" role="menuitem" data-owner-id={choice.id} disabled={busy} onClick={onPick}
      title={choice.real ?? undefined} className={ROW}>
      <span className="flex w-4 shrink-0 justify-center text-muted">{choice.isCurrent && <Check size={13} />}</span>
      <span className={`min-w-0 flex-1 truncate ${choice.unnamed ? "text-subtle" : ""}`}>{choice.name}</span>
      {choice.isDirector && <span className={TAG}>{t("services.owner.director")}</span>}
      {choice.offline && <span className={TAG}>{t("services.owner.offlineTag")}</span>}
      {choice.unnamed && <span className={TAG}>{t("services.owner.unnamed")}</span>}
    </button>
  );
}

/** The flyout for a service menu (lib/services serviceMenu's `ownerFlyout` parameter). */
export function ServiceOwnerFlyout({ service, hostId, onError }: { service: ServiceView; hostId: string | undefined; onError(e: string): void }) {
  const { t } = useI18n();
  const focus = useApp((s) => s.hosts?.active ?? LOCAL_HOST_ID);
  const host = hostId ?? focus;
  const data = useHostData(host);
  const sidebar = data?.sidebar;
  const supported = data?.features?.has(SERVICES_ELIGIBLE_OWNERS_FEATURE) ?? false;
  const requestKey = JSON.stringify([host, service.slug]);
  const [result, setResult] = useState<{ key: string; value?: EligibleServiceOwners; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!supported) return;
    let active = true;
    setResult(null);
    void apiFor(host).serviceEligibleOwners(service.slug).then(
      (value) => { if (active) setResult({ key: requestKey, value }); },
      (error: unknown) => { if (active) setResult({ key: requestKey, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { active = false; };
  }, [host, service.slug, supported, requestKey, attempt]);
  const current = supported && result?.key === requestKey ? result : null;
  const loading = supported && !current;
  const error = current?.error;
  const choices = useMemo(() => supported
    ? eligibleOwnerChoices(service, current?.value?.owners ?? [])
    : ownerChoices(service, sidebar), [supported, service, current, sidebar]);
  const [query, setQuery] = useState("");
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => filterOwnerChoices(choices, query), [choices, query]);
  const group = (g: OwnerChoice["group"]) => shown.filter((c) => c.group === g);
  const project = group("project");
  const all = group("all");
  const offline = group("offline");
  const pick = (id: string | null) => {
    setBusy(true);
    void (host === focus ? api : apiFor(host))
      .patchService(service.slug, { ownerCutexSessionId: id })
      .then(() => closeMenu(), (e: unknown) => {
        setBusy(false);
        onError(e instanceof Error ? e.message : String(e));
      });
  };
  const label = { project: t("services.owner.project"), all: t("services.owner.all") } as const;
  return (
    <div data-owner-flyout className="flex w-80 flex-col gap-1 rounded-lg border border-border bg-surface p-1 shadow-e2">
      <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
        <Search aria-hidden size={13} className="shrink-0 text-subtle" />
        <input
          data-owner-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Keys stay in the flyout: typing must not drive the menu behind it; ↓ / Enter jump to the rows.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown" || e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget.closest("[data-owner-flyout]")?.querySelector<HTMLElement>("[role=menuitem]"))?.focus();
            }
          }}
          placeholder={t("services.owner.search")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-subtle"
          autoFocus
        />
      </div>
      <div className="max-h-80 overflow-y-auto p-0.5">
        {loading && <p role="status" className="px-2 py-2 text-caption/[inherit] text-subtle">{t("services.owner.loading")}</p>}
        {error !== undefined && <div role="alert" className="px-2 py-2 text-caption/[inherit] text-warn">
          <p>{t("services.owner.loadFailed", { error })}</p>
          <button type="button" className={`${ROW} mt-1`} onClick={() => { setResult(null); setAttempt((v) => v + 1); }}>{t("services.owner.retry")}</button>
        </div>}
        {!supported && !sidebar && <p className="px-2 py-2 text-caption/[inherit] text-subtle">{t("services.owner.none")}</p>}
        {(["project", "all"] as const).map((g) => {
          const rows = g === "project" ? project : all;
          if (!rows.length) return null;
          return (
            <div key={g} data-owner-group={g}>
              <p className="px-2 pt-1 pb-0.5 text-caption/[inherit] text-subtle">{label[g]}</p>
              {rows.map((c) => <OwnerRow key={c.id} choice={c} busy={busy} onPick={() => pick(c.id)} />)}
            </div>
          );
        })}
        {!!offline.length && (
          <div data-owner-group="offline">
            <button type="button" onClick={() => setOfflineOpen((v) => !v)} className={`${ROW} text-subtle`} aria-expanded={offlineOpen}>
              <span className="flex w-4 shrink-0 justify-center">{offlineOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              <span className="min-w-0 flex-1 truncate">{t("services.owner.offline", { n: offline.length })}</span>
            </button>
            {/* A search expands the fold: a match must be visible even before the group is clicked open. */}
            {(offlineOpen || query.trim() !== "") && offline.map((c) => <OwnerRow key={c.id} choice={c} busy={busy} onPick={() => pick(c.id)} />)}
          </div>
        )}
        {!loading && error === undefined && (supported || sidebar) && !shown.length && <p className="px-2 py-2 text-caption/[inherit] text-subtle">{t("services.owner.none")}</p>}
        {!!service.ownerCutexSessionId && (
          <>
            <div className="mx-2 my-1 h-px bg-border" />
            <button type="button" role="menuitem" data-owner-clear disabled={busy} onClick={() => pick(null)} className={`${ROW} text-muted`}>
              <span className="w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t("services.clearOwner")}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

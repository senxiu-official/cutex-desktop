// r269 (plan components-021 §3; contract frozen in shared/componentIndex.ts): a component's effective offers and adapter
// candidate, under its runtime group in Settings → 运行时. Shows what cutex verified (lib/componentExternal): an adapter update
// for new agents vs one that needs a newer cutex, a withdrawn (yanked) new-agent default and the safe version to go back to, the
// versions existing agents stay on, where the offers come from / how fresh they are (检查更新 = index refresh, its own operation);
// a staged adapter version whose user-installed dependencies are not ready yet (the bundled one stays the default), and the
// outcome of the last operation (`done` never means selected: cutex's `result.selected` / `outcome` do). Updating only asks cutex
// (`install {version}`); existing agents keep their pins. Index part only with COMPONENT_INDEX_FEATURE, adapter part only with
// EXTERNAL_RUNTIME_ROOT_FEATURE.
import { useI18n } from "../i18n";
import { componentIndexSupported, componentIndexView, externalStatus, missingCapability, type ExternalStatus, type IndexView } from "../lib/componentExternal";
import { refusalKey } from "../lib/componentCard";
import { checkComponentIndex, requestComponent, type HostComponents } from "../lib/componentStore";
import { setSettingsHost } from "../lib/settingsHost";
import { formatWhen } from "../lib/time";
import { useTargetFeatures } from "../lib/targetHost";
import { services } from "../modules/app";
import { isOperationRunning, type ComponentStatus } from "../../../shared/components";
import { ComponentExternalGuide, ComponentPathSettings } from "./ComponentExternalGuide";
import { Button } from "./settings/Form";
import { Tag } from "./Tag";

const SOURCE_KEY = { componentIndex: "modules.component.index.source.componentIndex", releaseManifest: "modules.component.index.source.releaseManifest", privateKit: "modules.component.index.source.privateKit" } as const;

/** `component`: the host's status of it; `entry`: the host's components (list, pending install, results, refusal). */
export function ComponentIndexPanel({ name, hostId, component, entry, title }: { name: string; hostId: string; component: ComponentStatus | undefined; entry: HostComponents; title: string }) {
  const { t } = useI18n();
  // Both callers render for the settings target host (= hostId).
  const features = useTargetFeatures();
  const view = componentIndexSupported(features) ? componentIndexView(component) : undefined;
  const ext = externalStatus(component, features);
  // A needsUser component shows the guide on its card (cutex reports needsUser for an unselected candidate too when no
  // working version is selected): no second copy here. Otherwise: a candidate, or the selected adapter (unverified: its
  // guide; ready: only the collapsed 路径设置).
  const adapter = ext && component && component.state !== "needsUser" ? ext : undefined;
  // `results` is new (r269): an entry from an older caller / test double may not carry it.
  const result = entry.results?.[name];
  if (!component || (!view && !adapter && !result)) return null;
  const busy = entry.pending?.name === name;
  return (
    <div className="space-y-2 rounded-md border border-border/70 px-3 py-2 text-xs" data-component-index={name} data-index-offer={view?.offer.kind ?? ""}>
      {result && <ResultLine result={result.result} />}
      {view && <IndexPart name={name} hostId={hostId} component={component} view={view} entry={entry} busy={busy} title={title} />}
      {/* The update offer above already installs that version: no second button for it. */}
      {adapter && <AdapterPart name={name} hostId={hostId} component={component} ext={adapter} busy={busy} title={title} coveredAbove={view?.offer.kind === "adapterUpdate" && view.offer.version === adapter.external.version} />}
    </div>
  );
}

function ResultLine({ result }: { result: HostComponents["results"][string]["result"] }) {
  const { t } = useI18n();
  const version = result.version ?? "—";
  // `selected` alone says a default was committed; `done` / `ready` / `needsUser` without it never do.
  const text = result.selected
    ? t("modules.component.result.selected", { version })
    : result.outcome === "ready"
      ? t("modules.component.result.ready", { version })
      : result.outcome === "needsUser"
        ? t("modules.component.result.needsUser", { version })
        : t("modules.component.result.other", { outcome: result.outcome, version });
  return <p className={result.selected || result.outcome === "ready" ? "text-subtle" : "text-warn"} data-component-result={result.outcome} data-result-selected={String(result.selected)}>{text}</p>;
}

function IndexPart({ name, hostId, component, view, entry, busy, title }: { name: string; hostId: string; component: ComponentStatus; view: IndexView; entry: HostComponents; busy: boolean; title: string }) {
  const { t, locale } = useI18n();
  const when = (iso: string | null) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? formatWhen(ms / 1000, Date.now(), locale) : "—";
  };
  const install = (version: string) => void requestComponent(hostId, name, "install", { version });
  const openBackend = () => {
    services.ui.openSettings("backend");
    setSettingsHost(hostId);
  };
  const { offer, yanked } = view;
  const source = Object.hasOwn(SOURCE_KEY, view.source) ? t(SOURCE_KEY[view.source as keyof typeof SOURCE_KEY]) : view.source;
  const indexOp = entry.list?.indexOperation ?? null;
  const checking = isOperationRunning(indexOp);
  const refusal = entry.refusal?.action === "indexCheck" && entry.refusal.name === name ? entry.refusal.error : null;
  const refusalText = refusal ? (refusalKey(refusal.code) ? t(refusalKey(refusal.code)!, { component: title }) : refusal.message) : null;
  return (
    <>
      {yanked && (
        <div data-index-yanked={yanked.version} className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-warn">{t("modules.component.index.yanked", { version: yanked.version })}</p>
            {yanked.reason && <p className="mt-0.5 text-subtle">{t("modules.component.index.yankReason", { reason: yanked.reason })}</p>}
            <p className="mt-0.5 text-subtle">{yanked.safe ? t("modules.component.index.yankedSafe", { version: yanked.safe }) : t("modules.component.index.yankedNoSafe")}</p>
          </div>
          {yanked.safe && <Button primary disabled={busy} onClick={() => install(yanked.safe!)}>{t("modules.component.index.useSafe", { version: yanked.safe })}</Button>}
        </div>
      )}
      {offer.kind === "adapterUpdate" && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p><Tag tone="accent">{t("modules.component.index.updateTag")}</Tag> <span className="ml-1">{component.selected ? t("modules.component.index.adapterUpdate", { version: offer.version, current: component.selected }) : t("modules.component.index.adapterInstall", { version: offer.version })}</span></p>
            {Object.keys(offer.requirements).length > 0 && (
              <p className="mt-0.5 text-subtle">{t("modules.component.index.requirements", { list: Object.entries(offer.requirements).map(([k, v]) => `${k} ${v}`).join(" · ") })}</p>
            )}
            <p className="mt-0.5 text-subtle">{t("modules.component.index.forNewAgents")}</p>
          </div>
          <Button primary disabled={busy} onClick={() => install(offer.version)}>{t("modules.component.index.update")}</Button>
        </div>
      )}
      {offer.kind === "needsCutex" && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p><Tag tone="attention">{t("modules.component.index.needsCutexTag")}</Tag> <span className="ml-1">{t("modules.component.index.needsCutex", { version: offer.version })}</span></p>
            {offer.reason && <p className="mt-0.5 text-subtle">{missingCapability(offer.reason) ? t("modules.component.index.needsCapability", { capability: missingCapability(offer.reason)! }) : t("modules.component.index.reason", { reason: offer.reason })}</p>}
          </div>
          <Button onClick={openBackend}>{t("modules.component.openBackend")}</Button>
        </div>
      )}
      {offer.kind === "incompatible" && (
        <div>
          <p><Tag tone="attention">{t("modules.component.index.incompatibleTag")}</Tag> <span className="ml-1">{t("modules.component.index.incompatible", { version: offer.version })}</span></p>
          {offer.reason && <p className="mt-0.5 text-subtle">{offer.reason === "platform" ? t("modules.component.index.platform") : t("modules.component.index.reason", { reason: offer.reason })}</p>}
        </div>
      )}
      {offer.kind === "unknown" && (
        <div data-index-unknown={offer.version}>
          <p><Tag tone="attention">{t("modules.component.index.unknownTag")}</Tag> <span className="ml-1">{t("modules.component.index.unknown", { version: offer.version })}</span></p>
          <p className="mt-0.5 text-subtle">{t("modules.component.index.unknownHint")}</p>
        </div>
      )}
      {offer.kind === "current" && !yanked && <p className="text-subtle">{t("modules.component.index.current", { version: offer.version })}</p>}
      {offer.kind === "none" && !yanked && <p className="text-subtle">{t("modules.component.index.noneRecommended")}</p>}
      {view.pins.length > 0 && (
        <ul className="space-y-0.5 text-subtle" data-index-pins="">
          {view.pins.map((p) => (
            <li key={p.version}>{t("modules.component.index.pinned", { n: p.agents, version: p.version })}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-subtle" data-index-source={view.source}>
          {/* Null channel / sequence: no signed index supplied these offers (manifest fallback, kit without one). */}
          {view.sequence === null && view.channel === null
            ? t("modules.component.index.fromUnsigned", { source })
            : view.sequence === null && view.fetchedAt === null && !view.stale
              ? t("modules.component.index.notChecked", { source, channel: view.channel ?? "—" })
            : t("modules.component.index.from", { source, sequence: view.sequence ?? "—", published: when(view.publishedAt), fetched: when(view.fetchedAt) })}
        </p>
        <Button disabled={checking} onClick={() => void checkComponentIndex(hostId, name)}>{checking ? t("modules.component.index.checking") : t("modules.component.index.check")}</Button>
      </div>
      {view.stale && (
        <p className="text-warn" data-index-stale="">
          {view.fetchedAt === null
            ? t("modules.component.index.staleNoCache", { reason: view.staleReason ?? "—" })
            : view.staleReason
              ? t("modules.component.index.staleReason", { when: when(view.fetchedAt), reason: view.staleReason })
              : t("modules.component.index.stale", { when: when(view.fetchedAt) })}
        </p>
      )}
      {/* The stale note above already carries the same error. */}
      {indexOp?.state === "failed" && !checking && !(view.stale && view.staleReason === indexOp.error) && <p className="text-warn" data-index-check-failed="">{t("modules.component.index.checkFailed", { error: indexOp.error ?? "—" })}</p>}
      {refusalText && <p className="text-warn" data-index-check-refused="">{t("modules.component.index.checkFailed", { error: refusalText })}</p>}
    </>
  );
}

/** A staged adapter version (or the selected one): cutex's verdict, the guide while it needs the owner; once ready 用于新 agent and the collapsed 路径设置. */
function AdapterPart({ name, hostId, component, ext, busy, title, coveredAbove }: { name: string; hostId: string; component: ComponentStatus; ext: ExternalStatus; busy: boolean; title: string; coveredAbove: boolean }) {
  const { t, locale } = useI18n();
  const { external, readiness, candidate, release } = ext;
  // The candidate may not be downloaded yet (cutex checks a candidate before downloading it); no default yet: no "keeps using".
  const keep = component.selected ? <span className="ml-1">{t("modules.component.external.candidate.keepCurrent", { current: component.selected })}</span> : null;
  const checked = external.checkedAt ? Date.parse(external.checkedAt) : NaN;
  const when = Number.isFinite(checked) ? formatWhen(checked / 1000, Date.now(), locale) : "—";
  // cutex decides whether that version may be selected (yank / compatibility): no button for a row it does not offer.
  const offered = !coveredAbove && (!release || (release.compatible && !release.yanked));
  return (
    <div data-component-adapter={external.version} data-adapter-readiness={readiness} className="space-y-1">
      {candidate ? (
        readiness === "ready" ? (
          <div className="flex flex-wrap items-start gap-2">
            <p className="min-w-0 flex-1">{t("modules.component.external.candidate.ready", { version: external.version, when })}{keep}</p>
            {offered && <Button primary disabled={busy} onClick={() => void requestComponent(hostId, name, "install", { version: external.version })}>{t("modules.component.external.candidate.use")}</Button>}
          </div>
        ) : (
          <p className="text-warn">
            {readiness === "unverified"
              ? t("modules.component.external.candidate.unverified", { version: external.version })
              : t("modules.component.external.candidate.needsUser", { version: external.version, n: external.issues.length })}
            {keep}
          </p>
        )
      ) : (
        readiness !== "ready" && <p className="text-warn">{t("modules.component.external.selectedUnverified", { version: external.version })}</p>
      )}
      {/* Ready: the paths (and 恢复默认) stay reachable, collapsed; a re-probe that finds failed checks brings the guide back. */}
      {readiness !== "ready" ? <ComponentExternalGuide name={name} hostId={hostId} external={external} component={title} compact release={release} /> : <ComponentPathSettings name={name} hostId={hostId} external={external} compact />}
    </div>
  );
}

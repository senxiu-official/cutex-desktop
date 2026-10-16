// Component card (components spec v2 §5; docs/desktop-modules.md §12.1): shown instead of the body of a
// page whose module has `requires.component` while the target host's component is not ready /
// external. States: lib/componentCard.ts (pure); data: lib/componentStore.ts. The only action that
// changes the host is 安装, which asks cutex (POST /v2/components/{name}/install) — the desktop never
// downloads, starts or touches files itself.
import { Puzzle } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../bridge";
import { useI18n } from "../i18n";
import { componentGuideUrl, componentText, isBanner, refusalKey, type ComponentCardState } from "../lib/componentCard";
import { bypassUpdateCard, loadComponents, requestComponent } from "../lib/componentStore";
import { useComponentState } from "../lib/componentView";
import { setSettingsHost } from "../lib/settingsHost";
import { services } from "../modules/app";
import { PageBody } from "./Page";
import { Button } from "./settings/Form";

interface GateProps {
  /** `requires.component`. */
  name: string;
  /** The target host (main pages: the focus host). */
  hostId: string;
  /** The page module's `requires.capabilities`. */
  moduleCapabilities: readonly string[];
  /** The page body. */
  children: ReactNode;
}

/** The page body, a banner over it, or the component card in its place. */
export function ComponentGate({ name, hostId, moduleCapabilities, children }: GateProps) {
  const { state, entry } = useComponentState(hostId, name, { moduleCapabilities });
  if (state.kind === "body" || (state.kind === "updateCutex" && state.bypass && entry.bypass.includes(name))) return <>{children}</>;
  if (state.kind === "waiting") return <main className="min-w-0 flex-1" />;
  const refusal = entry.refusal?.name === name ? entry.refusal.error : null;
  const card = <ComponentCard name={name} hostId={hostId} state={state} refusal={refusal} variant={isBanner(state) ? "banner" : "page"} />;
  if (isBanner(state))
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pt-4">{card}</div>
        {children}
      </div>
    );
  return (
    <main className="flex min-w-0 flex-1">
      <PageBody>{card}</PageBody>
    </main>
  );
}

/**
 * The compact form for places that use a component without being its page (a Claude profile, the
 * new-agent flow, Claude 账户): nothing while it is usable or the host cannot say (no `components`:
 * an older cutex set up by hand), else one line + the same actions as the card. Never blocks viewing.
 */
export function ComponentNotice({ name, hostId, className }: { name: string; hostId: string; className?: string }) {
  const { state, entry } = useComponentState(hostId, name);
  if (state.kind === "body" || state.kind === "waiting" || state.kind === "updateCutex") return null;
  const refusal = entry.refusal?.name === name ? entry.refusal.error : null;
  return (
    <div className={className}>
      <ComponentCard name={name} hostId={hostId} state={state} refusal={refusal} variant="compact" />
    </div>
  );
}

function openBackendUpdates(hostId: string) {
  services.ui.openSettings("backend");
  setSettingsHost(hostId);
}

/** One component card: what the component is, why it is not usable on this host, what to do. */
export function ComponentCard({ name, hostId, state, refusal, variant = "page" }: { name: string; hostId: string; state: Exclude<ComponentCardState, { kind: "body" | "waiting" }>; refusal: { code: string; message: string } | null; variant?: "page" | "banner" | "compact" }) {
  const { t } = useI18n();
  const banner = variant !== "page";
  const { title, what } = componentText(name, t);
  const vars = { component: title };
  let text: ReactNode = null;
  let detail: ReactNode = null;
  let actions: ReactNode = null;
  switch (state.kind) {
    case "askOwner":
      text = t("modules.component.askOwner", vars);
      break;
    case "unsupportedPlatform":
      text = t(state.platform === "windows" ? "modules.component.unsupportedWindows" : "modules.component.unsupportedPlatform", vars);
      break;
    case "updateCutex":
    case "notInManifest":
      text = t(state.kind === "updateCutex" ? "modules.component.updateCutex" : "modules.component.notInManifest", vars);
      actions = (
        <>
          <Button primary onClick={() => openBackendUpdates(hostId)}>{t("modules.component.openBackend")}</Button>
          {state.kind === "updateCutex" && state.bypass && <Button onClick={() => bypassUpdateCard(hostId, name)}>{t("modules.component.openAnyway")}</Button>}
        </>
      );
      break;
    case "unmanaged":
      text = t("modules.component.unmanaged", vars);
      actions = <Button onClick={() => void api.openExternal(componentGuideUrl(name))}>{t("modules.component.openGuide")}</Button>;
      break;
    case "sourceOnly":
      text = t("modules.component.sourceOnly", vars);
      detail = (
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs whitespace-nowrap select-all">{state.command}</code>
          <Button onClick={() => void navigator.clipboard.writeText(state.command)}>{t("modules.component.copy")}</Button>
        </div>
      );
      break;
    case "missing":
      text = t("modules.component.missing", vars);
      if (state.version) detail = <p className="mt-1 text-xs text-subtle">{t("modules.component.version", { version: state.version })}</p>;
      actions = <Button primary onClick={() => void requestComponent(hostId, name, "install")}>{t("modules.component.install")}</Button>;
      break;
    case "installing":
      text = (
        <span className="inline-flex items-center gap-2">
          <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
          {t("modules.component.installing", vars)}
        </span>
      );
      if (state.step) detail = <p className="mt-1 text-xs text-subtle">{t("modules.component.step", { step: state.step })}</p>;
      break;
    case "needsUser":
      text = state.steps.length ? t("modules.component.needsUser", vars) : t("modules.component.needsUserNoSteps", vars);
      if (state.steps.length)
        detail = (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs">
            {state.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        );
      actions = <Button onClick={() => void loadComponents(hostId)}>{t("modules.component.recheck")}</Button>;
      break;
    case "restartPending":
      text = t("modules.component.restartPending", { ...vars, version: state.version ?? "" });
      break;
    case "degraded":
      text = t(state.working ? "modules.component.degradedWorking" : "modules.component.degraded", vars);
      if (state.error) detail = <p className="mt-1 text-xs break-words text-warn">{t("modules.component.error", { error: state.error })}</p>;
      actions = <Button onClick={() => void requestComponent(hostId, name, "install")}>{t("modules.retry")}</Button>;
      break;
    case "readError":
      text = t("modules.component.readError", { error: state.error });
      actions = <Button onClick={() => void loadComponents(hostId)}>{t("modules.retry")}</Button>;
      break;
    case "unknown":
      text = t("modules.component.unknown", { ...vars, state: state.state });
      actions = <Button onClick={() => void loadComponents(hostId)}>{t("modules.component.recheck")}</Button>;
      break;
  }
  return (
    <section className={`rounded-lg border border-border ${banner ? "bg-surface-2 px-3 py-2" : "mt-6 px-4 py-4"}`} data-component-card={state.kind}>
      <div className="flex items-start gap-3">
        <Puzzle size={banner ? 16 : 20} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
        <div className="min-w-0 flex-1">
          {!banner && <h3 className="text-sm font-semibold">{title}</h3>}
          {!banner && <p className="mt-0.5 text-xs text-subtle">{what}</p>}
          <div className={`${banner ? "" : "mt-3 "}${variant === "compact" ? "text-xs" : "text-sm"}`}>{text}</div>
          {variant === "compact" && <p className="mt-0.5 text-xs text-subtle">{what}</p>}
          {detail}
          {refusal && <RefusalLine refusal={refusal} component={title} />}
        </div>
        {actions && <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">{actions}</div>}
      </div>
    </section>
  );
}

/** A refusal of install / remove: the friendly line of a known code (cutex's text on hover), else cutex's text. */
function RefusalLine({ refusal, component }: { refusal: { code: string; message: string }; component: string }) {
  const { t } = useI18n();
  const key = refusalKey(refusal.code);
  return (
    <p className="mt-2 text-xs break-words text-warn" title={key ? `${refusal.code}: ${refusal.message}` : undefined}>
      {key ? t(key, { component }) : t("modules.component.refused", { message: refusal.message, code: refusal.code })}
    </p>
  );
}

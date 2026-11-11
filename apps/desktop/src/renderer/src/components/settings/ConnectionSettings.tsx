// Settings → 主机 (page "hosts"; DESIGN §4.5, §2 remote; multi-host RFC §7.5; owner 2026-11-07). One list of
// the hosts, whichever is yours (another person's says whose it is); this machine's host has the chip 本机. Each
// row is compact (OS icon, name, status, the one action it needs) and opens that host's page (page "access",
// components/settings/AccessSettings). Then 分组 (HostGroupsSection), the view on launch and host marks.
// HostConnectionSection is 主机 → 连接: the full host row (color swatches + custom color, auto-connect,
// connect / disconnect, show it (scope), test, edit, re-pair, remove click-twice; its connection status,
// endpoint and cutex version, group tags; how this desktop is connected and what it is there, connect as —
// docs/research/host-ownership-ui-contract-20261019.md) for the selected host.
// Tokens never reach this page — main stores them (safeStorage) and only reports "paired".
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, Layers, Plus, X } from "lucide-react";
import { DEFAULT_CUTEX_PATH, DEFAULT_REMOTE_PORT, displaySshTarget, groupsOfHost, parseSshTarget, sameScope, type HostGroup, type HostOwner, type HostView, type HostResult, type HostTestResult, type SshConnectAsRequest, type SshErrorView } from "../../../../shared/hosts";
import type { CapabilitiesView } from "../../../../shared/ipc";
import { api } from "../../bridge";
import { confirmDialog } from "../../lib/contextMenu";
import { useI18n, type MessageKey } from "../../i18n";
import { hostVersionTitle, singleHostScope, type HostLook } from "../../lib/hostScope";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { hasLocalHost, hasNoHost, HOST_STAGES, missingRemoteFeatures, problemStage, routesExhausted, type HostStage } from "../../lib/hosts";
import { routeLabel } from "../../lib/hostRoute";
import { useHostOwnership, type HostOwnership } from "../../lib/hostOwnership";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { cutexBuildText, settingsAnchorId } from "../../lib/settingsNav";
import { formatWhen, useClock } from "../../lib/time";
import { setHostAppearance, setHostAutoConnect, setHostConnected, useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { useNonOwnerHosts, lastAccessOf } from "../../lib/hostAccess";
import { setSettingsHost } from "../../lib/settingsHost";
import type { MyAccessRow } from "../../lib/myAccess";
import type { HostUserAccess } from "../../../../shared/users";
import { HostDot, HostPlatformIcon } from "../HostMark";
import { AddButton, Button, EmptyState, IconButton, SettingRow, Section, Segmented, TextInput, Toggle, SettingsGroup } from "./Form";
import { HostGroupsSection, hostGroupRowId, SwatchPicker } from "./HostGroupsSection";
import { SettingsDisclosureRow } from "./SettingsDisclosureRow";
import { HostDetails } from "./HostDetails";
import { AddHostChooser, ReimportToken, TokenProblemText } from "./HostTokenImport";
import { isTokenImportHost } from "../../lib/hostTokenImport";
import { Tag } from "../../components/Tag";
import { useOwnerWindow } from "../../lib/ownerContext";

function useCapabilities(): CapabilitiesView | null | undefined {
  const api = useTargetApi();
  const hostId = useTargetHostId();
  const [caps, setCaps] = useState<CapabilitiesView | null | undefined>(undefined);
  const connected = useHostScope().host(hostId)?.connected === true;
  useEffect(() => {
    setCaps(undefined);
    if (!connected) return;
    api.capabilities().then(setCaps, () => setCaps(null));
  }, [connected, hostId]);
  return caps;
}

/** Address → SSH → cutex → credentials: which step passed and where it stopped. */
function HostStages({ stage }: { stage: HostStage }) {
  const { t } = useI18n();
  const stopped = HOST_STAGES.indexOf(stage);
  return (
    <ol className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs" aria-label={t("host.stage.label")} data-host-stage={stage}>
      {HOST_STAGES.map((step, index) => (
        <li key={step} className={`flex items-center gap-1 ${index < stopped ? "text-ok-text" : index === stopped ? "font-medium text-danger" : "text-subtle"}`} aria-current={index === stopped ? "step" : undefined}>
          {index > 0 && <ChevronRight size={11} className="text-subtle" aria-hidden />}
          {index < stopped && <Check size={11} aria-hidden />}
          {index === stopped && <X size={11} aria-hidden />}
          {t(`host.stage.${step}` as MessageKey)}
        </li>
      ))}
    </ol>
  );
}


/** One line for an ssh / pairing failure: what it means, the step it stopped at, then the stderr tail. */
export function ProblemText({ error }: { error: SshErrorView }) {
  const { t } = useI18n();
  const stage = problemStage(error.code);
  return (
    <div className="mt-1 text-xs text-danger">
      <div>{t(`host.problem.${error.code}` as MessageKey)}</div>
      {stage && <HostStages stage={stage} />}
      {error.tried && error.tried.length > 0 && <div className="mt-0.5 text-danger/80">{t("host.problem.tried", { list: error.tried.join(" · ") })}</div>}
      {error.detail && <HostDetails><pre className="max-h-24 overflow-auto whitespace-pre-wrap">{error.detail}</pre></HostDetails>}
    </div>
  );
}

/** A host's connection, under its card: status (+ problem), endpoint, cutex version. */
function ConnectionLine({ look }: { look: HostLook }) {
  const { t } = useI18n();
  const host = look.view;
  const indicator = look.indicator;
  const tunnel = host.conn?.tunnel ?? null;
  const currentTarget = host.kind === "ssh" ? displaySshTarget(tunnel?.target ?? host.target ?? "") : null;
  // The route is named only while it is up; otherwise the line shows the address being tried.
  const route = tunnel?.status === "up" ? routeLabel(t, host) : null;
  const endpoint = host.kind === "ssh" ? (tunnel?.localPort ? `127.0.0.1:${tunnel.localPort} → ${currentTarget}:${host.remotePort}` : `${currentTarget}:${host.remotePort}`) : (host.conn?.daemon.baseUrl ?? "");
  const version = look.connected && indicator.status === "online" ? `cutex ${hostVersionTitle(look.build, { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") })}` : null;
  const stage = host.kind === "ssh" ? problemStage(indicator.problem) : null;
  const tone = indicator.status === "online" ? "text-ok-text" : indicator.status === "connecting" || indicator.status === "retrying" ? "text-warn" : indicator.status === "disconnected" ? "text-subtle" : "text-danger";
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className={tone}>
          {t(`host.status.${indicator.status}` as MessageKey)}
          {indicator.problem && ` — ${t(`host.problem.${indicator.problem}` as MessageKey)}`}
        </span>
        {look.connected && currentTarget && <span className="text-subtle">{route ? t("host.route.current") : t("host.currentTarget")}: <span className={route ? "" : "font-mono text-caption/[inherit]"}>{route ?? currentTarget}</span></span>}
        {version && (
          <span className="font-mono text-caption/[inherit] text-subtle" title={t("connection.version")}>
            {version}
          </span>
        )}
      </div>
      {stage && <HostStages stage={stage} />}
      {routesExhausted(tunnel) && <div className="mt-1 text-warn">{t("host.routesFailedHint")}</div>}
      {((look.connected && endpoint) || indicator.detail) && (
        <HostDetails>
          {look.connected && endpoint && <div title={t("connection.endpoint")}>{endpoint}</div>}
          {indicator.detail && <pre className="max-h-24 overflow-auto whitespace-pre-wrap">{indicator.detail}</pre>}
        </HostDetails>
      )}
    </div>
  );
}

/** The addresses of an SSH host, in the order they are tried: which one is in use, and moving one saves at once. */
function RouteList({ host, disabled, onMove }: { host: HostView; disabled: boolean; onMove(targets: string[]): void }) {
  const { t } = useI18n();
  const targets = host.targets?.length ? host.targets : [host.target ?? ""];
  const tunnel = host.conn?.tunnel;
  const inUse = tunnel?.status === "up" ? (tunnel.routeIndex ?? targets.indexOf(tunnel.target ?? "")) : -1;
  const move = (index: number, delta: -1 | 1) => {
    const next = [...targets];
    const [target] = next.splice(index, 1);
    next.splice(index + delta, 0, target!);
    onMove(next);
  };
  return (
    <div className="mt-2 pl-6" data-host-routes="">
      <div className="mb-1 text-xs text-muted" title={t("host.routes.hint")}>{t("host.routes")}</div>
      <ol className="space-y-0.5">
        {targets.map((target, index) => {
          const kind = host.routes?.[index]?.kind;
          return (
            <li key={target} className="flex min-w-0 items-center gap-2 text-xs" aria-current={index === inUse ? "true" : undefined}>
              <span className="w-4 shrink-0 text-center font-mono text-subtle">{index + 1}</span>
              <span className="truncate font-mono text-muted">{displaySshTarget(target)}</span>
              {kind && <Tag>{t(`host.route.kind.${kind}`)}</Tag>}
              {index === inUse && <Tag tone="accent">{t("host.route.inUse")}</Tag>}
              {targets.length > 1 && (
                <span className="ml-auto flex shrink-0 items-center">
                  <IconButton label={t("host.moveAddressUp")} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></IconButton>
                  <IconButton label={t("host.moveAddressDown")} disabled={disabled || index === targets.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></IconButton>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {targets.length > 1 && <p className="mt-1 text-caption/[inherit] text-subtle">{t("host.routes.hint")}</p>}
    </div>
  );
}

/** The owner person's name for a sentence (a name, else the fingerprint, else 「另一个人」). */
export function ownerName(owner: HostOwner | null, someone: string): string {
  return owner?.displayName || owner?.fingerprint || someone;
}

/** What this desktop is on the host (UI contract §2), or null when not known yet. */
export function roleKey(o: HostOwnership): MessageKey | null {
  if (o.mine === true && o.role === "owner") return "host.own.role.self";
  if (o.ownerRightsOnly || o.role === "owner" || o.role === "older") return "host.own.role.rights";
  if (o.role === "member") return "host.own.role.member";
  if (o.role === "pending") return "host.own.role.pending";
  return null;
}

/** 「这是我的设备」 (the fallback grouping): for a remote host whose cutex cannot report its owner person. */
function OwnedByMeToggle({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const o = useHostOwnership(hostId);
  if (o.connection === "local" || o.capability === true) return null;
  return (
    <SettingsGroup agents="none" source="local"><span className="flex items-center gap-2" title={t("host.own.markMineHint")}>
      {t("host.own.markMine")}
      <Toggle checked={o.ownedByMe} label={t("host.own.markMine")} onChange={o.setOwnedByMe} />
    </span></SettingsGroup>
  );
}

type T = ReturnType<typeof useI18n>["t"];

/** The toast after pairing with a connect-as (UI contract §2 / §3); null: nothing particular to say. */
export function connectResultText(t: T, r: Extract<HostResult, { ok: true }>, host: string): string | null {
  if (r.connectAs === "member") return r.userId ? t("host.own.result.memberBound", { host }) : t("host.own.result.memberPending", { host });
  if (r.connectAs === "owner" && r.autoReason && r.autoReason !== "ownerIsSomeoneElse") return t(`host.own.result.${r.autoReason}` as MessageKey, { host });
  return null;
}

/** Host color: the palette swatches + a custom color (RFC §7.5, §8.1). */
function HostColorPicker({ hostId, value }: { hostId: string; value: string }) {
  const { t } = useI18n();
  return <SwatchPicker value={value} label={t("host.color")} customLabel={t("host.colorCustom")} onChange={(color) => void setHostAppearance(hostId, { color })} />;
}

const NO_GROUPS: HostGroup[] = [];

/** The groups a host belongs to (RFC §7.3): small tags, click = scroll to the group's editor row. */
function HostGroupTags({ hostId }: { hostId: string }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const groups = useApp((s) => s.hosts?.groups ?? NO_GROUPS);
  const mine = groupsOfHost(groups, hostId);
  if (!mine.length) return null;
  return (
    <>
      {mine.map((g) => (
        <SettingsGroup navigation agents="none" source="local" key={g.id}><button
          key={g.id}
          type="button"
          title={t("host.groupTag", { name: g.name })}
          onClick={() => win.document.getElementById(hostGroupRowId(g.id))?.scrollIntoView({ block: "center", behavior: "smooth" })}
          className="flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1.5 text-caption/[inherit] text-muted hover:text-foreground"
        >
          <Layers size={9} style={g.color ? { color: g.color } : undefined} />
          <span className="max-w-24 truncate">{g.name}</span>
        </button></SettingsGroup>
      ))}
    </>
  );
}

/** The host's capability ids, collapsed behind 「显示能力列表（N）」 (settings audit 2026-10-15 #10), with 复制. */
function CapabilityList({ list }: { list: readonly string[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow readOnly agents="none" source="host" label={t("connection.features")}>
        <Button onClick={() => setOpen(!open)}>{open ? t("host.capabilities.hide") : t("host.capabilities.show", { n: list.length })}</Button>
        <IconButton label={t("host.capabilities.copy")} onClick={() => void navigator.clipboard.writeText(list.join("\n"))}>
          <Copy size={14} />
        </IconButton>
      </SettingRow>
      {open && (
        <div className="flex flex-wrap gap-1 border-b border-border/60 py-3 last:border-b-0">
          {list.map((f) => (
            <Tag key={f} className="font-mono">
              {f}
            </Tag>
          ))}
        </div>
      )}
    </>
  );
}

/** 诊断 (高级): this host's id, features this desktop needs but it lacks, its full feature list. */
export function Diagnostics() {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const look = useHostScope().host(hostId);
  const hosts = useApp((s) => s.hosts);
  const features = useTargetFeatures();
  const caps = useCapabilities();
  const missing = missingRemoteFeatures(hosts && { ...hosts, active: hostId }, features);
  const daemon = look?.view.conn?.daemon;
  const daemonId = daemon?.kind === "connected" ? daemon.hostId : undefined;
  return (
    <Section id={settingsAnchorId("diagnostics")} title={t("connection.diagnostics")}>
      {daemonId && (
        <SettingRow readOnly agents="none" source="host" label={t("host.daemonHostId")}>
          <span className="font-mono text-xs text-muted">{daemonId}</span>
        </SettingRow>
      )}
      {missing.length > 0 && (
        <SettingRow readOnly agents="none" source="local" label={t("host.missing")} hint={t("host.missingHint")}>
          <span className="flex max-w-sm flex-wrap justify-end gap-1">
            {missing.map((f) => (
              <Tag tone="attention" key={f} className="font-mono">
                {f}
              </Tag>
            ))}
          </span>
        </SettingRow>
      )}
      {caps && <CapabilityList list={caps.featureList} />}
    </Section>
  );
}

function TestResult({ result }: { result: HostTestResult }) {
  const { t } = useI18n();
  if (result.ok)
    return (
      <div className="mt-1 text-xs text-ok-text">
        {t("host.test.ok", { version: cutexBuildText(result.cutexBuild, { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") }), host: result.hostId ?? "?" })}
        {result.missing && result.missing.length > 0 && <span className="ml-2 text-warn">{t("host.test.missing", { features: result.missing.join(", ") })}</span>}
      </div>
    );
  if (result.error) return <ProblemText error={result.error} />;
  return <div className="mt-1 text-xs text-danger">{result.message ?? t("host.problem.exited")}</div>;
}

/** You are another user on that host (not its owner): its known access, else the last known role. */
function isMemberHost(access: HostUserAccess | undefined, hostId: string): boolean {
  if (access) return !access.isOwner;
  const last = lastAccessOf<MyAccessRow>(hostId)?.role;
  return last === "member" || last === "pending";
}

/** One host card. `shown`: the view scope is exactly this host; `member`: you are another user there (not its owner). */
function HostRow({ look, shown, member, onRemoved }: { look: HostLook; shown: boolean; member?: boolean; onRemoved(message: { text: string; ok: boolean }): void }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const host = look.view;
  const notify = useApp((s) => s.notify);
  const indicator = look.indicator;
  const [busy, setBusy] = useState<null | "test" | "pair" | "remove" | "save">(null);
  const tokenHost = isTokenImportHost(host);
  const [reimport, setReimport] = useState(false);
  const [test, setTest] = useState<HostTestResult | null>(null);
  const [pairError, setPairError] = useState<SshErrorView | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ label: host.label, targets: (host.targets?.length ? host.targets : [host.target ?? ""]).map(displaySshTarget), remotePort: String(host.remotePort ?? DEFAULT_REMOTE_PORT), cutexPath: host.cutexPath ?? DEFAULT_CUTEX_PATH });
  const tokenRejected = indicator.problem === "tokenRejected";
  const trouble = look.connected && indicator.status !== "online" && indicator.status !== "connecting";
  // A wrong address or cutex path: reconnecting would only fail again, the next step is to change it.
  const fixAddress = trouble && host.kind === "ssh" && (problemStage(indicator.problem) === "address" || indicator.problem === "cutexNotFound");

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const runTest = () =>
    run("test", async () => {
      setTest(null);
      setTest(await api.testHost(host.id));
    });
  const pair = () =>
    run("pair", async () => {
      setPairError(null);
      const r = await api.pairSshHost(host.id);
      if (!r.ok) setPairError(r.error);
      else if (r.cutexPath && r.cutexPath !== host.cutexPath) {
        setForm((f) => ({ ...f, cutexPath: r.cutexPath! }));
        notify(t("host.add.cutexFound", { path: r.cutexPath }));
      }
      // users: the new token waits for the host owner to assign it (a member token: said by connectResultText).
      const said = r.ok ? connectResultText(t, r, host.label) : null;
      if (said) notify(said);
      else if (r.ok && r.pending) notify(t("users.pairedPending", { host: host.label }));
    });
  const remove = () =>
    run("remove", async () => {
      const r = await api.removeSshHost(host.id);
      onRemoved(tokenHost ? { text: t("host.token.forgotten", { host: host.label }), ok: true } : { text: r.revoked ? t("host.removed") : t("host.removedNotRevoked", { host: host.label }), ok: r.revoked });
    });
  const saveName = () =>
    run("save", async () => {
      await setHostAppearance(host.id, { label: form.label });
      setEditing(false);
    });
  const save = () =>
    run("save", async () => {
      const port = Number(form.remotePort);
      const r = await api.updateSshHost(host.id, { label: form.label, targets: form.targets, remotePort: Number.isInteger(port) ? port : -1, ...(tokenHost ? {} : { cutexPath: form.cutexPath }) });
      if (r.ok) setEditing(false);
      else setPairError(r.error);
    });
  const reconnect = () => void api.reconnectHost(host.id).catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"));
  const moveRoute = (targets: string[]) =>
    run("save", async () => {
      const r = await api.updateSshHost(host.id, { targets });
      if (r.ok) setForm((current) => ({ ...current, targets: targets.map(displaySshTarget) }));
      else setPairError(r.error);
    });
  const targetsValid = form.targets.length > 0 && form.targets.every((target) => parseSshTarget(target) !== null);

  const last = host.lastConnectedAt ? Date.parse(host.lastConnectedAt) : NaN;
  return (
    <SettingsGroup agents="none" source="local"><div className={`-mx-4 border-b border-border px-4 pb-3 last:border-b-0`}>
      {/* The conclusion first: how the connection is, why, and the one thing to do about it. */}
      <div data-host-status={indicator.status} className={`-mx-4 mb-3 flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 ${trouble ? "bg-warn/10" : ""}`}>
        <div className="min-w-0 flex-1"><ConnectionLine look={look} /></div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {tokenHost && (tokenRejected || !host.paired) ? (
            <Button primary disabled={busy !== null || reimport} onClick={() => setReimport(true)}>{t("host.token.reimport")}</Button>
          ) : host.kind === "ssh" && (tokenRejected || !host.paired) ? (
            <Button primary disabled={busy !== null} onClick={() => void pair()}>
              {busy === "pair" ? t("host.pairing") : t("host.repair")}
            </Button>
          ) : !look.connected ? (
            <Button primary disabled={busy !== null} onClick={() => void setHostConnected(host.id, true)}>{t("host.connect")}</Button>
          ) : trouble ? (
            <Button primary={!fixAddress} disabled={busy !== null} onClick={reconnect}>{t("host.reconnect")}</Button>
          ) : null}
          {(host.kind === "ssh" || host.kind === "local") && <Button primary={fixAddress} disabled={busy !== null} onClick={() => setEditing((v) => !v)}>{t(host.kind === "local" ? "host.rename" : "host.edit")}</Button>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <HostPlatformIcon platform={look.platform} className="text-muted" />
        <HostDot color={look.color} status={indicator.status} size={9} title={t(`host.status.${indicator.status}` as MessageKey)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate">{host.label}</span>
            {host.kind === "local" && <Tag tone="accent">{t("connection.thisDevice")}</Tag>}
            {shown ? <Tag tone="accent">{t("host.active")}</Tag> : look.inScope && <Tag>{t("host.inScope")}</Tag>}
            {host.kind === "ssh" && !host.paired && <Tag tone="attention">{t("host.notPaired")}</Tag>}
            <HostGroupTags hostId={host.id} />
          </div>
          <div className="truncate font-mono text-caption/[inherit] text-subtle">
            {host.kind === "local" ? t("titlebar.local") : host.kind === "dev-direct" ? `dev ${host.target}` : tokenHost ? `ssh :${host.remotePort} · ${t("host.token.kind")}` : `ssh :${host.remotePort} · ${host.cutexPath}`}
            {Number.isFinite(last) && <span className="ml-2 font-sans">{t("host.lastConnected", { when: formatWhen(last / 1000, now, locale) })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button disabled={busy !== null} onClick={() => void runTest()}>
            {busy === "test" ? t("host.testing") : t("host.test")}
          </Button>
          {look.connected && (
            <Button disabled={busy !== null} onClick={() => void setHostConnected(host.id, false)}>{t("host.disconnect")}</Button>
          )}
        </div>
      </div>
      {host.kind === "ssh" && <RouteList host={host} disabled={busy !== null || editing} onMove={(targets) => void moveRoute(targets)} />}
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 pl-6 text-xs text-muted">
        <span className="flex items-center gap-2">
          {t("host.color")}
          <HostColorPicker hostId={host.id} value={look.color} />
        </span>
        <span className="flex items-center gap-2" title={t("host.autoConnectHint")}>
          {t("host.autoConnect")}
          <Toggle checked={look.autoConnect} label={t("host.autoConnect")} onChange={(on) => void setHostAutoConnect(host.id, on)} />
        </span>
        <OwnedByMeToggle hostId={host.id} />
      </div>
      {editing && host.kind === "local" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
          <TextInput width="w-56" label={t("host.add.label")} value={form.label} placeholder={t("host.renamePlaceholder")} onChange={(label) => setForm((f) => ({ ...f, label }))} />
          <Button primary disabled={busy !== null} onClick={() => void saveName()}>{t("host.save")}</Button>
          <Button onClick={() => setEditing(false)}>{t("dialog.cancel")}</Button>
        </div>
      )}
      {editing && host.kind === "ssh" && (
        <div className="mt-3 space-y-3 pl-6" data-ssh-address-editor="">
          <div className="flex flex-wrap items-start gap-3">
            <label className="block text-xs text-muted">
              <span className="mb-1 block">{t("host.add.label")}</span>
              <TextInput width="w-40" label={t("host.add.label")} value={form.label} placeholder={t("host.add.label")} onChange={(label) => setForm((f) => ({ ...f, label }))} />
            </label>
            <label className="block text-xs text-muted">
              <span className="mb-1 block">{t("host.add.port")}</span>
              <TextInput width="w-24" mono label={t("host.add.port")} value={form.remotePort} placeholder={String(DEFAULT_REMOTE_PORT)} onChange={(remotePort) => setForm((f) => ({ ...f, remotePort: remotePort.replace(/\D/g, "").slice(0, 5) }))} />
            </label>
            {/* A token host runs nothing over SSH: no cutex path. */}
            {!tokenHost && <label className="block text-xs text-muted">
              <span className="mb-1 block">{t("host.add.cutexPath")}</span>
              <TextInput width="w-56" mono label={t("host.add.cutexPath")} value={form.cutexPath} placeholder={DEFAULT_CUTEX_PATH} onChange={(cutexPath) => setForm((f) => ({ ...f, cutexPath }))} />
            </label>}
          </div>
          <div className="max-w-2xl rounded-lg border border-border bg-surface-2/40 p-2.5">
            <div className="mb-1 text-xs font-medium text-muted">{t("host.targets")}</div>
            <p className="mb-2 text-caption/[inherit] text-subtle">{t("host.targetsHint")}</p>
            <div className="space-y-1.5">
              {form.targets.map((target, index) => (
                <div className="flex items-center gap-1" key={index}>
                  <span className="w-5 shrink-0 text-center font-mono text-caption/[inherit] text-subtle">{index + 1}</span>
                  <TextInput width="w-full" mono label={`${t("host.targets")} ${index + 1}`} value={target} placeholder="hachimi-lan / me@host:22" onChange={(value) => setForm((current) => ({ ...current, targets: current.targets.map((item, itemIndex) => itemIndex === index ? value : item) }))} />
                  <IconButton label={t("host.removeAddress")} danger disabled={form.targets.length === 1} onClick={() => setForm((current) => ({ ...current, targets: current.targets.filter((_, itemIndex) => itemIndex !== index) }))}><X size={13} /></IconButton>
                </div>
              ))}
            </div>
            <Button disabled={busy !== null} onClick={() => setForm((current) => ({ ...current, targets: [...current.targets, ""] }))}><Plus size={13} className="mr-1 inline" />{t("host.addAddress")}</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button primary disabled={busy !== null || !targetsValid} onClick={() => void save()}>{t("host.save")}</Button>
            <Button onClick={() => setEditing(false)}>{t("dialog.cancel")}</Button>
          </div>
        </div>
      )}
      {reimport && <ReimportToken host={host} onClose={() => setReimport(false)} />}
      <div className="pl-6">
        {test && <TestResult result={test} />}
        {pairError && (tokenHost ? <TokenProblemText error={pairError} /> : <ProblemText error={pairError} />)}
      </div>
      {host.kind === "ssh" && (
        <div className="-mx-4 mt-3 flex justify-end gap-2 border-t border-border px-4 pt-3">
          {tokenHost && !reimport && !(tokenRejected || !host.paired) && <Button disabled={busy !== null} onClick={() => setReimport(true)}>{t("host.token.reimport")}</Button>}
          <Button
            disabled={busy !== null}
            onClick={() =>
              void confirmDialog(tokenHost ? t("host.token.forgetConfirm", { host: host.label }) : t("host.removeConfirm", { host: host.label }), true, { ok: tokenHost ? t("host.token.forget") : t("host.removeConfirmOk"), cancel: t("settings.cancel") }).then((yes) => {
                if (yes) void remove();
              })
            }
          >
            {tokenHost ? t("host.token.forget") : t("host.remove")}
          </Button>
        </div>
      )}
    </div></SettingsGroup>
  );
}

/** 主机 row: whose host it is when it is someone else's, and how this desktop connects. One muted line. */
function OverviewOwnership({ hostId, label }: { hostId: string; label: string }) {
  const { t } = useI18n();
  const o = useHostOwnership(hostId);
  const how = o.connection === "local" ? null : o.connection === "ssh" ? t("host.own.how.ssh", { target: o.sshTarget ?? label }) : o.connection === "dev" ? t("host.own.how.dev") : t("host.own.how.paired");
  const owner = o.group === "access" && o.owner ? t("host.own.belongsTo", { owner: ownerName(o.owner, t("host.own.someone")) }) : null;
  const text = [owner, how].filter(Boolean).join(" · ");
  return text ? <span className="min-w-0 truncate text-xs text-subtle">{text}</span> : null;
}

/** One host in the list: the row opens its page; a host that needs connecting offers that right here. */
function HostOverviewRow({ look }: { look: HostLook }) {
  const { t } = useI18n();
  const notify = useApp((s) => s.notify);
  const host = look.view;
  const status = look.indicator.status;
  const tone = status === "online" ? "text-ok-text" : status === "connecting" ? "text-warn" : status === "disconnected" ? "text-subtle" : "text-warn";
  const open = () => {
    setSettingsHost(host.id);
    useApp.getState().openSettings("access");
  };
  const reconnect = () => void api.reconnectHost(host.id).catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"));
  return (
    <SettingsGroup navigation agents="none" source="local"><div data-host-row={host.id} className="-mx-4 flex items-center gap-2 border-b border-border px-4 last:border-b-0 hover:bg-surface-2/60">
      <button
        type="button"
        title={t("connection.openHost", { host: host.label })}
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <HostPlatformIcon platform={look.platform} className="text-muted" />
        <span className="min-w-0 truncate text-sm">{host.label}</span>
        {host.kind === "local" && <Tag tone="accent">{t("connection.thisDevice")}</Tag>}
        <OverviewOwnership hostId={host.id} label={host.label} />
        {host.kind === "ssh" && !host.paired && <Tag tone="attention">{t("host.notPaired")}</Tag>}
        <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-xs ${tone}`}>
          <HostDot color={look.color} status={status} size={8} />
          {t(`host.status.${status}` as MessageKey)}
        </span>
        <ChevronRight size={14} className="shrink-0 text-subtle" aria-hidden />
      </button>
      {!look.connected ? (
        <Button onClick={() => void setHostConnected(host.id, true)}>{t("host.connect")}</Button>
      ) : status !== "online" && status !== "connecting" ? (
        <Button onClick={reconnect}>{t("host.reconnect")}</Button>
      ) : null}
    </div></SettingsGroup>
  );
}

/**
 * 主机 → 连接 (local): this desktop's connection to `hostId` — the full host row (status, connect /
 * disconnect, reconnect, test, edit, re-pair, color, auto-connect, remove). After a remove: back to 设备.
 */
export function HostConnectionSection({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const accessMap = useNonOwnerHosts();
  const look = scope.host(hostId);
  const onRemoved = (message: { text: string; ok: boolean }) => {
    const app = useApp.getState();
    app.notify(message.text, message.ok ? "info" : "error");
    setSettingsHost(null);
    app.openSettings("hosts");
  };
  return (
    <Section id={settingsAnchorId("hostConnection")} title={t("shell.access.connection")} hint={t("shell.access.connectionHint")} >
      {look ? <HostRow look={look} shown={sameScope(scope.scope, singleHostScope(hostId))} member={isMemberHost(accessMap[hostId], hostId)} onRemoved={onRemoved} /> : <EmptyState>{t("shell.access.noHost")}</EmptyState>}
    </Section>
  );
}

function AddHostForm({ onDone }: { onDone(): void }) {
  const { t } = useI18n();
  const [aliases, setAliases] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [port, setPort] = useState("");
  const [cutexPath, setCutexPath] = useState("");
  const [connectAs, setConnectAs] = useState<SshConnectAsRequest>("auto");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SshErrorView | null>(null);
  const notify = useApp((s) => s.notify);
  useEffect(() => {
    api.sshConfigHosts().then(setAliases, () => setAliases([]));
  }, []);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addSshHost({ target: target.trim(), label: label.trim() || undefined, remotePort: port ? Number(port) : undefined, cutexPath: cutexPath.trim() || undefined, connectAs });
      if (!r.ok) {
        setError(r.error);
        // The path is the fix here: show its field.
        if (r.error.code === "cutexNotFound") setMore(true);
        return;
      }
      // cutex was not where the field said (default: on PATH) and was found elsewhere: show where.
      if (r.cutexPath && r.cutexPath !== (cutexPath.trim() || DEFAULT_CUTEX_PATH)) {
        setCutexPath(r.cutexPath);
        notify(t("host.add.cutexFound", { path: r.cutexPath }));
      }
      const name = label.trim() || target.trim();
      const said = connectResultText(t, r, name);
      if (said) notify(said);
      else if (r.pending) notify(t("users.pairedPending", { host: name }));
      else notify(t("host.add.done", { host: name }));
      onDone();
    } catch (e) {
      setError({ code: "exited", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="-mx-4 border-b border-border bg-surface-2/40 px-4 py-3">
      <SettingRow agents="none" source="local" label={t("host.add.target")} hint={t("host.add.targetHint")} info={t("host.add.hint")}>
        <input
          list="cutex-ssh-aliases"
          value={target}
          autoFocus
          spellCheck={false}
          placeholder="myserver / me@host:22"
          onChange={(e) => setTarget(e.target.value)}
          className="w-64 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs outline-none focus:border-accent"
        />
        <datalist id="cutex-ssh-aliases">
          {aliases.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </SettingRow>
      {aliases.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1 pb-2">
          {aliases.slice(0, 12).map((a) => (
            <SettingsGroup agents="none" source="local" key={a}><button key={a} onClick={() => setTarget(a)} className={`rounded-md px-1.5 py-0.5 font-mono text-caption/[inherit] ${target === a ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted hover:text-foreground"}`}>
              {a}
            </button></SettingsGroup>
          ))}
        </div>
      )}
      <SettingsDisclosureRow title={t("host.add.more")} open={more} onOpenChange={setMore}>
      <SettingRow agents="none" source="local" label={t("host.add.label")}>
        <TextInput width="w-64" value={label} placeholder={t("host.add.labelPlaceholder")} onChange={setLabel} />
      </SettingRow>
      <SettingRow agents="access" source="local" label={t("host.add.connectAs")} hint={t("host.add.connectAsHint")}>
        <Segmented
          value={connectAs}
          options={[
            { value: "auto" as const, label: t("host.add.connectAs.auto") },
            { value: "member" as const, label: t("host.add.connectAs.member") },
            { value: "owner" as const, label: t("host.add.connectAs.owner") },
          ]}
          onChange={setConnectAs}
        />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("host.add.port")} hint={t("host.add.portHint")}>
        <TextInput width="w-24" mono value={port} placeholder={String(DEFAULT_REMOTE_PORT)} onChange={(v) => setPort(v.replace(/\D/g, "").slice(0, 5))} />
      </SettingRow>
      <SettingRow agents="none" source="local" label={t("host.add.cutexPath")} hint={t("host.add.cutexPathHint")}>
        <TextInput width="w-64" mono value={cutexPath} placeholder={DEFAULT_CUTEX_PATH} onChange={setCutexPath} />
      </SettingRow>
      </SettingsDisclosureRow>
      {error && <ProblemText error={error} />}
      <div className="mt-2 flex items-center justify-end gap-2">
        {busy && <span className="mr-auto text-xs text-subtle">{t("host.add.pairing")}</span>}
        <SettingsGroup navigation agents="none" source="local"><Button disabled={busy} onClick={onDone}>
          {t("dialog.cancel")}
        </Button></SettingsGroup>
        <SettingsGroup agents="none" source="local"><Button primary disabled={busy || !target.trim()} onClick={() => void add()}>
          {t("host.add.submit")}
        </Button></SettingsGroup>
      </div>
    </div>
  );
}

export function HostsPage() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const hosts = useApp((s) => s.hosts);
  const scope = useHostScope();
  const { hostMarksSingle: marksSingle, hostMarkLocal, createHostDefault } = useUiPrefs();
  const focus = useApp((s) => s.settingsFocus);
  // No local host (macOS without a local cutex): no 「本机」 choices and no 本机-mark toggle.
  const localHost = hasLocalHost(hosts);
  const [adding, setAdding] = useState(false);
  // Title bar → 添加 SSH 主机… lands here with the form open.
  useEffect(() => {
    if (focus?.anchor !== "addHost") return;
    setAdding(true);
    useApp.setState({ settingsFocus: null });
    win.requestAnimationFrame(() => win.document.getElementById(settingsAnchorId("hostAdd"))?.scrollIntoView({ block: "start" }));
  }, [focus]);
  return (
    <>
      <Section
        id={settingsAnchorId("hostList")}
        actions={<span id={settingsAnchorId("hostAdd")}><SettingsGroup navigation agents="none" source="local"><AddButton onClick={() => setAdding(true)}>{t("titlebar.addSsh")}</AddButton></SettingsGroup></span>}
      >
        {hasNoHost(hosts) && <EmptyState>{t("firstRun.noHost.title")}</EmptyState>}
        {scope.hosts.map((h) => <HostOverviewRow key={h.id} look={h} />)}
        {hosts && !localHost && !hasNoHost(hosts) && <p className="py-2 text-xs text-subtle">{t("host.noLocalBackend")}</p>}
        {hosts?.weakSecretStorage && <p className="py-2 text-xs text-warn">{t("host.weakStorage")}</p>}
      </Section>
      {adding && (
        <Section title={t("connection.add")} hint={t("connection.addHint")}>
          <AddHostChooser pair={<AddHostForm onDone={() => setAdding(false)} />} onDone={() => setAdding(false)} />
        </Section>
      )}
      <HostGroupsSection />
      <Section id={settingsAnchorId("hostStartup")} title={t("host.startup")}>
        {localHost && (
          <SettingRow agents="none" source="local" label={t("host.startOn")} hint={t("host.startOnHint")}>
            <Segmented
              value={hosts?.startOn ?? "last"}
              options={[
                { value: "last" as const, label: t("host.startOn.last") },
                { value: "local" as const, label: t("host.startOn.local") },
              ]}
              onChange={(v) => void api.setHostStartOn(v)}
            />
          </SettingRow>
        )}
        {localHost && (
          <SettingRow agents="newAgents" source="local" label={t("host.createDefault")} hint={t("host.createDefaultHint")}>
            <Segmented
              value={createHostDefault}
              options={[
                { value: "local" as const, label: t("host.createDefault.local") },
                { value: "context" as const, label: t("host.createDefault.context") },
              ]}
              onChange={(v) => setUiPref("createHostDefault", v)}
            />
          </SettingRow>
        )}
        <SettingRow agents="none" source="local" label={t("host.marksSingle")} hint={t("host.marksSingleHint")}>
          <Toggle checked={marksSingle} label={t("host.marksSingle")} onChange={(on) => setUiPref("hostMarksSingle", on)} />
        </SettingRow>
        {localHost && (
          <SettingRow agents="none" source="local" label={t("host.markLocal")} hint={t("host.markLocalHint")}>
            <Toggle checked={hostMarkLocal} label={t("host.markLocal")} onChange={(on) => setUiPref("hostMarkLocal", on)} />
          </SettingRow>
        )}
      </Section>
    </>
  );
}

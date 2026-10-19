// Settings → 设备 (page "hosts"; DESIGN §4.5, §2 remote; multi-host RFC §7.5). An overview (owner
// 2026-10-19: one place per host, reached from here): the hosts in two cards by your role there —
// 我的设备 (you own it) and 我能访问的设备 (another user's, chip 你是成员); this machine's host has the chip
// 此设备; the split follows host ownership (lib/hostOwnership: the owner person is you, or someone else,
// SSH owner rights included). Each row is compact (OS icon, name, chips, status) and opens that host's page 主机 (page
// "access", components/settings/AccessSettings) on that host. Then 添加 SSH 主机 (pairing over ssh), 分组
// (HostGroupsSection), the view on launch, host marks, and 诊断 (focus host).
// HostConnectionSection is 主机 → 连接: the full host row (color swatches + custom color, auto-connect,
// connect / disconnect, show it (scope), test, edit, re-pair, remove click-twice; its connection status,
// endpoint and cutex version, group tags; how this desktop is connected and what it is there, connect as —
// docs/research/host-ownership-ui-contract-20261019.md) for the selected host.
// Tokens never reach this page — main stores them (safeStorage) and only reports "paired".
import { useEffect, useState } from "react";
import { ChevronRight, Copy, Layers } from "lucide-react";
import { DEFAULT_CUTEX_PATH, DEFAULT_REMOTE_PORT, groupsOfHost, sameScope, type HostGroup, type HostOwner, type HostResult, type HostTestResult, type SshConnectAsRequest, type SshErrorView } from "../../../../shared/hosts";
import type { CapabilitiesView } from "../../../../shared/ipc";
import { api } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, ARMED_FRAME, useArmed } from "../../lib/armedConfirm";
import { hostVersionTitle, singleHostScope, type HostLook } from "../../lib/hostScope";
import { hasLocalHost, hasNoHost, missingRemoteFeatures } from "../../lib/hosts";
import { useHostOwnership, useHostOwnershipGroups, type HostOwnership } from "../../lib/hostOwnership";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { cutexBuildText, settingsAnchorId } from "../../lib/settingsNav";
import { formatWhen, useClock } from "../../lib/time";
import { setHostAppearance, setHostAutoConnect, setHostConnected, setViewScope, useHostScope } from "../../lib/useHostScope";
import { useApp } from "../../store";
import { useNonOwnerHosts, lastAccessOf } from "../../lib/hostAccess";
import { setSettingsHost } from "../../lib/settingsHost";
import type { MyAccessRow } from "../../lib/myAccess";
import type { HostUserAccess } from "../../../../shared/users";
import { HostDot, HostPlatformIcon } from "../HostMark";
import { Button, EmptyState, IconButton, SettingRow, Section, Segmented, TextInput, Toggle } from "./Form";
import { HostGroupsSection, hostGroupRowId, SwatchPicker } from "./HostGroupsSection";

function useCapabilities(): CapabilitiesView | null | undefined {
  const daemon = useApp((s) => s.daemon);
  const [caps, setCaps] = useState<CapabilitiesView | null | undefined>(undefined);
  useEffect(() => {
    setCaps(undefined);
    if (daemon.kind !== "connected") return;
    api.capabilities().then(setCaps, () => setCaps(null));
  }, [daemon.kind, daemon.baseUrl]);
  return caps;
}

/** One line for an ssh / pairing failure: what it means, then the stderr tail. */
export function ProblemText({ error }: { error: SshErrorView }) {
  const { t } = useI18n();
  return (
    <div className="mt-1 text-xs text-danger">
      <div>{t(`host.problem.${error.code}` as MessageKey)}</div>
      {error.tried && error.tried.length > 0 && <div className="mt-0.5 text-danger/80">{t("host.problem.tried", { list: error.tried.join(" · ") })}</div>}
      {error.detail && <pre className="mt-0.5 max-h-24 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-danger/80">{error.detail}</pre>}
    </div>
  );
}

/** A host's connection, under its card: status (+ problem), endpoint, cutex version. */
function ConnectionLine({ look }: { look: HostLook }) {
  const { t } = useI18n();
  const host = look.view;
  const indicator = look.indicator;
  const tunnel = host.conn?.tunnel ?? null;
  const endpoint = host.kind === "ssh" ? (tunnel?.localPort ? `127.0.0.1:${tunnel.localPort} → ${host.target}:${host.remotePort}` : `${host.target}:${host.remotePort}`) : (host.conn?.daemon.baseUrl ?? "");
  const version = look.connected && indicator.status === "online" ? `cutex ${hostVersionTitle(look.build, { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") })}` : null;
  const tone = indicator.status === "online" ? "text-ok-text" : indicator.status === "connecting" || indicator.status === "retrying" ? "text-warn" : indicator.status === "disconnected" ? "text-subtle" : "text-danger";
  return (
    <div className="mt-1 pl-6 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className={tone}>
          {t(`host.status.${indicator.status}` as MessageKey)}
          {indicator.problem && ` — ${t(`host.problem.${indicator.problem}` as MessageKey)}`}
        </span>
        {look.connected && endpoint && (
          <span className="font-mono text-[11px] text-subtle" title={t("connection.endpoint")}>
            {endpoint}
          </span>
        )}
        {version && (
          <span className="font-mono text-[11px] text-subtle" title={t("connection.version")}>
            {version}
          </span>
        )}
      </div>
      {indicator.detail && <pre className="mt-1 max-h-24 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-subtle">{indicator.detail}</pre>}
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
    <span className="flex items-center gap-2" title={t("host.own.markMineHint")}>
      {t("host.own.markMine")}
      <Toggle checked={o.ownedByMe} label={t("host.own.markMine")} onChange={o.setOwnedByMe} />
    </span>
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
  const { t } = useI18n();
  const groups = useApp((s) => s.hosts?.groups ?? NO_GROUPS);
  const mine = groupsOfHost(groups, hostId);
  if (!mine.length) return null;
  return (
    <>
      {mine.map((g) => (
        <button
          key={g.id}
          type="button"
          title={t("host.groupTag", { name: g.name })}
          onClick={() => document.getElementById(hostGroupRowId(g.id))?.scrollIntoView({ block: "center", behavior: "smooth" })}
          className="flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1.5 text-[10px] text-muted hover:text-foreground"
        >
          <Layers size={9} style={g.color ? { color: g.color } : undefined} />
          <span className="max-w-24 truncate">{g.name}</span>
        </button>
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
      <SettingRow label={t("connection.features")}>
        <Button onClick={() => setOpen(!open)}>{open ? t("host.capabilities.hide") : t("host.capabilities.show", { n: list.length })}</Button>
        <IconButton label={t("host.capabilities.copy")} onClick={() => void navigator.clipboard.writeText(list.join("\n"))}>
          <Copy size={14} />
        </IconButton>
      </SettingRow>
      {open && (
        <div className="flex flex-wrap gap-1 border-b border-border/60 py-3 last:border-b-0">
          {list.map((f) => (
            <span key={f} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
              {f}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** 诊断 (page end): host id, features this desktop needs but the host lacks, the full feature list. */
function Diagnostics() {
  const { t } = useI18n();
  const daemon = useApp((s) => s.daemon);
  const hosts = useApp((s) => s.hosts);
  const features = useApp((s) => s.features);
  const caps = useCapabilities();
  const missing = missingRemoteFeatures(hosts, features);
  return (
    <Section id={settingsAnchorId("diagnostics")} title={t("connection.diagnostics")}>
      {daemon.kind === "connected" && (
        <SettingRow label={t("host.daemonHostId")}>
          <span className="font-mono text-xs text-muted">{daemon.hostId}</span>
        </SettingRow>
      )}
      {missing.length > 0 && (
        <SettingRow label={t("host.missing")} hint={t("host.missingHint")}>
          <span className="flex max-w-sm flex-wrap justify-end gap-1">
            {missing.map((f) => (
              <span key={f} className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[11px] text-warn-text">
                {f}
              </span>
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
  const [armed, setArmed] = useArmed(host.id);
  const [busy, setBusy] = useState<null | "test" | "pair" | "remove" | "save">(null);
  const [test, setTest] = useState<HostTestResult | null>(null);
  const [pairError, setPairError] = useState<SshErrorView | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ label: host.label, remotePort: String(host.remotePort ?? DEFAULT_REMOTE_PORT), cutexPath: host.cutexPath ?? DEFAULT_CUTEX_PATH });
  const tokenRejected = indicator.problem === "tokenRejected";

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
      onRemoved({ text: r.revoked ? t("host.removed") : t("host.removedNotRevoked", { host: host.label }), ok: r.revoked });
    });
  const save = () =>
    run("save", async () => {
      const port = Number(form.remotePort);
      const r = await api.updateSshHost(host.id, { label: form.label, remotePort: Number.isInteger(port) ? port : -1, cutexPath: form.cutexPath });
      if (r.ok) setEditing(false);
      else setPairError(r.error);
    });
  const reconnect = () => void api.reconnectHost(host.id).catch((e: unknown) => notify(e instanceof Error ? e.message : String(e), "error"));

  const last = host.lastConnectedAt ? Date.parse(host.lastConnectedAt) : NaN;
  return (
    <div className={`-mx-4 border-b border-border px-4 py-3 last:border-b-0 ${armed ? ARMED_FRAME : ""}`}>
      <div className="flex items-center gap-2">
        <HostPlatformIcon platform={look.platform} className="text-muted" />
        <HostDot color={look.color} status={indicator.status} size={9} title={t(`host.status.${indicator.status}` as MessageKey)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate">{host.label}</span>
            {host.kind === "local" && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("connection.thisDevice")}</span>}
            {shown ? <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("host.active")}</span> : look.inScope && <span className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">{t("host.inScope")}</span>}
            {host.kind === "ssh" && !host.paired && <span className="rounded bg-warn/15 px-1.5 text-[10px] text-warn-text">{t("host.notPaired")}</span>}
            {look.version && <span className="font-mono text-[10px] text-subtle">{look.version}</span>}
            <HostGroupTags hostId={host.id} />
          </div>
          <div className="truncate font-mono text-[11px] text-subtle">
            {host.kind === "local" ? t("titlebar.local") : host.kind === "dev-direct" ? `dev ${host.target}` : `ssh ${host.target} · :${host.remotePort} · ${host.cutexPath}`}
            {Number.isFinite(last) && <span className="ml-2 font-sans">{t("host.lastConnected", { when: formatWhen(last / 1000, now, locale) })}</span>}
          </div>
        </div>
        {armed ? (
          <>
            <span className="text-xs text-danger">{t("host.removeArmed")}</span>
            <button className={ARMED_FORM_BUTTON} onClick={() => void remove()}>
              {t("host.remove")}
            </button>
          </>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button disabled={busy !== null} onClick={() => void runTest()}>
              {busy === "test" ? t("host.testing") : t("host.test")}
            </Button>
            {host.kind === "ssh" && (
              <>
                {(tokenRejected || !host.paired) && (
                  <Button disabled={busy !== null} onClick={() => void pair()}>
                    {busy === "pair" ? t("host.pairing") : t("host.repair")}
                  </Button>
                )}
                <Button disabled={busy !== null} onClick={() => setEditing((v) => !v)}>
                  {t("host.edit")}
                </Button>
                <Button disabled={busy !== null} onClick={() => setArmed(true)}>
                  {t("host.remove")}
                </Button>
              </>
            )}
            {look.connected && indicator.status !== "online" && (
              <Button disabled={busy !== null} onClick={reconnect}>
                {t("host.reconnect")}
              </Button>
            )}
            <Button disabled={busy !== null} onClick={() => void setHostConnected(host.id, !look.connected)}>
              {look.connected ? t("host.disconnect") : t("host.connect")}
            </Button>
            {!shown && (
              <Button primary disabled={busy !== null} onClick={() => void setViewScope(singleHostScope(host.id))}>
                {t("host.switch")}
              </Button>
            )}
          </div>
        )}
      </div>
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
      <ConnectionLine look={look} />
      {editing && host.kind === "ssh" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          <TextInput width="w-40" value={form.label} placeholder={t("host.add.label")} onChange={(label) => setForm((f) => ({ ...f, label }))} />
          <TextInput width="w-24" mono value={form.remotePort} placeholder={String(DEFAULT_REMOTE_PORT)} onChange={(remotePort) => setForm((f) => ({ ...f, remotePort: remotePort.replace(/\D/g, "").slice(0, 5) }))} />
          <TextInput width="w-56" mono value={form.cutexPath} placeholder={DEFAULT_CUTEX_PATH} onChange={(cutexPath) => setForm((f) => ({ ...f, cutexPath }))} />
          <Button primary disabled={busy !== null} onClick={() => void save()}>
            {t("host.save")}
          </Button>
          <Button onClick={() => setEditing(false)}>{t("dialog.cancel")}</Button>
        </div>
      )}
      <div className="pl-6">
        {test && <TestResult result={test} />}
        {pairError && <ProblemText error={pairError} />}
      </div>
    </div>
  );
}

/** 设备: one compact host row; the whole row opens the host's page 主机 on that host. */
/** 设备 overview row: how this desktop is connected and what it is there, one muted line (as 主机 → 连接). */
function OverviewOwnership({ hostId, label }: { hostId: string; label: string }) {
  const { t } = useI18n();
  const o = useHostOwnership(hostId);
  const how = o.connection === "local" ? null : o.connection === "ssh" ? t("host.own.how.ssh", { target: o.sshTarget ?? label }) : o.connection === "dev" ? t("host.own.how.dev") : t("host.own.how.paired");
  const role = roleKey(o);
  // 可访问的主机: whose it is first (主人：ema), then how you connect and what you can do.
  const owner = o.group === "access" && o.owner ? t("host.own.ownerIs", { owner: ownerName(o.owner, t("host.own.someone")) }) : null;
  const text = [owner, how, role && t(role)].filter(Boolean).join(" · ");
  return text ? <span className="min-w-0 truncate text-xs text-subtle">{text}</span> : null;
}

function HostOverviewRow({ look }: { look: HostLook; member?: boolean }) {
  const { t } = useI18n();
  const host = look.view;
  const status = look.indicator.status;
  const tone = status === "online" ? "text-ok-text" : status === "connecting" || status === "retrying" ? "text-warn" : status === "disconnected" ? "text-subtle" : "text-danger";
  const open = () => {
    setSettingsHost(host.id);
    useApp.getState().openSettings("access");
  };
  return (
    <button
      type="button"
      data-host-row={host.id}
      title={t("connection.openHost", { host: host.label })}
      onClick={open}
      className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-2 border-b border-border px-4 py-2.5 text-left last:border-b-0 hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none"
    >
      <HostPlatformIcon platform={look.platform} className="text-muted" />
      <span className="min-w-0 truncate text-sm">{host.label}</span>
      {host.kind === "local" && <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[10px] text-accent">{t("connection.thisDevice")}</span>}
      <OverviewOwnership hostId={host.id} label={host.label} />
      {host.kind === "ssh" && !host.paired && <span className="shrink-0 rounded bg-warn/15 px-1.5 text-[10px] text-warn-text">{t("host.notPaired")}</span>}
      <span className={`ml-auto flex shrink-0 items-center gap-1.5 text-xs ${tone}`}>
        <HostDot color={look.color} status={status} size={8} />
        {t(`host.status.${status}` as MessageKey)}
      </span>
      <ChevronRight size={14} className="shrink-0 text-subtle" aria-hidden />
    </button>
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
    <Section id={settingsAnchorId("hostConnection")} title={t("shell.access.connection")} hint={t("shell.access.connectionHint")} source="local">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SshErrorView | null>(null);
  const notify = useApp((s) => s.notify);
  useEffect(() => {
    api.sshConfigHosts().then(setAliases, () => setAliases([]));
  }, []);
  const add = async (connect: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addSshHost({ target: target.trim(), label: label.trim() || undefined, remotePort: port ? Number(port) : undefined, cutexPath: cutexPath.trim() || undefined, connectAs });
      if (!r.ok) {
        setError(r.error);
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
      onDone();
      if (connect) await setViewScope(singleHostScope(r.hostId));
    } catch (e) {
      setError({ code: "exited", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="-mx-4 border-b border-border bg-surface-2/40 px-4 py-3">
      <p className="mb-2 text-xs text-subtle">{t("host.add.hint")}</p>
      <SettingRow label={t("host.add.target")} hint={t("host.add.targetHint")}>
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
            <button key={a} onClick={() => setTarget(a)} className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] ${target === a ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted hover:text-foreground"}`}>
              {a}
            </button>
          ))}
        </div>
      )}
      <SettingRow label={t("host.add.label")}>
        <TextInput width="w-64" value={label} placeholder={t("host.add.labelPlaceholder")} onChange={setLabel} />
      </SettingRow>
      <SettingRow label={t("host.add.connectAs")} hint={t("host.add.connectAsHint")}>
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
      <SettingRow label={t("host.add.port")} hint={t("host.add.portHint")}>
        <TextInput width="w-24" mono value={port} placeholder={String(DEFAULT_REMOTE_PORT)} onChange={(v) => setPort(v.replace(/\D/g, "").slice(0, 5))} />
      </SettingRow>
      <SettingRow label={t("host.add.cutexPath")} hint={t("host.add.cutexPathHint")}>
        <TextInput width="w-64" mono value={cutexPath} placeholder={DEFAULT_CUTEX_PATH} onChange={setCutexPath} />
      </SettingRow>
      {error && <ProblemText error={error} />}
      <div className="mt-2 flex items-center justify-end gap-2">
        {busy && <span className="mr-auto text-xs text-subtle">{t("host.add.pairing")}</span>}
        <Button disabled={busy} onClick={onDone}>
          {t("dialog.cancel")}
        </Button>
        <Button disabled={busy || !target.trim()} onClick={() => void add(false)}>
          {t("host.add.submit")}
        </Button>
        <Button primary disabled={busy || !target.trim()} onClick={() => void add(true)}>
          {t("host.add.submitConnect")}
        </Button>
      </div>
    </div>
  );
}

export function HostsPage() {
  const { t } = useI18n();
  const hosts = useApp((s) => s.hosts);
  const scope = useHostScope();
  const accessMap = useNonOwnerHosts();
  const { hostMarksSingle: marksSingle, hostMarkLocal, createHostDefault } = useUiPrefs();
  const focus = useApp((s) => s.settingsFocus);
  // No local host (macOS without a local cutex): no 「本机」 choices and no 本机-mark toggle.
  const localHost = hasLocalHost(hosts);
  const groups = useHostOwnershipGroups();
  const [adding, setAdding] = useState(false);
  // Title bar → 添加 SSH 主机… lands here with the form open.
  useEffect(() => {
    if (focus?.anchor !== "addHost") return;
    setAdding(true);
    useApp.setState({ settingsFocus: null });
    requestAnimationFrame(() => document.getElementById(settingsAnchorId("hostAdd"))?.scrollIntoView({ block: "start" }));
  }, [focus]);
  // 我的设备 / 我能访问的设备: your role on each host (lib/hostAccess; a host not read yet counts as yours,
  // a disconnected one keeps its last known role).
  const member = (id: string) => isMemberHost(accessMap[id], id);
  const row = (h: HostLook) => <HostOverviewRow key={h.id} look={h} member={member(h.id)} />;
  // Split by host ownership (lib/hostOwnership): the owner person is you, or someone else (SSH owner rights included).
  const access = new Set(groups.access);
  const mine = scope.hosts.filter((h) => !access.has(h.id));
  const others = scope.hosts.filter((h) => access.has(h.id));
  return (
    <>
      <Section id={settingsAnchorId("hostList")} title={t("connection.mine")} hint={t("connection.mineHint")}>
        {hasNoHost(hosts) && <EmptyState>{t("firstRun.noHost.title")}</EmptyState>}
        {mine.map(row)}
        {hosts && !localHost && !hasNoHost(hosts) && <p className="py-2 text-xs text-subtle">{t("host.noLocalBackend")}</p>}
      </Section>
      <Section id={settingsAnchorId("hostOthers")} title={t("connection.others")} hint={t("connection.othersHint")}>
        {others.length === 0 && <EmptyState>{t("connection.othersNone")}</EmptyState>}
        {others.map(row)}
      </Section>
      <Section id={settingsAnchorId("hostAdd")} title={t("connection.add")} hint={t("connection.addHint")}>
        {adding ? (
          <AddHostForm onDone={() => setAdding(false)} />
        ) : (
          <SettingRow label={t("host.add.target")}>
            <Button onClick={() => setAdding(true)}>{t("titlebar.addSsh")}</Button>
          </SettingRow>
        )}
        {hosts?.weakSecretStorage && <p className="py-2 text-xs text-warn">{t("host.weakStorage")}</p>}
      </Section>
      <HostGroupsSection />
      <Section id={settingsAnchorId("hostStartup")} title={t("host.startup")}>
        {localHost && (
          <SettingRow label={t("host.startOn")} hint={t("host.startOnHint")}>
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
          <SettingRow label={t("host.createDefault")} hint={t("host.createDefaultHint")}>
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
        <SettingRow label={t("host.marksSingle")} hint={t("host.marksSingleHint")}>
          <Toggle checked={marksSingle} label={t("host.marksSingle")} onChange={(on) => setUiPref("hostMarksSingle", on)} />
        </SettingRow>
        {localHost && (
          <SettingRow label={t("host.markLocal")} hint={t("host.markLocalHint")}>
            <Toggle checked={hostMarkLocal} label={t("host.markLocal")} onChange={(on) => setUiPref("hostMarkLocal", on)} />
          </SettingRow>
        )}
      </Section>
      {/* No host at all: nothing to diagnose. */}
      {!hasNoHost(hosts) && <Diagnostics />}
    </>
  );
}

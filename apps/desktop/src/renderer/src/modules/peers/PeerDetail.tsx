// One peer in Settings → 跨主机: name and addresses, enable, state and diagnostics; the policy editor
// (exports over this host's projects / standalone agents or 全部, accept, review mode, assumed caps,
// limits, outbound visibility); the agents the peer exports; the audit table; and delete, which
// first lists the open delegations it ends and confirms in place (click twice, no modal).
// Every edit is one PATCH built by model.ts policyPatch (cutex merges per field, replaces exports /
// assumedCaps whole) and the reply replaces the row.
import { useRef, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import type { AskDetail } from "../../../../shared/ipc";
import { CROSS_HOST_TELL_WAKE_FEATURE, PEER_LABEL, PEER_LIMITS, PEER_REVIEWS, PEER_URLS_MAX, peerTellWakeOf, type PeerExport, type PeerPolicy, type PeerRemoteAgent, type PeerReview, type PeerView } from "../../../../shared/peers";
import { MaskedText } from "../../components/MaskedText";
import { ArmedHint } from "../../components/ArmedHint";
import { PeerParty } from "../../components/PeerParty";
import { ArmedRemove, Button, Checkbox, EmptyState, ErrorNote, IconButton, Loading, Notice, NumberField, RefreshButton, Section, Segmented, Select, SettingRow, TextField, TextInput, Toggle } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { summaryFromRecord } from "../../lib/delegations";
import { useTargetApi, useTargetFeatures, useTargetHostId, useTargetSidebar } from "../../lib/targetHost";
import { useOwnerLocalLock } from "../../components/settings/OwnerDevices";
import { dataFlags, useSizeFlags, widthBelow } from "../../lib/sizeFlags";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { usePeerResource, usePeerWrite, usePeerWrites } from "./hooks";
import { exportChoices, exportMode, hasExport, inflightEffect, peerErrorText, policyPatch, toggleExport, withExportMode, type ExportChoice, type ExportMode } from "./model";
import { StateBadge } from "./PeerParts";

const SANDBOXES = [
  { value: "read-only", key: "peers.policy.sandbox.readOnly" },
  { value: "workspace-write", key: "peers.policy.sandbox.workspaceWrite" },
  { value: "danger-full-access", key: "peers.policy.sandbox.full" },
] as const;

function When({ iso }: { iso: string | null | undefined }) {
  const { locale } = useI18n();
  const now = useClock();
  const s = iso ? Date.parse(iso) / 1000 : NaN;
  if (!Number.isFinite(s)) return <span>—</span>;
  return <span title={formatAbsolute(s)}>{formatWhen(s, now, locale)}</span>;
}

function LastSeen({ iso }: { iso: string | null | undefined }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const s = iso ? Date.parse(iso) / 1000 : NaN;
  if (!Number.isFinite(s)) return <span>{t("peers.neverSeen")}</span>;
  return <span title={formatAbsolute(s)}>{t("peers.lastSeen", { t: formatWhen(s, now, locale) })}</span>;
}

function UrlsEditor({ urls, disabled, onCommit }: { urls: string[]; disabled: boolean; onCommit(urls: string[]): void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const add = () => {
    const u = draft.trim();
    if (!u || urls.includes(u)) return;
    onCommit([...urls, u]);
    setDraft("");
  };
  return (
    <div className="flex flex-col items-end gap-1">
      {urls.map((u) => (
        <div key={u} className="flex items-center gap-1">
          <span className="max-w-72 truncate font-mono text-[11px]" title={u}>
            {u}
          </span>
          <ArmedRemove title={t("peers.detail.removeUrl", { url: u })} disabled={disabled || urls.length <= 1} onRemove={() => onCommit(urls.filter((x) => x !== u))} />
        </div>
      ))}
      {urls.length < PEER_URLS_MAX && (
        <div className="flex items-center gap-1">
          <TextInput value={draft} onChange={setDraft} placeholder={t("peers.detail.urlPlaceholder")} mono width="w-56" label={t("peers.detail.addUrl")} disabled={disabled} onKeyDown={(e) => e.key === "Enter" && add()} />
          <IconButton label={t("peers.detail.addUrl")} disabled={disabled || !draft.trim()} onClick={add}>
            <Plus size={13} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled: boolean; onChange(on: boolean): void; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 items-center gap-2 py-0.5 text-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <Checkbox checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}

const EXPORT_LIST_SIZES = { narrow: widthBelow(36) } as const;

function ExportsEditor({ exports, disabled, onCommit }: { exports: PeerExport[]; disabled: boolean; onCommit(next: PeerExport[]): void }) {
  const { t } = useI18n();
  const sidebar = useTargetSidebar();
  // "Selected" with nothing picked yet is only local until the first pick.
  const [picking, setPicking] = useState<ExportMode | null>(null);
  const mode = picking ?? exportMode(exports);
  const choices = exportChoices(sidebar, exports);
  // One column below 36rem, measured on the list itself (lib/sizeFlags; the card is no size container).
  const [listRef, listSize] = useSizeFlags(EXPORT_LIST_SIZES);
  const choose = (m: ExportMode) => {
    setPicking(m === "some" ? m : null);
    const next = withExportMode(exports, m);
    if (JSON.stringify(next) !== JSON.stringify(exports)) onCommit(next);
  };
  const row = (c: ExportChoice) => (
    <Check key={JSON.stringify(c.item)} checked={hasExport(exports, c.item)} disabled={disabled} onChange={(on) => onCommit(toggleExport(exports, c.item, on))}>
      {c.color && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c.color }} />}
      <span className="truncate">{c.name}</span>
      {c.members !== null && <span className="shrink-0 text-xs text-subtle">{t("peers.policy.export.members", { n: c.members })}</span>}
    </Check>
  );
  return (
    <>
      <SettingRow label={t("peers.policy.exports")} hint={mode === "all" ? t("peers.policy.export.allHint") : t("peers.policy.exportsHint")}>
        <Segmented<ExportMode>
          value={mode}
          disabled={disabled}
          label={t("peers.policy.exports")}
          options={[
            { value: "none", label: t("peers.policy.export.none") },
            { value: "all", label: t("peers.policy.export.all") },
            { value: "some", label: t("peers.policy.export.some") },
          ]}
          onChange={choose}
        />
      </SettingRow>
      {mode === "some" && (
        <div ref={listRef} {...dataFlags(listSize)} className="grid grid-cols-2 gap-x-6 border-b border-border py-2 data-[narrow]:grid-cols-1" data-testid="peer-exports">
          <div className="min-w-0">
            <div className="mb-0.5 text-xs text-subtle">{t("peers.policy.export.projects")}</div>
            <div className="max-h-64 overflow-y-auto pr-1">{choices.projects.length ? choices.projects.map(row) : <p className="text-xs text-subtle">—</p>}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-0.5 text-xs text-subtle">{t("peers.policy.export.agents")}</div>
            <div className="max-h-64 overflow-y-auto pr-1">{choices.agents.length ? choices.agents.map(row) : <p className="text-xs text-subtle">—</p>}</div>
          </div>
          {choices.unknown.map((e) => (
            <Check key={JSON.stringify(e)} checked disabled={disabled} onChange={() => onCommit(toggleExport(exports, e, false))}>
              <span className="truncate text-subtle">{t("peers.policy.export.unknown", { id: "agent" in e ? e.agent : "project" in e ? e.project : "?" })}</span>
            </Check>
          ))}
        </div>
      )}
    </>
  );
}

function PolicySections({ peer, disabled, save }: { peer: PeerView; disabled: boolean; save(next: PeerPolicy): void }) {
  const { t } = useI18n();
  const p = peer.policy;
  const set = (inbound: Partial<PeerPolicy["inbound"]>, outbound?: Partial<PeerPolicy["outbound"]>) => save({ inbound: { ...p.inbound, ...inbound }, outbound: { ...p.outbound, ...outbound } });
  const caps = p.inbound.assumedCaps;
  // cross-host-tell-wake: the peer's notes may start a turn here (default off); never sent to an older cutex.
  const wakeSupported = useTargetFeatures().has(CROSS_HOST_TELL_WAKE_FEATURE);
  const wake = peerTellWakeOf(p);
  const sandboxKnown = SANDBOXES.some((s) => s.value === caps.sandbox);
  return (
    <>
      <Section title={t("peers.policy.inbound")}>
        <SettingRow label={t("peers.policy.accept")} hint={t("peers.policy.acceptHint")}>
          <Toggle checked={p.inbound.accept} disabled={disabled} label={t("peers.policy.accept")} onChange={(accept) => set({ accept })} />
        </SettingRow>
        <ExportsEditor exports={p.inbound.exports} disabled={disabled} onCommit={(exports) => set({ exports })} />
        <SettingRow label={t("peers.policy.review")} hint={t("peers.policy.reviewHintLine", { mode: t(`peers.policy.review.${p.inbound.review}Hint` as MessageKey), all: t("peers.policy.reviewHint") })}>
          <Segmented<PeerReview> value={p.inbound.review} disabled={disabled} label={t("peers.policy.review")} options={PEER_REVIEWS.map((r) => ({ value: r, label: t(`peers.policy.review.${r}` as MessageKey) }))} onChange={(review) => set({ review })} />
        </SettingRow>
        <SettingRow label={t("peers.policy.assumedCaps")} hint={t("peers.policy.assumedCapsHint")}>
          <Select<string>
            value={caps.sandbox ?? ""}
            disabled={disabled}
            label={t("peers.policy.sandbox")}
            options={[...SANDBOXES.map((s) => ({ value: s.value as string, label: t(s.key) })), ...(sandboxKnown ? [] : [{ value: caps.sandbox ?? "", label: caps.sandbox ?? "—" }])]}
            onChange={(sandbox) => set({ assumedCaps: { ...caps, sandbox: sandbox || null } })}
          />
        </SettingRow>
        <SettingRow label={t("peers.policy.network")}>
          <Toggle checked={caps.networkAccess} disabled={disabled} label={t("peers.policy.network")} onChange={(networkAccess) => set({ assumedCaps: { ...caps, networkAccess } })} />
        </SettingRow>
        <SettingRow label={t("peers.policy.services")}>
          <Toggle checked={caps.unrestrictedServices} disabled={disabled} label={t("peers.policy.services")} onChange={(unrestrictedServices) => set({ assumedCaps: { ...caps, unrestrictedServices } })} />
        </SettingRow>
        <SettingRow label={t("peers.policy.maxOpenAsks")}>
          <NumberField value={p.inbound.maxOpenAsks} range={PEER_LIMITS.maxOpenAsks} disabled={disabled} label={t("peers.policy.maxOpenAsks")} onCommit={(v) => v !== null && set({ maxOpenAsks: v })} />
        </SettingRow>
        <SettingRow label={t("peers.policy.asksPerHour")}>
          <NumberField value={p.inbound.asksPerHour} range={PEER_LIMITS.asksPerHour} disabled={disabled} label={t("peers.policy.asksPerHour")} onCommit={(v) => v !== null && set({ asksPerHour: v })} />
        </SettingRow>
        {wakeSupported && (
          <>
            <SettingRow label={t("peers.policy.tellWake")} hint={t("peers.policy.tellWakeHint", { label: peer.label })}>
              <Toggle checked={wake.tellWake} disabled={disabled} label={t("peers.policy.tellWake")} onChange={(tellWake) => set({ tellWake })} />
            </SettingRow>
            {wake.tellWake && (
              <SettingRow label={t("peers.policy.tellWakesPerHour")} hint={t("peers.policy.tellWakesPerHourHint")}>
                <NumberField value={wake.tellWakesPerHour} range={PEER_LIMITS.tellWakesPerHour} disabled={disabled} label={t("peers.policy.tellWakesPerHour")} onCommit={(v) => v !== null && set({ tellWakesPerHour: v })} />
              </SettingRow>
            )}
          </>
        )}
      </Section>
      <Section title={t("peers.policy.outbound")}>
        <SettingRow label={t("peers.policy.visibility")} hint={t("peers.policy.visibilityHint", { label: peer.label })}>
          <Toggle checked={p.outbound.visibility === "all"} disabled={disabled} label={t("peers.policy.visibility")} onChange={(on) => set({}, { visibility: on ? "all" : "none" })} />
        </SettingRow>
      </Section>
    </>
  );
}

function AgentsSection({ peer }: { peer: PeerView }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const r = usePeerResource(peer.id, (id) => api.peerAgents(id), false);
  const fetched = r.value?.fetchedAt ?? null;
  const stale = peer.state !== "online" && !!r.value;
  return (
    <Section title={t("peers.agents")} hint={t("peers.agentsHint")} actions={<RefreshButton onClick={() => void r.load()} disabled={r.loading} />}>
      {r.error && <ErrorNote>{r.error}</ErrorNote>}
      {!r.value && !r.error && <Loading rows={1} />}
      {r.value && (
        <p className={`pt-2 text-xs ${stale ? "text-warn" : "text-subtle"}`}>
          {stale ? (
            t("peers.agentsCached", { t: fetched ?? "—" })
          ) : (
            <>
              {t("peers.agentsFetched", { t: "" })}
              <When iso={fetched} />
            </>
          )}
        </p>
      )}
      {r.value && r.value.agents.length === 0 && <EmptyState>{t("peers.agentsNone")}</EmptyState>}
      {r.value && r.value.agents.length > 0 && <PeerAgentList peer={peer} agents={r.value.agents} />}
    </Section>
  );
}

/** Past this many, the list gets a search box and a status filter. */
const AGENTS_FILTER_FROM = 10;
const STATUS_ORDER: Record<string, number> = { busy: 0, idle: 1, offline: 2 };
type AgentFilter = "all" | "busy" | "idle" | "offline";

/** The peer's exported agents: busy first, in a scroll box; searchable past AGENTS_FILTER_FROM. */
function PeerAgentList({ peer, agents }: { peer: PeerView; agents: readonly PeerRemoteAgent[] }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");
  const many = agents.length > AGENTS_FILTER_FROM;
  const count = (st: AgentFilter) => (st === "all" ? agents.length : agents.filter((a) => a.status === st).length);
  const q = query.trim().toLowerCase();
  const shown = [...agents]
    .filter((a) => filter === "all" || a.status === filter)
    .filter((a) => !q || [a.name, a.short, a.cutexSessionId, a.runtime].some((x) => x?.toLowerCase().includes(q)))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || (a.name ?? a.short).localeCompare(b.name ?? b.short));
  return (
    <>
      {many && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2">
          <TextInput width="w-56" value={query} placeholder={t("peers.agentsSearch")} onChange={setQuery} />
          <Segmented
            value={filter}
            label={t("peers.agentsFilter")}
            options={(["all", "busy", "idle", "offline"] as const).map((st) => ({ value: st, label: `${t(st === "all" ? "peers.agentsAll" : (`peers.agent.${st}` as MessageKey))} ${count(st)}` }))}
            onChange={setFilter}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState>{t("peers.agentsNoMatch")}</EmptyState>
      ) : (
        <ul className={`py-1 ${many ? "max-h-80 overflow-y-auto" : ""}`} data-testid="peer-agents">
          {shown.map((a) => (
            <li key={a.cutexSessionId} className="flex items-center gap-2 border-b border-border py-1.5 text-sm last:border-b-0">
              {/* On this peer's own page every agent is @peer: the name alone. */}
              <PeerParty text={a.name || a.short || a.cutexSessionId} label={peer.label} size={16} />
              <span className="font-mono text-[11px] text-subtle">{a.short}</span>
              <span className="text-xs text-subtle">{a.runtime}</span>
              <span className={`ml-auto text-xs ${a.status === "busy" ? "text-accent" : a.status === "offline" ? "text-subtle" : "text-muted"}`}>
                {["idle", "busy", "offline"].includes(a.status) ? t(`peers.agent.${a.status}` as MessageKey) : a.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AuditSection({ peer }: { peer: PeerView }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const r = usePeerResource(peer.id, (id) => api.peerAudit(id, 100));
  return (
    <Section title={t("peers.audit")} hint={t("peers.auditHint")} actions={<RefreshButton onClick={() => void r.load()} disabled={r.loading} />}>
      {r.error && <ErrorNote>{r.error}</ErrorNote>}
      {!r.value && !r.error && <Loading rows={1} />}
      {r.value && r.value.length === 0 && <EmptyState>{t("peers.auditNone")}</EmptyState>}
      {r.value && r.value.length > 0 && (
        <div className="max-h-72 overflow-y-auto py-1">
          <table className="w-full table-fixed text-xs" data-testid="peer-audit">
            <thead className="text-left text-subtle">
              <tr>
                <th className="w-24 py-1 font-normal">{t("peers.audit.time")}</th>
                <th className="w-10 py-1 font-normal">{t("peers.audit.direction")}</th>
                <th className="py-1 font-normal">{t("peers.audit.route")}</th>
                <th className="w-40 py-1 font-normal">{t("peers.audit.status")}</th>
                <th className="w-14 py-1 text-right font-normal">{t("peers.audit.bytes")}</th>
              </tr>
            </thead>
            <tbody>
              {r.value.map((e, i) => (
                <tr key={`${e.ts}-${i}`} className="border-t border-border/60">
                  <td className="py-1 text-subtle tabular-nums">
                    <When iso={e.ts} />
                  </td>
                  <td className="py-1 text-muted">{e.direction === "in" || e.direction === "inbound" ? t("peers.audit.in") : e.direction === "out" || e.direction === "outbound" ? t("peers.audit.out") : e.direction}</td>
                  <td className="truncate py-1 font-mono text-[11px]" title={[e.route, e.askId].filter(Boolean).join(" · ")}>
                    {e.route}
                    {e.askId && <span className="text-subtle"> · {e.askId.slice(0, 12)}…</span>}
                  </td>
                  <td className={`truncate py-1 ${e.status >= 400 ? "text-danger" : "text-muted"}`} title={e.code ?? undefined}>
                    {e.status}
                    {e.code ? ` ${e.code}` : ""}
                  </td>
                  <td className="py-1 text-right text-subtle tabular-nums">{e.bytes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function InflightList({ asks }: { asks: AskDetail[] }) {
  const { t } = useI18n();
  return (
    <ul className="mt-1 flex flex-col gap-0.5" data-testid="peer-inflight">
      {asks.map((raw) => {
        const d = summaryFromRecord(raw);
        if (!d) return null;
        const effect = inflightEffect(raw);
        return (
          <li key={d.askId} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="shrink-0 font-mono text-[11px] text-subtle">{effect === "incomingStopped" ? "↓" : "↑"}</span>
            <span className="min-w-0 truncate text-foreground" title={d.title}>
              {d.title}
            </span>
            <span className="shrink-0 text-subtle">{t(`peers.effect.${effect}` as MessageKey)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function DeleteSection({ peer, disabled, onDeleted }: { peer: PeerView; disabled: boolean; onDeleted(): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const write = usePeerWrite();
  const inflight = usePeerResource(peer.id, (id) => api.peerInflight(id));
  const [armed, setArmed] = useArmed(peer.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const remove = async () => {
    setArmed(false);
    setBusy(true);
    setError(null);
    const r = await write(() => api.deletePeer(peer.id), setError);
    setBusy(false);
    if (r) onDeleted();
  };
  const asks = inflight.value ?? [];
  return (
    <Section title={t("peers.delete")}>
      <SettingRow label={t("peers.delete")} hint={t("peers.deleteHint")}>
        <span ref={anchor} className="inline-flex">
          {armed && !disabled ? (
            <button className={`${ARMED_FORM_BUTTON} shrink-0 whitespace-nowrap`} onClick={() => void remove()} data-testid="peer-delete-armed">
              {t("peers.delete")}
            </button>
          ) : (
            <Button disabled={disabled || busy || inflight.loading} onClick={() => setArmed(true)}>
              {t("peers.delete")}
            </Button>
          )}
        </span>
        {armed && !disabled && <ArmedHint anchor={anchor} text={t("peers.deleteArmed", { label: peer.label })} />}
      </SettingRow>
      <div className={`py-2 text-xs ${armed ? "text-danger" : "text-subtle"}`}>
        {inflight.error && <ErrorNote>{inflight.error}</ErrorNote>}
        {inflight.value && (asks.length ? t("peers.deleteInflight") : t("peers.deleteNoInflight"))}
        {asks.length > 0 && <InflightList asks={asks} />}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Section>
  );
}

export function PeerDetail({ peer, onBack, onChanged, onDeleted }: { peer: PeerView; onBack(): void; onChanged(peer: PeerView): void; onDeleted(peer: PeerView): void }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const write = usePeerWrite();
  const { readOnly } = usePeerWrites();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = readOnly || busy;
  // Enabling a peer is a root-identity action (this machine or SSH only); disabling stays open.
  const lock = useOwnerLocalLock(useTargetHostId());
  const patch = async (body: Parameters<typeof api.patchPeer>[1], quiet = false) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    const next = await write(() => api.patchPeer(peer.id, body), setError);
    setBusy(false);
    if (!next) return;
    onChanged(next);
    if (!quiet && body.policy) setSaved(t("peers.policy.saved", { n: next.policyRevision ?? 0 }));
  };
  const savePolicy = (next: PeerPolicy) => {
    const policy = policyPatch(peer.policy, next);
    if (policy) void patch({ policy });
  };
  const err = peerErrorText(peer.lastError, (key, vars) => t(key as MessageKey, vars));
  const negotiated = peer.features?.negotiated ?? [];
  const declared = peer.features?.declared ?? [];
  return (
    <>
      <button onClick={onBack} className="mb-3 flex items-center gap-1 text-xs text-muted hover:text-foreground" data-testid="peer-back">
        <ArrowLeft size={13} />
        {t("peers.back")}
      </button>
      <Section title={`${t("peers.detail.identity")} · ${peer.label}`} actions={<StateBadge peer={peer} />}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <SettingRow label={t("peers.detail.label")} hint={t("peers.detail.labelHint")}>
          <TextField
            value={peer.label}
            width="w-40"
            disabled={disabled}
            label={t("peers.detail.label")}
            onCommit={(label) => {
              if (label === peer.label) return;
              if (!PEER_LABEL.test(label)) return setError(t("peers.badLabel"));
              return patch({ label }, true);
            }}
          />
        </SettingRow>
        <SettingRow label={t("peers.enable")} hint={peer.enabled ? undefined : (lock.hint ?? t("peers.stateHint.disabled"))}>
          <Toggle checked={peer.enabled} disabled={disabled || peer.state === "removedByPeer" || (lock.locked && !peer.enabled)} label={t("peers.enable")} onChange={(enabled) => void patch({ enabled }, true)} />
        </SettingRow>
        <SettingRow label={t("peers.detail.urls")} hint={t("peers.detail.urlsHint")}>
          <UrlsEditor urls={peer.urls} disabled={disabled} onCommit={(urls) => void patch({ urls }, true)} />
        </SettingRow>
        <SettingRow label={t("peers.detail.host")}>
          <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
            {peer.hostId} · {peer.platform} · <MaskedText value={peer.id} keep={7} className="font-mono text-[11px]" copy testId="peer-instance" />
          </span>
        </SettingRow>
        <SettingRow label={t("peers.detail.state")} hint={(() => {
          const key = peer.enabled ? peer.state : "disabled";
          return t(`peers.stateHint.${key}` as MessageKey) === `peers.stateHint.${key}` ? undefined : t(`peers.stateHint.${key}` as MessageKey) || undefined;
        })()}>
          <span className="flex items-center gap-2 text-xs text-muted">
            <StateBadge peer={peer} />
            <LastSeen iso={peer.lastSeenAt} />
          </span>
        </SettingRow>
        {err && (
          <SettingRow label={t("peers.detail.lastError")}>
            <span className="max-w-96 truncate text-xs text-warn-text" title={err.title} data-testid="peer-last-error">
              {err.text}
            </span>
          </SettingRow>
        )}
        <SettingRow label={t("peers.detail.features")}>
          <span className="truncate text-xs text-muted" title={`declared: ${declared.join(", ")}\nnegotiated: ${negotiated.join(", ")}`}>
            {t("peers.detail.featuresValue", { p: peer.protocol ?? "?", n: negotiated.length })} · {t("peers.detail.policyRevision", { n: peer.policyRevision ?? 0 })}
          </span>
        </SettingRow>
        <SettingRow label={t("peers.detail.user")}>
          <span className="text-xs text-muted">{peer.userId && peer.userId !== "owner" ? peer.userId : t("peers.detail.userOwner")}</span>
        </SettingRow>
      </Section>
      {saved && <Notice tone="info">{saved}</Notice>}
      <PolicySections peer={peer} disabled={disabled} save={savePolicy} />
      <AgentsSection peer={peer} />
      <AuditSection peer={peer} />
      <DeleteSection peer={peer} disabled={readOnly} onDeleted={() => onDeleted(peer)} />
    </>
  );
}

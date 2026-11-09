// Settings → 你 → 我的设备: the devices of you, the owner, on every connected host you own; 撤销 removes one
// from each of them and says per host what happened. A host that is not connected is named, never assumed.
import { Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../../lib/contextMenu";
import { clientTokenName } from "../../lib/deviceNames";
import { useNonOwnerHosts } from "../../lib/hostAccess";
import { mergeMyDevices, type HostDevices, type MyDeviceRow } from "../../lib/myDevices";
import { daemonApiOf, useFocusHostId } from "../../lib/targetHost";
import { useHostScope } from "../../lib/useHostScope";
import { Tag } from "../Tag";
import { Button, EmptyState, ListRow, Loading, Section, SettingsGroup } from "./Form";

type Outcome = { hostLabel: string; ok: boolean };

export function MyDevicesSection() {
  const { t } = useI18n();
  const scope = useHostScope();
  const focus = useFocusHostId();
  const nonOwner = useNonOwnerHosts();
  const hosts = useMemo(() => scope.hosts.filter((look) => nonOwner[look.id]?.isOwner !== false), [scope.hosts, nonOwner]);
  const online = useMemo(() => hosts.filter((look) => look.indicator.status === "online"), [hosts]);
  const onlineKey = online.map((look) => look.id).join("\n");
  const [read, setRead] = useState<HostDevices[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ key: string; name: string; results: Outcome[] } | null>(null);
  // A reply from before a newer read is dropped.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const replies = await Promise.all(online.map(async (look) => {
      try {
        const list = await daemonApiOf(look.id, focus).users();
        const owner = list?.users.find((u) => u.isOwner);
        if (!list || !owner) return { look, devices: null };
        return { look, devices: { hostId: look.id, hostLabel: look.label, ownTokenId: look.view.tokenId ?? null, tokens: list.tokens.filter((token) => token.userId === owner.id) } };
      } catch {
        return { look, devices: null };
      }
    }));
    if (mine !== seq.current) return;
    setRead(replies.flatMap((r) => (r.devices ? [r.devices] : [])));
    setFailed(replies.flatMap((r) => (r.devices ? [] : [r.look.label])));
  }, [onlineKey, focus]); // eslint-disable-line react-hooks/exhaustive-deps -- `online` is compared by its ids
  useEffect(() => {
    void load();
  }, [load]);
  const rows = useMemo(() => mergeMyDevices(read ?? [], (token) => clientTokenName(token, t)), [read, t]);
  const offline = hosts.filter((look) => look.indicator.status !== "online").map((look) => look.label);
  const notRead = [...offline, ...failed];

  const revoke = async (row: MyDeviceRow) => {
    const names = row.on.map((place) => place.hostLabel).join(t("users.summary.sep"));
    const message = [t("shell.me.devices.revokeConfirm", { name: row.name, hosts: names }), notRead.length ? t("shell.me.devices.notRead", { hosts: notRead.join(t("users.summary.sep")) }) : null].filter(Boolean).join("\n");
    if (!(await confirmDialog(message, true, { ok: t("shell.me.devices.revokeOk"), cancel: t("settings.cancel") }))) return;
    setBusy(row.key);
    const results = await Promise.all(row.on.map(async (place) => {
      try {
        await daemonApiOf(place.hostId, focus).revokeClientToken(place.tokenId);
        return { hostLabel: place.hostLabel, ok: true };
      } catch {
        return { hostLabel: place.hostLabel, ok: false };
      }
    }));
    setBusy(null);
    setOutcome({ key: row.key, name: row.name, results });
    await load();
  };

  return (
    <Section id="my-devices" title={t("shell.me.devices.label")} hint={t("shell.me.devices.hint")}>
      {read === null && <Loading rows={2} />}
      {read !== null && rows.length === 0 && <EmptyState>{t("shell.me.devices.none")}</EmptyState>}
      {outcome && (
        <div className="-mx-4 border-b border-border px-4 py-2.5 text-xs" role="status" data-testid="my-devices-outcome">
          <div className="mb-0.5 font-medium">{t("shell.me.devices.outcome", { name: outcome.name })}</div>
          {outcome.results.map((r) => (
            <div key={r.hostLabel} className={r.ok ? "text-ok-text" : "text-danger"}>{r.hostLabel}: {t(r.ok ? "shell.me.devices.revoked" : "shell.me.devices.revokeFailed")}</div>
          ))}
          {notRead.map((label) => <div key={label} className="text-warn">{label}: {t("shell.me.devices.notRevoked")}</div>)}
        </div>
      )}
      {rows.map((row) => (
        <SettingsGroup navigation agents="none" source="local" key={row.key}><ListRow
          leading={<Smartphone size={15} className="text-muted" />}
          title={<span className="flex min-w-0 items-center gap-2"><span className="truncate">{row.name}</span>{row.own && <Tag tone="accent">{t("remoteClose.thisComputer")}</Tag>}</span>}
          detail={row.on.map((place) => place.hostLabel).join(t("users.summary.sep"))}
          actions={row.own ? undefined : <Button disabled={busy !== null} onClick={() => void revoke(row)}>{t(row.on.length > 1 ? "shell.me.devices.revokeAll" : "users.revoke")}</Button>}
        /></SettingsGroup>
      ))}
      {notRead.length > 0 && <p className="py-2.5 text-xs text-subtle" data-testid="my-devices-not-read">{t("shell.me.devices.notRead", { hosts: notRead.join(t("users.summary.sep")) })}</p>}
    </Section>
  );
}

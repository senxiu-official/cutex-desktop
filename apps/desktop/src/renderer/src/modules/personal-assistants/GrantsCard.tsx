// 权限 (owner 2026-11-25: authority is configurable per assistant). The four levels, the four operations, and the
// optional 完整主人权限. Levels and operations this host can't carry out yet (./readiness) can't be chosen (one already
// set stays shown and can be cleared); the full grant needs a native confirmation dialog (plan phase 4), so here it can
// only be revoked, never granted. Two lines say what is set (assistant, host, level, operations) and what takes effect:
// r299 hosts say it for the saved grants (`capabilityDetails`, with the reason when the assistant itself can't act);
// for a draft or an older host only what the host can carry out at most. One PATCH at the revision shown.
import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { ArmedButton } from "../../components/ArmedButton";
import { btnFace, btnShape } from "../../components/Button";
import { Tag } from "../../components/Tag";
import { Button, Checkbox, RadioList, Section, SettingRow } from "../../components/settings/Form";
import { PA_OPERATIONS, PA_TIERS, type PaGrants, type PaOperation, type PaTier, type PaView } from "../../../../shared/personalAssistants";
import { paErrorCode, STALE_CODES } from "../../lib/personalAssistants";
import { refreshAssistant, updateAssistant } from "../../lib/personalAssistantStore";
import { paErrorText } from "./paHooks";
import { grantSupport, liveGrants } from "./readiness";

const tierKey = (tier: PaTier) => `personal-assistants.grants.tier.${tier}` as MessageKey;
/** r299 reasons the assistant itself can't act (worded); others are shown as the host wrote them. */
const BINDING_REASONS = new Set(["assistant_disabled", "provisioning_in_progress", "session_missing", "session_inactive", "assistant_runtime_unsupported", "project_scope_empty"]);
const opKey = (op: PaOperation) => `personal-assistants.grants.op.${op}` as MessageKey;

export function GrantsCard({ hostId, hostLabel, view, readOnly }: { hostId: string; hostLabel: string; view: PaView; readOnly: boolean }) {
  const { t, locale } = useI18n();
  const a = view.assistant;
  const [tier, setTier] = useState<PaTier>(a.grants.tier);
  const [ops, setOps] = useState<PaOperation[]>(a.grants.operations);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [base, setBase] = useState(a.revision);
  useEffect(() => {
    if (a.revision === base) return;
    setBase(a.revision);
    setTier(a.grants.tier);
    setOps(a.grants.operations);
  }, [a, base]);
  const details = view.capabilityDetails ?? null;
  const support = grantSupport(view.capabilities, details);
  const sortedOps = PA_OPERATIONS.filter((op) => ops.includes(op));
  const changed = tier !== a.grants.tier || sortedOps.join() !== PA_OPERATIONS.filter((op) => a.grants.operations.includes(op)).join();
  const write = async (grants: PaGrants) => {
    setBusy(true);
    setNote(null);
    try {
      await updateAssistant(hostId, a, { kind: "grants", grants });
      setNote({ tone: "ok", text: t("personal-assistants.form.saved") });
    } catch (e) {
      if (STALE_CODES.has(paErrorCode(e) ?? "")) {
        await refreshAssistant(hostId, a.id).catch(() => {});
        setNote({ tone: "warn", text: t("personal-assistants.form.stale") });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  // The full grant is kept as it is (only 撤销 changes it); level and operations keep theirs when it is revoked.
  const save = () => void write({ tier, operations: sortedOps, fullOwner: a.grants.fullOwner });
  const opsText = (list: readonly PaOperation[]) => (list.length ? list.map((op) => t(opKey(op))).join(locale.startsWith("zh") ? "、" : ", ") : t("personal-assistants.grants.effectNoOps"));
  const setOpsShown = tier === "operational" ? sortedOps : [];
  const live = liveGrants(tier, sortedOps, support, details, !changed);
  const same = live.tier === tier && live.operations.join() === setOpsShown.join();
  const configured = t("personal-assistants.grants.configured", { name: a.config.name, host: hostLabel, tier: t(tierKey(tier)), ops: opsText(setOpsShown) });
  const why = live.reason ? (BINDING_REASONS.has(live.reason) ? t(`personal-assistants.grants.reason.${live.reason}` as MessageKey) : live.reason) : null;
  const liveText = live.source === "effective"
    ? same ? t("personal-assistants.grants.effectiveSame") : `${t("personal-assistants.grants.effectiveNow", { tier: t(tierKey(live.tier)), ops: opsText(live.operations) })}${why ? ` · ${why}` : ""}`
    : same ? t("personal-assistants.grants.effectiveUnknown") : t("personal-assistants.grants.effective", { tier: t(tierKey(live.tier)), ops: opsText(live.operations) });
  return (
    <div data-pa-grants="">
      <Section title={t("personal-assistants.tab.grants")} actions={<Button primary disabled={readOnly || busy || !changed} onClick={save}>{t("personal-assistants.form.save")}</Button>}>
        {note && <div className={`mb-2 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status" data-pa-grants-note={note.tone}>{note.text}</div>}
        <SettingRow agents="none" source="host" label={t("personal-assistants.grants.tier")}>
          <RadioList
            name={`pa-tier-${a.id}`}
            value={tier}
            label={t("personal-assistants.grants.tier")}
            onChange={(v) => !readOnly && setTier(v)}
            options={PA_TIERS.map((v) => {
              const off = !support.tiers.has(v);
              return { value: v, label: t(tierKey(v)), disabled: off && v !== a.grants.tier, hint: off ? `${t(`${tierKey(v)}Hint` as MessageKey)} · ${t("personal-assistants.grants.unsupported")}` : t(`${tierKey(v)}Hint` as MessageKey) };
            })}
          />
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.grants.operations")}>
          <ul className="flex flex-col gap-1" data-pa-operations="">
            {PA_OPERATIONS.map((op) => (
              <li key={op} className="flex items-center gap-2" data-pa-operation={op}>
                <Checkbox checked={ops.includes(op)} disabled={readOnly || busy || (!support.operations.has(op) && !a.grants.operations.includes(op))} label={t(opKey(op))} onChange={(on) => setOps(on ? [...ops, op] : ops.filter((o) => o !== op))} />
                <span className={`text-ui/[inherit] ${support.operations.has(op) ? "" : "text-muted"}`}>{t(opKey(op))}</span>
                {!support.operations.has(op) && !ops.includes(op) && <span className="text-caption/[inherit] text-subtle" data-pa-op-unsupported="">{t("personal-assistants.grants.unsupported")}</span>}
                {!support.operations.has(op) && ops.includes(op) && (
                  <Tag tone="neutral" title={t("personal-assistants.grants.notYetHint")} data-pa-not-yet="">
                    {t("personal-assistants.grants.notYet")}
                  </Tag>
                )}
              </li>
            ))}
          </ul>
        </SettingRow>
        <SettingRow agents="none" source="host" label={t("personal-assistants.grants.fullOwner")} hint={t("personal-assistants.grants.fullOwnerHint")}>
          {a.grants.fullOwner ? (
            <span className="flex items-center gap-2" data-pa-full-owner="on">
              <Tag tone="attention">{t("personal-assistants.grants.fullOwnerOn")}</Tag>
              <ArmedButton
                shape={btnShape({ size: "sm" })}
                idle={btnFace({ variant: "secondary" })}
                hint={t("personal-assistants.grants.revokeHint")}
                disabled={readOnly || busy}
                onConfirm={() => void write({ tier: a.grants.tier, operations: a.grants.operations, fullOwner: false })}
                testId="pa-revoke-full"
              >
                {t("personal-assistants.grants.revoke")}
              </ArmedButton>
            </span>
          ) : (
            <Tag tone="neutral" data-pa-full-owner="pending">{t("personal-assistants.grants.fullOwnerPending")}</Tag>
          )}
        </SettingRow>
        <div className="mt-2 text-caption/[inherit] text-subtle" data-pa-grants-configured="">{configured}</div>
        <div className={`text-caption/[inherit] ${same ? "text-subtle" : "text-warn"}`} data-pa-grants-effective={same ? "same" : "less"} data-pa-grants-source={live.source}>
          {liveText}
        </div>
      </Section>
    </div>
  );
}

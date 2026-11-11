// Settings → 外观 → 头像风格 (owner 2026-10-24; was 拟人头像, docs/design/040 §3.2; lib/avatarStyle): the app's default
// style — 拟人 (portrait pack themes), emoji (按模型 or ticked themes) or 字母 — in one picker (AvatarStylePicker); a
// Profile may choose its own (Settings → Profiles → 外观). Agents without an avatar of their own get a fixed one in the
// style in effect when they are created or first seen (拟人 / emoji; 字母 stores none).
// Batch (lib/avatarStyleAssign planStyleChanges, each agent's effective style = its Profile's, else the app's): agents with
// no avatar, a pack picture or an emoji — hand-picked emoji included, cutex keeps no provenance — while uploaded pictures,
// Director portraits, other icons and colours stay. 「都换成当前风格」 stores the style's pick (字母: clears), 「重新分配」
// a fresh pick within the same style. Both name the hosts and count, ask in place (medium risk) and keep one undo.
// After a pack was replaced with fewer / renamed pictures, a notice counts the agents shown with a stand-in and
// 「修复缺图」 writes the stand-ins. 打开头像包文件夹 / 重新扫描: the owner's packs in userData. The card keeps its
// `portraits` anchor (search, links).
import { useMemo, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useI18n } from "../../i18n";
import { useApp } from "../../store";
import { agentIndex } from "../../lib/agentLook";
import { effectiveAvatarStyle, getAppAvatarStyle, setAppAvatarStyle, useAvatarStyleVersion } from "../../lib/avatarStyle";
import { planStyleChanges, type StyleAgent, type StyleAvatarChange } from "../../lib/avatarStyleAssign";
import { canOpenPortraitPackFolder, fallenBack, familyMismatched, loadPortraitPacks, openPortraitPackFolder, planReassign, usePortraitPacks, type PortraitIndex } from "../../lib/portraitPacks";
import { agentsForPortraits, applyPortraitChanges, undoPortraitChanges, usePortraitUndo } from "../../lib/portraitAssign";
import { settingsAnchorId } from "../../lib/settingsNav";
import { AvatarStylePicker } from "./AvatarStylePicker";
import { SettingsRiskConfirmation } from "./SettingsRiskConfirmation";
import { Button, Notice, Section, SettingsGroup } from "./Form";

type BulkKind = "replace" | "reassign";

const resolveStyle = (a: StyleAgent) => effectiveAvatarStyle(a.hostId, a.profileId ?? null);
/** A fresh nonce per 重新分配, so a second click rerolls again. */
const freshNonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const planFor = (kind: BulkKind, index: PortraitIndex, nonce: string): StyleAvatarChange[] => planStyleChanges(index, agentsForPortraits(), resolveStyle, kind, nonce);

export function PortraitPackSection() {
  const { t } = useI18n();
  const version = useAvatarStyleVersion();
  const style = useMemo(() => getAppAvatarStyle(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const { index, dir, skipped } = usePortraitPacks();
  const undo = usePortraitUndo();
  const agentsKey = useApp((s) => agentIndex(s));
  const agents = useMemo(() => agentsForPortraits(), [agentsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const hosts = useApp((s) => s.hosts?.hosts);
  // The scope line: who 「都换成当前风格」 would change now (重新分配 covers the same agents).
  const planned = useMemo(() => planStyleChanges(index, agents, resolveStyle, "replace"), [index, agents, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rerollable = useMemo(() => planStyleChanges(index, agents, resolveStyle, "reassign", "availability"), [index, agents, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hostsOf = (changes: readonly StyleAvatarChange[]) => [...new Set(changes.map((a) => a.hostId))].map((id) => hosts?.find((h) => h.id === id)?.label ?? id).join(", ");
  const fallen = useMemo(() => fallenBack(index, agents).length, [index, agents]);
  const mismatched = useMemo(() => familyMismatched(index, agents).length, [index, agents]);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ text: string; tone: "info" | "warn" } | null>(null);
  // In-place confirmation belongs to the exact targets and before/after avatars.
  const [pending, setPending] = useState<{ kind: BulkKind; nonce: string; changes: StyleAvatarChange[] } | null>(null);
  const run = async (action: () => Promise<{ written: number; failed: number }>, done: (n: number) => string) => {
    setBusy(true);
    try {
      const { written, failed } = await action();
      setLine(failed ? { text: t("appearance.portraits.failed", { n: failed }), tone: "warn" } : { text: done(written), tone: "info" });
    } finally {
      setBusy(false);
    }
  };
  const ask = (kind: BulkKind) => {
    const nonce = freshNonce();
    const changes = planFor(kind, index, nonce);
    setLine(null);
    setPending(changes.length ? { kind, nonce, changes } : null);
  };
  const confirm = () => {
    if (!pending) return;
    const { kind, nonce } = pending;
    const changes = planFor(kind, index, nonce);
    if (JSON.stringify(changes) !== JSON.stringify(pending.changes)) { setPending(null); return; }
    setPending(null);
    void run(() => applyPortraitChanges(kind, changes), (n) => t(kind === "replace" ? "appearance.portraits.replaced" : "appearance.portraits.reassigned", { n }));
  };
  const canOpen = canOpenPortraitPackFolder();
  // Two cards: the style is this desktop's, the bulk changes write every host's agents, so each card names its own place.
  return (<>
    <Section
      id={settingsAnchorId("portraits")}
      title={t("avatarStyle.title")}

      hint={t("avatarStyle.hint")}
      actions={
        canOpen ? (
          <>
            <SettingsGroup navigation agents="none" source="local"><Button onClick={() => void openPortraitPackFolder()} title={dir ?? undefined}><FolderOpen size={13} className="mr-1 inline" />{t("appearance.portraits.openFolder")}</Button></SettingsGroup>
            <SettingsGroup agents="none" source="local"><Button onClick={() => void loadPortraitPacks(true)}><RefreshCw size={13} className="mr-1 inline" />{t("appearance.portraits.rescan")}</Button></SettingsGroup>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3 py-2" data-portrait-settings data-avatar-style-settings="">
        <SettingsGroup agents="none" source="local"><AvatarStylePicker value={style} onChange={(next) => next && setAppAvatarStyle(next)} /></SettingsGroup>
      </div>
    </Section>
    <Section id={settingsAnchorId("portraits-bulk")} title={t("avatarStyle.bulk.title")} hint={<span role="note" data-portrait-bulk-scope="">{t("settings.ia.bulkScope", { hosts: hostsOf(planned) || "—", n: planned.length })}</span>}>
      <div className="space-y-3 py-3" data-portrait-bulk="">
        {(fallen > 0 || mismatched > 0) && (
          <div className="flex flex-wrap items-center gap-2" data-portrait-fallen={fallen} data-portrait-mismatched={mismatched}>
            {fallen > 0 && <Notice tone="info">{t("appearance.portraits.fallen", { n: fallen })}</Notice>}
            {mismatched > 0 && <Notice>{t("appearance.portraits.mismatched", { n: mismatched })}</Notice>}
            <SettingsGroup agents="none" source="host" allHosts><Button disabled={busy} onClick={() => void run(() => applyPortraitChanges("reassign", planReassign(index, agentsForPortraits())), (n) => t("appearance.portraits.reassigned", { n }))}>
              {t("avatarStyle.bulk.repair")}
            </Button></SettingsGroup>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SettingsGroup agents="none" source="host" allHosts><Button disabled={busy || !planned.length} onClick={() => ask("replace")}>{t("avatarStyle.bulk.replaceAll")}</Button></SettingsGroup>
          <SettingsGroup agents="none" source="host" allHosts><Button disabled={busy || !rerollable.length} onClick={() => ask("reassign")}>{t("avatarStyle.bulk.reassign")}</Button></SettingsGroup>
          {undo && (
            <SettingsGroup agents="none" source="host" allHosts><Button disabled={busy} onClick={() => void run(undoPortraitChanges, (n) => t("appearance.portraits.undone", { n }))}>
              {t(undo.kind === "replace" ? "appearance.portraits.undoReplace" : "appearance.portraits.undoReassign", { n: undo.changes.length })}
            </Button></SettingsGroup>
          )}
        </div>
        {pending && (
          <div data-style-bulk-confirm={pending.kind}>
            <SettingsGroup agents="none" source="host" allHosts><SettingsRiskConfirmation
              message={t(pending.kind === "replace" ? "avatarStyle.bulk.confirmReplace" : "avatarStyle.bulk.confirmReassign", { hosts: hostsOf(pending.changes) || "—", n: pending.changes.length })}
              valid={() => JSON.stringify(planFor(pending.kind, index, pending.nonce)) === JSON.stringify(pending.changes)}
              busy={busy}
              confirmLabel={t("avatarStyle.bulk.confirm")}
              onConfirm={confirm}
              onCancel={() => setPending(null)}
            /></SettingsGroup>
          </div>
        )}
        <p className="text-caption/[inherit] text-subtle">{t("avatarStyle.bulk.replaceHint")} {t("avatarStyle.bulk.reassignHint")}</p>
        {line && <Notice tone={line.tone}>{line.text}</Notice>}
        {skipped > 0 && <Notice tone="info">{t("appearance.portraits.skipped", { n: skipped })}</Notice>}
      </div>
    </Section>
  </>);
}

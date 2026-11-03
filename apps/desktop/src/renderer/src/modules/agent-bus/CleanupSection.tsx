// Settings → 协作 → 高级 → 待清理 (owner 2026-10-30): everything on the host that is stuck and can be
// cleaned up by hand, in one card — 停滞的委托 (cutex asks), 卡住的消息 (cutex agent-bus-stuck-messages)
// and 已隐藏的回执 (this desktop's hidden 接下来 rows). Each category starts collapsed with its count;
// open, it is a compact table whose rows open their details. Every cleanup is a cutex route (or, for
// hidden rows, this desktop's own display state); nothing is cleaned on a timer or faked locally.
// One age filter (stored on this device) applies to delegations and messages.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { STUCK_MESSAGES_FEATURE } from "../../../../shared/agentBusStuck";
import { RefreshButton, Section, Select, SettingsGroup } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useHiddenReceiptsOf } from "../../lib/legacyDelivery/busReceiptVisibility";
import { useCleanupFocus, type CleanupCategory } from "../../lib/cleanupNav";
import { ASKS_FEATURE } from "../../lib/delegations";
import { FIELD_W } from "../../lib/fieldWidths";
import { useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { HiddenReceiptsTable } from "./HiddenReceiptsTable";
import { StaleDelegationsTable } from "./StaleDelegationsTable";
import { DiscardAllButton, StuckMessagesTable } from "./StuckMessagesTable";
import { MIN_AGE_CHOICES, minAgeKey } from "./stuck";
import { useCleanupMinAge, useStaleDelegations, useTargetAgentNames } from "./useCleanup";
import { useStuckMessages } from "./useStuckMessages";

export function CleanupSection() {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const hostId = useTargetHostId();
  const [minAge, setMinAge] = useCleanupMinAge();
  const stuckOn = features.has(STUCK_MESSAGES_FEATURE);
  const asksOn = features.has(ASKS_FEATURE);
  const stuck = useStuckMessages(minAge, stuckOn);
  const delegations = useStaleDelegations(minAge, asksOn);
  const receipts = useHiddenReceiptsOf(hostId);
  const nameOf = useTargetAgentNames();
  const [open, setOpen] = useState<ReadonlySet<CleanupCategory>>(new Set());
  const toggle = (c: CleanupCategory) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(c)) next.add(c);
      return next;
    });
  // A link (接下来's menu: lib/cleanupNav openCleanup) opens its category.
  const focus = useCleanupFocus();
  useEffect(() => {
    if (!focus.category) return;
    const category = focus.category;
    setOpen((s) => new Set(s).add(category));
    useCleanupFocus.setState({ category: null });
  }, [focus]);
  const working = stuck.busy.size > 0 || stuck.bulk !== null || delegations.busy.size > 0;
  const minAgeOptions = MIN_AGE_CHOICES.map((secs) => ({ value: String(secs), label: t(`agent-bus.stuck.minAge.${minAgeKey(secs)}` as MessageKey) }));
  return (
    <Section
      title={t("agent-bus.cleanup.title")}
      hint={t("agent-bus.cleanup.hint")}
      actions={
        <>
          {/* A view filter (localStorage), not a setting. */}
          <div role="search" className="contents">
            <Select value={String(minAge)} options={minAgeOptions} width={FIELD_W.short} label={t("agent-bus.stuck.minAge")} disabled={stuck.bulk !== null} onChange={(v) => setMinAge(Number(v))} />
          </div>
          <RefreshButton disabled={stuck.loading || delegations.loading || working} onClick={() => void Promise.all([stuckOn && stuck.refresh(), asksOn && delegations.refresh()])} />
        </>
      }
    >
      <SettingsGroup agents="now" source="host">
        {asksOn && (
          <Category id="delegations" title={t("agent-bus.cleanup.delegations")} count={delegations.rows?.length ?? null} open={open.has("delegations")} onToggle={() => toggle("delegations")}>
            <StaleDelegationsTable state={delegations} minAge={minAge} nameOf={nameOf} />
          </Category>
        )}
        {stuckOn && (
          <Category id="messages" title={t("agent-bus.stuck.title")} count={stuck.view ? stuck.view.total : null} open={open.has("messages")} onToggle={() => toggle("messages")} actions={<DiscardAllButton state={stuck} />}>
            <StuckMessagesTable state={stuck} minAge={minAge} />
          </Category>
        )}
        <Category id="receipts" title={t("agent-bus.cleanup.receipts")} count={receipts.length} open={open.has("receipts")} onToggle={() => toggle("receipts")}>
          <HiddenReceiptsTable hostId={hostId} rows={receipts} nameOf={nameOf} />
        </Category>
      </SettingsGroup>
    </Section>
  );
}

/** One category: a header line (chevron, title, count; its bulk action while open) over its table. */
function Category({ id, title, count, open, onToggle, actions, children }: { id: CleanupCategory; title: string; count: number | null; open: boolean; onToggle(): void; actions?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="-mx-4 border-b border-border px-4 last:border-b-0" data-testid={`cleanup-${id}`}>
      <div className="flex min-h-9 items-center gap-2">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left text-sm hover:text-foreground">
          {open ? <ChevronDown size={14} className="shrink-0 text-subtle" /> : <ChevronRight size={14} className="shrink-0 text-subtle" />}
          <span className="min-w-0 truncate">{title}</span>
          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-xs text-subtle tabular-nums" data-testid={`cleanup-${id}-count`} aria-label={count === null ? t("agent-bus.cleanup.counting") : undefined}>
            {count ?? "…"}
          </span>
        </button>
        {open && actions}
      </div>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

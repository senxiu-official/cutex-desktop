// Settings → Profiles overview: one roomy card per profile (people keep a handful, not dozens);
// click → its detail page.
//   [avatar + provider mark]  name · 默认 · ⚠ problems                     agents in use · ⋯
//                             kind · plan   │ 模型  glm-5 · high · 256K
//                                           │ 行为  可中途切换 · 需我批准      (narrow card: model joins line 2)
//   ───────────────────────────────────────────────────────────────────────────────────────
//   5h ▬▬▬▬▬▬▬▬ 62%  2h17m      7d ▬▬▬ 18%  2d21h       (two a row; balances as text)
// The 模型 value is a button when the default model can be changed here (lib/profileDefaultModel):
// it opens the profile's model list (+ 推理强度) and saves the pick at once.
// Every part always takes its height, so a card never grows when its quota arrives.
// Width breakpoints come from lib/sizeFlags (`data-md` / `data-lg` / `data-wide` on the card,
// `group-data-[…]/profile:`), not from a CSS size container: a quota refresh re-renders every card
// in one commit, the pattern that left Chromium size containers' children without layout boxes.
import type { KeyboardEvent, MouseEvent } from "react";
import { MoreHorizontal, Users } from "lucide-react";
import type { ProfileItem, QuotaGauge } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_BUTTON, ARMED_FRAME } from "../../lib/armedConfirm";
import { openMenuFrom } from "../../lib/contextMenu";
import { useUiPrefs } from "../../lib/prefs";
import { useModelName } from "../../lib/modelDisplay";
import { contextLabel, profileKindLabel, profileProblems, profileRules } from "../../lib/profileCards";
import { cachedProfile } from "../../lib/profileSnapshot";
import { useProfilePresets } from "../../lib/useProfilePresets";
import { sessionsUsingProfile } from "../../lib/profileKind";
import { formatBalance, gaugeShortLabel, quotaFill, quotaTextKey, resetsInCompact, type QuotaView } from "../../lib/quota";
import { profileColor } from "../../lib/profileLook";
import { dataFlags, useSizeFlags, widthAtLeast } from "../../lib/sizeFlags";
import { Avatar } from "../Avatar";
import { GaugeBar } from "../GaugeBar";
import { ProfileAvatar } from "../ProfileAvatar";
import { useTargetHostId, useTargetQuotas, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";

/** Agent pictures shown before the count. */
const STACK = 4;

/** Card widths (content box): gauges two a row (28rem), reset times (32rem), the middle 模型 / 行为 column (34rem). */
const CARD_SIZES = { md: widthAtLeast(28), lg: widthAtLeast(32), wide: widthAtLeast(34) } as const;

function CardGauge({ gauge: g, view }: { gauge: QuotaGauge; view: QuotaView }) {
  const { t } = useI18n();
  const fill = quotaFill(g, view);
  const reset = resetsInCompact(g.resetAt);
  return (
    <span className={`flex h-5 min-w-0 items-center gap-2 tabular-nums ${g.stale ? "opacity-60" : ""}`} title={g.error ?? undefined}>
      <span className="w-14 shrink-0 truncate text-subtle" title={gaugeShortLabel(g)}>{gaugeShortLabel(g)}</span>
      {g.kind === "balance" ? (
        <span className="text-foreground">{formatBalance(g.balance)}</span>
      ) : fill === null ? (
        <span className="text-muted">—</span>
      ) : (
        <>
          <GaugeBar ratio={fill} view={view} className="h-1.5 min-w-10 flex-1" />
          <span className="min-w-9 shrink-0 text-right text-foreground">{t(quotaTextKey(view), { percent: Math.round(fill * 100) })}</span>
          <span className="hidden w-10 shrink-0 text-subtle group-data-[lg]/profile:inline">{reset}</span>
        </>
      )}
      {g.error && <span className="text-danger">!</span>}
    </span>
  );
}

export function ProfileCard({ item, isDefault, armed, deleting, onOpen, onMenu, onConfirmDelete, onModelMenu }: {
  item: ProfileItem;
  isDefault: boolean;
  /** Delete armed (lib/armedConfirm): red frame, the ⋯ turns into the confirming button. */
  armed: boolean;
  deleting: boolean;
  onOpen(): void;
  /** ⋯ button (anchored) or right-click (at the pointer). */
  onMenu(at: { el: HTMLElement } | { x: number; y: number }): void;
  onConfirmDelete(): void;
  /** Default-model picker anchored at the 模型 value; absent = the value is read-only. */
  onModelMenu?(el: HTMLElement): void;
}) {
  const { t } = useI18n();
  const gauges = useTargetQuotas()[item.name];
  const targetHost = useTargetHostId();
  const sidebar = useTargetSidebar();
  const select = useTargetSelect();
  const view = useUiPrefs().quotaView;
  const presets = useProfilePresets();
  const problems = profileProblems(item, gauges);
  const agents = sessionsUsingProfile(sidebar?.active ?? [], item);
  const kindLine = [profileKindLabel(item, t("agent-config.profile.preset.custom"), presets), item.planLabel].filter(Boolean).join(" · ");
  const modelName = useModelName();
  // The default model under its display name (Settings → 通用 → 模型显示名); the tooltip keeps the raw id.
  const modelShown = item.model ? modelName(item.model, null, item.id) : null;
  const model = [modelShown, item.modelReasoningEffort, contextLabel(item.modelContextWindow)].filter(Boolean).join(" · ");
  const modelTitle = item.model && modelShown !== item.model ? `${model} (${item.model})` : model;
  const rules = profileRules(item, cachedProfile(item.name, targetHost)?.detail ?? null).map((r) => t(`settings.profile.rule.${r}` as MessageKey));
  const [sizeRef, size] = useSizeFlags(CARD_SIZES);
  const stop = (e: MouseEvent) => e.stopPropagation();
  const onKey = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) (e.preventDefault(), onOpen());
  };
  return (
    <div
      ref={sizeRef}
      {...dataFlags(size)}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      onContextMenu={(e) => (e.preventDefault(), onMenu({ x: e.clientX, y: e.clientY }))}
      className={`group/profile cursor-pointer rounded-xl border outline-none focus-visible:border-accent ${armed ? ARMED_FRAME : "border-border bg-surface hover:border-foreground/20"}`}
    >
      <div className="flex items-center gap-3.5 px-4 pt-4 pb-3.5">
        <ProfileAvatar profile={item} size={44} badge />
        <div className="min-w-0 flex-1 group-data-[wide]/profile:max-w-52">
          <div className="flex h-6 items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold">{item.name}</span>
            {isDefault && <span className="shrink-0 rounded-full bg-accent/15 px-2 text-[11px] leading-5 text-accent">{t("agent-config.profile.default")}</span>}
            {problems.map((p) => (
              <span key={p} className="shrink-0 truncate text-xs text-warn">⚠ {t(`agent-config.profile.problem.${p}` as MessageKey)}</span>
            ))}
          </div>
          <div className="mt-0.5 truncate text-xs text-subtle" title={kindLine}>
            {kindLine}
            {/* narrow card: no middle column, the model joins this line */}
            {model && <span className="group-data-[wide]/profile:hidden"> · {model}</span>}
          </div>
        </div>
        {/* middle: what a new agent on this profile starts with */}
        <dl className="hidden min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-l border-border pl-4 text-xs group-data-[wide]/profile:grid">
          <dt className="text-subtle">{t("settings.profile.card.model")}</dt>
          <dd className="min-w-0 truncate font-mono text-muted" title={onModelMenu ? undefined : modelTitle}>
            {onModelMenu ? (
              <button
                type="button"
                data-profile-model-picker
                title={`${modelTitle} — ${t("settings.profile.card.modelPick")}`}
                onClick={(e) => (stop(e), onModelMenu(e.currentTarget))}
                onKeyDown={(e) => e.stopPropagation()}
                className="max-w-full truncate rounded px-1 -mx-1 text-left hover:bg-surface-2 hover:text-foreground"
              >
                {model || "—"}
              </button>
            ) : (
              model || "—"
            )}
          </dd>
          <dt className="text-subtle">{t("settings.profile.card.rules")}</dt>
          <dd className="truncate text-muted" title={rules.join(" · ")}>{rules.length ? rules.join(" · ") : "—"}</dd>
        </dl>
        <span className="flex shrink-0 items-center gap-1 self-start">
          {armed ? (
            <>
              <span className="text-xs text-danger">{t("agent-config.profile.deleteArmed")}</span>
              <button disabled={deleting} onClick={(e) => (stop(e), onConfirmDelete())} className={ARMED_BUTTON}>
                {t("agent-config.profile.delete")}
              </button>
            </>
          ) : (
            <>
              <button
                disabled={agents.length === 0}
                title={t("agent-config.profile.agentsUsing", { n: agents.length })}
                onClick={(e) => {
                  stop(e);
                  openMenuFrom(e.currentTarget, agents.map((a) => ({ label: a.displayName, onSelect: () => void select(a.cutexSessionId) })));
                }}
                className="flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 text-xs text-muted tabular-nums hover:bg-surface-2 hover:text-foreground disabled:text-subtle disabled:hover:bg-transparent"
              >
                {agents.length === 0 ? (
                  <Users size={13} strokeWidth={1.75} />
                ) : (
                  <span className="mr-0.5 flex">
                    {agents.slice(0, STACK).map((a) => (
                      <span key={a.cutexSessionId} className="-ml-1.5 rounded-full ring-2 ring-surface first:ml-0">
                        <Avatar name={a.displayName} avatar={a.avatar} seed={a.cutexSessionId} color={profileColor(item)} size={20} minor />
                      </span>
                    ))}
                  </span>
                )}
                {agents.length}
              </button>
              <button title={t("agent-config.profile.more")} onClick={(e) => (stop(e), onMenu({ el: e.currentTarget }))} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground">
                <MoreHorizontal size={16} />
              </button>
            </>
          )}
        </span>
      </div>
      {/* Two gauges a row (Claude can have 5h / 7d / Opus 7d / credits: two rows). */}
      <div className="grid min-h-10 grid-cols-1 content-center gap-x-8 gap-y-2 border-t border-border px-4 py-2.5 text-xs group-data-[md]/profile:grid-cols-2">
        {gauges === undefined ? null : gauges.length ? (
          gauges.map((g) => <CardGauge key={g.id} gauge={g} view={view} />)
        ) : (
          <span className="col-span-full text-subtle">{t("settings.profile.noQuota")}</span>
        )}
      </div>
    </div>
  );
}

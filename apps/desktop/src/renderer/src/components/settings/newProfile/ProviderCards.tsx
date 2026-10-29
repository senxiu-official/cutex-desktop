// 新建 Profile step ①: one card per provider (lib/newProfileModel providerCards), then — once one is
// chosen — a single header line with 「换服务商」.
import { useI18n } from "../../../i18n";
import { Ellipsis, Settings2 } from "lucide-react";
import type { Provider } from "../../../lib/provider";
import type { ProviderCard, ProviderCardId } from "../../../lib/newProfileModel";
import { cardChips, cardLabel, cardRuntimes } from "../../../lib/newProfileText";
import { CreationRuntimeTag } from "../../CreationRuntimeTag";
import { Tag } from "../../Tag";
import { ProviderIcon } from "../../ProviderIcon";

/** Display marks only; provider-card ids remain the preset/auth routing keys. */
const BRAND: Record<Exclude<ProviderCardId, "more" | "custom">, Provider> = {
  openai: "codex", anthropic: "claude", deepseek: "deepseek", kimi: "kimi", glm: "glm", gemini: "gemini",
};

function ProviderMark({ id }: { id: ProviderCardId }) {
  const Neutral = id === "more" ? Ellipsis : Settings2;
  return (
    <span aria-hidden className={`inline-flex size-[22px] flex-none items-center justify-center text-foreground ${id === "kimi" ? "rounded-md bg-[#16191e]" : ""}`} data-provider-mark={id}>
      {id === "more" || id === "custom" ? <Neutral size={22} strokeWidth={1.75} /> : <ProviderIcon provider={BRAND[id]} name={BRAND[id]} size={id === "kimi" ? 18 : 22} />}
    </span>
  );
}

export function ProviderCards({ cards, onPick, disabled }: { cards: readonly ProviderCard[]; onPick(card: ProviderCard): void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-4 gap-2.5 pb-2 group-data-[narrow]/card:grid-cols-2" data-provider-cards="">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          disabled={disabled}
          data-provider-card={card.id}
          onClick={() => onPick(card)}
          className="flex min-h-24 flex-col items-start rounded-inner bg-background p-2.5 text-left ring-1 ring-border outline-none hover:ring-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ProviderMark id={card.id} />
            {cardLabel(t, card)}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            {card.runtimes.includes("kimi") && <CreationRuntimeTag runtime="kimi" />}
            {cardChips(t, card).map((chip) => (
              <Tag key={chip}>{chip}</Tag>
            ))}
          </span>
          <span className="mt-1.5 text-caption text-subtle">{cardRuntimes(t, card)}</span>
        </button>
      ))}
    </div>
  );
}

/** The chosen provider, with the way back to the cards. */
export function ProviderHeader({ card, onChange, disabled }: { card: ProviderCard; onChange(): void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3" data-provider-chosen={card.id}>
      <span className="text-sm">{t("newProfile.step.provider")}</span>
      <span className="flex items-center gap-2">
        <ProviderMark id={card.id} />
        <span className="text-sm font-semibold">{cardLabel(t, card)}</span>
        {card.runtimes.includes("kimi") && <CreationRuntimeTag runtime="kimi" />}
        <button type="button" disabled={disabled} onClick={onChange} className="rounded text-xs text-accent hover:underline disabled:opacity-50">
          {t("newProfile.changeProvider")}
        </button>
      </span>
    </div>
  );
}

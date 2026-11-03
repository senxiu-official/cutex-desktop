// Model picker in the composer row: the profile's pinned models up front (number keys 1–9), the
// rest in a "More models" flyout, like Claude. Pins are per host and profile; hover a row to pin / unpin.
// The composer uses it as the combined "profile / model" chip: `trigger` shows both and `header`
// puts the profile section above the model list (ZCode-style merged chip).
// Row names go through the model display-name rules (lib/modelDisplay); values stay the raw ids.
import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Pin, PinOff } from "lucide-react";
import type { ModelOption } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { pinsFor, splitPinned, togglePinned, withPins } from "../lib/models";
import { rawIdTitle, useModelName } from "../lib/modelDisplay";
import { getUiPrefs, setUiPref, useUiPrefs } from "../lib/prefs";
import { Popover } from "./Menu";
import { MenuFlyout } from "./MenuFlyout";
import { useComposerHost } from "../lib/targetHost";

/** `primary` (a folded Claude list, lib/claudeModels): without pins, the primary rows are up front. */
type Item = Pick<ModelOption, "model" | "displayName" | "description"> & { primary?: boolean };

/** `note`: a line under the title (e.g. the agent's runtime is offline: no model list to show yet). */
export function ModelPicker({ profile, models, current, label, trigger, triggerTitle, header, note, unavailable = false, onOpen, onSelect, openSignal }: { profile: string | null; models: Item[]; current: string | null; label: string; trigger?: ReactNode; triggerTitle?: string; header?: (close: () => void) => ReactNode; note?: string; unavailable?: boolean; onOpen(): void; onSelect(model: string): void; openSignal?: number }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const key = profile ?? "";
  // Pins are per host: the open agent's.
  const hostId = useComposerHost();
  const pins = pinsFor(useUiPrefs().modelPins, hostId, key);
  const primaries = models.some((m) => m.primary !== undefined) ? models.filter((m) => m.primary).length : undefined;
  const { pinned, rest } = splitPinned(models, pins, primaries);
  const [more, setMore] = useState(false);
  const toggle = (model: string) => setUiPref("modelPins", withPins(getUiPrefs().modelPins, hostId, key, togglePinned(models, pins, model, primaries)));

  const row = (m: Item, close: () => void, index: number | null) => {
    const isPinned = pinned.includes(m as never);
    const shown = modelName(m.model, m.displayName, profile);
    return (
      <div key={m.model} className="group flex items-center rounded-lg hover:bg-surface-2">
        <button
          onClick={() => {
            onSelect(m.model);
            close();
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className={`block text-sm ${index === null ? "[overflow-wrap:anywhere]" : "truncate"}`} title={rawIdTitle(m.model, shown)}>{shown}</span>
            {m.description && <span className="block text-xs text-subtle">{m.description}</span>}
          </span>
          <span className="w-3 text-xs text-accent">{m.model === current ? "✓" : ""}</span>
          {index !== null && <span className="w-3 text-right text-xs text-subtle group-hover:hidden">{index < 9 ? index + 1 : ""}</span>}
        </button>
        <button
          onClick={() => toggle(m.model)}
          title={t(isPinned ? "composer.model.unpin" : "composer.model.pin")}
          className={`mr-1.5 rounded p-1 text-subtle hover:text-foreground ${index !== null ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100"}`}
        >
          {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </div>
    );
  };

  return (
    <Popover
      align="right"
      width="w-80"
      openSignal={openSignal}
      onOpen={() => {
        setMore(false);
        onOpen();
      }}
      trigger={<span className={unavailable ? "inline-flex min-w-0 items-center gap-1 text-warn" : "contents"} data-model-unlisted={unavailable ? "" : undefined}>
        {unavailable && <AlertTriangle size={12} className="shrink-0" />}{trigger ?? <span>{label}</span>}
        {unavailable && <span className="sr-only">{t("composer.model.chooseAvailable")}</span>}
      </span>}
      triggerTitle={unavailable ? `${t("composer.model.unlisted")}\n${t("composer.model.chooseAvailable")}` : triggerTitle}
      triggerLabel={unavailable ? t("composer.model.chooseAvailable") : undefined}
      onKey={(e, close) => {
        if (!/^[1-9]$/.test(e.key)) return false;
        const m = pinned[Number(e.key) - 1];
        if (!m) return false;
        onSelect(m.model);
        close();
        return true;
      }}
    >
      {(close) => (
        <>
          {header?.(close)}
          {unavailable && current && <div data-model-unavailable aria-disabled="true" className="mb-1 border-b border-border px-2.5 py-2 text-warn" title={t("composer.model.unlisted")}>
            <span className="block break-all text-sm">{current}</span>
            <span className="block text-xs">{t("composer.model.unavailable")}</span>
          </div>}
          <div className="px-2.5 pt-1.5 pb-1 text-xs text-subtle">{t("composer.modelTitle")}</div>
          {pinned.map((m, i) => row(m, close, i))}
          {note && <p className="px-2.5 py-1.5 text-xs text-subtle" data-model-note="">{note}</p>}
          {pinned.length === 0 && !(note && models.length === 0) && <p className="px-2.5 py-1.5 text-xs text-subtle">{t("composer.model.noPins")}</p>}
          {rest.length > 0 && (
            <div className="relative mt-1 border-t border-border pt-1" onMouseEnter={() => setMore(true)} onMouseLeave={() => setMore(false)}>
              <button onClick={() => setMore(!more)} className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 ${more ? "bg-surface-2" : ""}`}>
                <span className="flex-1">{t("composer.model.more")}</span>
                <span className="mr-1 text-xs text-subtle">{rest.length}</span>
                <ChevronRight size={14} className="text-subtle" />
              </button>
              {more && (
                <MenuFlyout align="bottom" className="w-80">{rest.map((m) => row(m, close, null))}</MenuFlyout>
              )}
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

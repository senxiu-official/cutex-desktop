// Model picker in the composer row: the profile's pinned models up front (number keys 1–9), the
// rest in a "More models" flyout, like Claude. Pins are per host and profile; hover a row to pin / unpin.
// The composer uses it as the combined "profile / model" chip: `trigger` shows both and `header`
// puts the profile section above the model list (ZCode-style merged chip).
// Row names go through the model display-name rules (lib/modelDisplay); values stay the raw ids.
import { useState, type ReactNode } from "react";
import { ChevronRight, Pin, PinOff } from "lucide-react";
import type { ModelOption } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { pinsFor, splitPinned, togglePinned, withPins } from "../lib/models";
import { rawIdTitle, useModelName } from "../lib/modelDisplay";
import { getUiPrefs, setUiPref, useUiPrefs } from "../lib/prefs";
import { Popover } from "./Menu";
import { useComposerHost } from "../lib/targetHost";

type Item = Pick<ModelOption, "model" | "displayName" | "description">;

/** `note`: a line under the title (e.g. the agent's runtime is offline: no model list to show yet). */
export function ModelPicker({ profile, models, current, label, trigger, triggerTitle, header, note, onOpen, onSelect, openSignal }: { profile: string | null; models: Item[]; current: string | null; label: string; trigger?: ReactNode; triggerTitle?: string; header?: (close: () => void) => ReactNode; note?: string; onOpen(): void; onSelect(model: string): void; openSignal?: number }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const key = profile ?? "";
  // Pins are per host: the open agent's.
  const hostId = useComposerHost();
  const pins = pinsFor(useUiPrefs().modelPins, hostId, key);
  const { pinned, rest } = splitPinned(models, pins);
  const [more, setMore] = useState(false);
  const toggle = (model: string) => setUiPref("modelPins", withPins(getUiPrefs().modelPins, hostId, key, togglePinned(models, pins, model)));

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
            <span className="block truncate text-sm" title={rawIdTitle(m.model, shown)}>{shown}</span>
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
      overflowVisible
      openSignal={openSignal}
      onOpen={() => {
        setMore(false);
        onOpen();
      }}
      trigger={trigger ?? <span>{label}</span>}
      triggerTitle={triggerTitle}
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
                // Padding (not margin) bridges the gap so the pointer can travel into the flyout.
                <div className="absolute right-full bottom-0 pr-1">
                  <div className="max-h-96 w-80 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl">{rest.map((m) => row(m, close, null))}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

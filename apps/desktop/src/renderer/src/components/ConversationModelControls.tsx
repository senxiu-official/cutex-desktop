import { useState, type ComponentProps } from "react";
import { Zap } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import type { AgentFeatures } from "../lib/agentFeatures";
import { isAcpRuntime } from "../lib/acpRuntimes";
import { ModelPicker } from "./ModelPicker";
import { Popover } from "./Menu";
import { Toggle } from "./settings/Form";

/** Click or drag along the track; the filled part runs up to the thumb. Commits on release. */
function EffortTrack({ efforts, index, label, onCommit }: { efforts: string[]; index: number; label(e: string): string; onCommit(i: number): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const n = efforts.length;
  const shown = drag ?? index;
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const center = (i: number) => `${((i + 0.5) / n) * 100}%`;
  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={shown}
      aria-valuetext={efforts[shown] ? label(efforts[shown]!) : undefined}
      className="relative h-7 cursor-pointer touch-none rounded-lg bg-surface-2 select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(at(e))}
      onPointerUp={(e) => {
        const i = at(e);
        setDrag(null);
        onCommit(i);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="absolute inset-y-0 left-0 rounded-lg bg-accent/25 transition-[width] duration-100" style={{ width: `calc(${center(shown)} + 8px)` }} />
      {efforts.map((e, i) => (
        <span key={e} title={label(e)} className={`absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${i < shown ? "bg-accent" : "bg-subtle"}`} style={{ left: center(i) }} />
      ))}
      <span className="absolute top-1/2 h-5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-md bg-accent shadow transition-[left] duration-100" style={{ left: center(shown) }} />
    </div>
  );
}

/** Fast mode in the effort popover (cutex session-fast-mode); absent = the model / host has none. */
export interface FastModeControl {
  on: boolean;
  onToggle(on: boolean): void;
}

/**
 * `offline`: the agent's runtime is not running — nothing to read the effort from or send it to; the
 * chip shows "—" instead of a loading "…" and the panel says to start the runtime first.
 */
export function EffortPicker({ effort, efforts, onChange, fast, offline, empty, onOpen }: { effort: string | null; efforts: string[]; onChange(e: string): void; fast?: FastModeControl; offline?: string; /** Why `efforts` is empty (shown instead of the track). */ empty?: string; onOpen?(): void }) {
  const { t } = useI18n();
  // Localized name when we have one, else the model's raw value (models add new levels, e.g. "ultra").
  const label = (e: string) => {
    const key = `composer.effort.${e}`;
    const text = t(key as MessageKey);
    return text === key ? e : text;
  };
  const index = Math.max(0, efforts.indexOf(effort ?? ""));
  const step = (delta: number) => {
    const next = efforts[Math.min(efforts.length - 1, Math.max(0, index + delta))];
    if (next && next !== effort) onChange(next);
  };
  return (
    <Popover
      align="right"
      width="w-80"
      onOpen={onOpen}
      trigger={
        <span className="trim-cap inline-flex items-center gap-0.5" title={fast?.on ? t("composer.fast.on") : undefined}>
          {fast?.on && <Zap size={12} className="shrink-0 fill-current text-warn" aria-label={t("composer.fast.on")} />}
          {effort ? label(effort) : offline ? "—" : "…"}
        </span>
      }
      onKey={(e) => {
        if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
        else return false;
        return true;
      }}
    >
      {() => (
        <div className="space-y-3 p-3">
          <div className="text-sm">
            <span className="text-subtle">{t("composer.effortTitle")}</span> <span className="font-medium">{effort ? label(effort) : ""}</span>
            {effort && label(effort) !== effort && <span className="ml-1.5 font-mono text-xs text-subtle">{effort}</span>}
          </div>
          {efforts.length > 0 ? (
            <>
              <div className="flex justify-between text-xs text-subtle">
                <span>{t("composer.effort.faster")}</span>
                <span>{t("composer.effort.smarter")}</span>
              </div>
              <EffortTrack efforts={efforts} index={index} label={label} onCommit={(i) => efforts[i] && efforts[i] !== effort && onChange(efforts[i]!)} />
              <div className="flex text-caption/[inherit] text-subtle">
                {efforts.map((e) => (
                  <span key={e} className={`flex-1 text-center ${e === effort ? "text-foreground" : ""}`}>
                    {e}
                  </span>
                ))}
              </div>
            </>
          ) : (
            !offline && empty && <p className="text-xs text-subtle" data-effort-empty="">{empty}</p>
          )}
          {offline && <p className="border-t border-border pt-2 text-xs text-subtle" data-offline-note="">{offline}</p>}
          {fast && (
            <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-3 text-sm">
              <Zap size={14} className={`shrink-0 ${fast.on ? "fill-current text-warn" : "text-subtle"}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("composer.fast.title")}</span>
                <span className="block text-xs text-subtle">{t("composer.fast.hint")}</span>
              </span>
              <Toggle checked={fast.on} onChange={(v) => fast.onToggle(v)} label={t("composer.fast.title")} />
            </label>
          )}
        </div>
      )}
    </Popover>
  );
}


/**
 * The chat's model and effort. Read-only only where the runtime cannot change them live (lib/agentFeatures
 * changesSettingsLive: an older DSH runtime froze the creation choice); new-thread pickers use their own controls.
 */
export function ConversationModelControls({ runtime, live = true, model, effort }: {
  runtime: AgentFeatures["runtime"];
  /** False: show the current values without a picker. */
  live?: boolean;
  model: ComponentProps<typeof ModelPicker>;
  effort: ComponentProps<typeof EffortPicker>;
}) {
  const { t } = useI18n();
  if (isAcpRuntime(runtime) && !live) {
    const key = `composer.effort.${effort.effort}` as MessageKey;
    const effortLabel = effort.effort ? (t(key) === key ? effort.effort : t(key)) : "—";
    return <>
      <span className="min-w-0 px-1 text-xs text-muted" title={model.triggerTitle} data-session-model-readonly="">{model.trigger ?? model.label}</span>
      <span className="trim-cap px-1 text-xs text-muted" title={t("composer.effortTitle")} data-session-effort-readonly="">{effortLabel}</span>
    </>;
  }
  return <><ModelPicker {...model} /><EffortPicker {...effort} /></>;
}


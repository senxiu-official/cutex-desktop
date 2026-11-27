// 输入优化's `composer.action` (docs/desktop-modules.md §31): the wand button in the input footer (click: run the current
// template; right-click / the pick shortcut: a menu of the templates and the way to its settings), the panel (a float above the
// input box, components/ComposerActionLayer; adopting or closing it from its buttons returns the focus to the input),
// and the keys. Everything goes through the
// input box's access object: read the draft and its selection, replace the target as one undo step, hold the
// send / Esc keys while the panel is open. Hosts with text-rewrite-v2: the host's templates (the last one picked is
// the button's and Ctrl+Shift+E's); text-rewrite-v1 only: 提示词增强 with this desktop's route.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, SlidersHorizontal, WandSparkles } from "lucide-react";
import { FEATURE_PROFILES_FEATURE } from "../../../../shared/featureProfiles";
import { TEXT_REWRITE_FEATURE } from "../../../../shared/textRewrite";
import { TEXT_REWRITE_GLOBAL_ROUTE_FEATURE, TEXT_REWRITE_V2_FEATURE } from "../../../../shared/textRewriteV2";
import { useI18n } from "../../i18n";
import { Popover } from "../../components/Menu";
import { useBindingLabel, withKey } from "../../lib/useKeybindings";
import { featuresOf, hostApi, useApp } from "../../store";
import type { ComposerActionProps, ComposerKey, ComposerKeyResult } from "../slots";
import { hostRoute, panelKey, rewriteRoute, setLastTemplate, usePromptEnhancePrefs } from "./rewrite";
import { PromptEnhancePanel } from "./RewritePanel";
import { followsGlobal, GLOBAL_ROUTE_SECTION, refOf, templateSummaryKey, SETTINGS_PAGE, setTemplateEdit, TEMPLATE_SUB, templateName, useTemplates, V1_TEMPLATE } from "./templates";
import { shownVersion, usePromptEnhance, type TemplateRef } from "./useRewrite";

export const PICK_COMMAND = "inputRefinementPick";
export const START_COMMAND = "promptEnhance";

export function RewriteAction({ hostId, sessionId, composer, button, panel }: ComposerActionProps) {
  const { t, locale } = useI18n();
  const features = useApp((s) => featuresOf(s, hostId));
  const v2 = features.has(TEXT_REWRITE_V2_FEATURE);
  const on = v2 || features.has(TEXT_REWRITE_FEATURE);
  const featureProfiles = features.has(FEATURE_PROFILES_FEATURE);
  const prefs = usePromptEnhancePrefs();
  const { list } = useTemplates(hostId, on && v2, featureProfiles);
  const key = useBindingLabel(START_COMMAND);

  /** The templates offered here, and the one the button / shortcut uses (the last picked, else the first). */
  const templates = useMemo(() => (v2 ? (list ?? []).map((x) => ({ ref: refOf(x), name: templateName(t, x), kind: x.kind })) : [{ ref: V1_TEMPLATE, name: templateName(t, V1_TEMPLATE), kind: "enhance" as const }]), [v2, list, t]);
  const current = templates.find((x) => x.ref.id === prefs.lastTemplate[hostId]) ?? templates[0] ?? null;

  const enhance = usePromptEnhance({
    api: () => hostApi(hostId),
    route: () => rewriteRoute(hostRoute(hostId), sessionId || null, featureProfiles),
    sessionId: sessionId || null,
    uiLanguage: locale,
    draft: () => composer.read().text,
  }, `${hostId}|${sessionId}`);
  const state = enhance.state;
  const openSettings = useApp((s) => s.openSettings);

  const start = useCallback((template: TemplateRef | null) => {
    if (!template) return;
    const d = composer.read();
    enhance.start(d.text, d.selectionStart, d.selectionEnd, template);
  }, [composer, enhance]);
  const pick = (id: string) => {
    const x = templates.find((y) => y.ref.id === id);
    if (!x) return;
    setLastTemplate(hostId, id);
    start(x.ref);
  };
  /** Again: the whole draft, or the same selected part while the draft still has it there (never widened). */
  const retry = () => {
    if (state.phase === "idle") return;
    const d = composer.read();
    if (state.target) enhance.restart(d.text);
    else enhance.start(d.text, d.selectionStart, d.selectionEnd, state.template);
  };
  /** 重新整理 with the draft as it is now (changed outside the panel: see usePromptEnhance.regroup). */
  const regroup = (answers: readonly { id: string; text?: string }[]) => enhance.regroup(answers, composer.read().text);
  /** Into the draft as one undo step, only where the draft still holds the target. */
  const adopt = () => {
    const a = enhance.adoption();
    if (!a) return;
    if (a.whole && composer.read().text.length !== a.end) return enhance.adopted(false);
    enhance.adopted(composer.replace(a.start, a.end, a.text, a.expected));
  };

  // Send / Esc-interrupt keys are held while the panel shows.
  useEffect(() => {
    composer.setOpen(on && state.phase !== "idle");
  }, [composer, on, state.phase]);
  useEffect(() => () => composer.setOpen(false), [composer]);

  const [menuSignal, setMenuSignal] = useState(0);
  const handler = useRef<(k: ComposerKey) => ComposerKeyResult>(() => null);
  handler.current = (k) => {
    if (!on) return null;
    if (k.command === START_COMMAND) { start(current?.ref ?? null); return "handled"; }
    if (k.command === PICK_COMMAND) {
      // The wand's menu (as on right-click); with the button hidden the shortcut uses the last template.
      if (prefs.enabled) setMenuSignal((n) => n + 1);
      else start(current?.ref ?? null);
      return "handled";
    }
    if (k.command) return null;
    const action = panelKey(k, state.phase, !!shownVersion(state) && state.phase !== "failed");
    if (action === "adopt") adopt();
    else if (action === "cancel") enhance.cancel();
    return action ? "handled" : null;
  };
  useEffect(() => {
    composer.onKey((k) => handler.current(k));
    return () => composer.onKey(null);
  }, [composer]);

  if (!on) return null;
  const hasContent = !!composer.read().text.trim();
  const label = current?.name ?? t("input-refinement.title");
  // r298: a template that follows the global order is changed there (the detail page's 全局顺序).
  const follows = features.has(TEXT_REWRITE_GLOBAL_ROUTE_FEATURE) && followsGlobal(list?.find((x) => x.id === current?.ref.id));
  /** The current template's own sub-page (v2: its route = which Profile / model), or the global order it follows; v1: the settings page. */
  const openTemplate = () => {
    if (follows) openSettings(SETTINGS_PAGE, { anchor: GLOBAL_ROUTE_SECTION });
    else if (v2 && current) {
      setTemplateEdit({ hostId, id: current.ref.id });
      openSettings(SETTINGS_PAGE, { sub: TEMPLATE_SUB });
    } else openSettings(SETTINGS_PAGE);
  };
  const ROW = "press flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2";
  const templateLabel = state.phase === "idle" ? null : templates.find((x) => x.ref.id === state.template.id)?.name ?? templateName(t, state.template);

  const buttons = prefs.enabled && (
    <span className="flex items-center" data-input-refinement="">
      <Popover
        align="left"
        width="min-w-60"
        openSignal={menuSignal}
        primaryAction={() => start(current?.ref ?? null)}
        disabled={state.phase === "running" || !current}
        triggerLabel={`${t("input-refinement.title")} · ${label}`}
        triggerTitle={`${withKey(hasContent ? t("input-refinement.buttonHint", { template: label }) : t("input-refinement.buttonEmpty"), key)}\n${t("input-refinement.rightClickHint")}`}
        // The button keeps the input's selection: it is what gets rewritten.
        triggerProps={{ onMouseDown: (e) => e.preventDefault(), "data-testid": "prompt-enhance-button", "aria-haspopup": "menu" }}
        triggerClassName="press flex items-center rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
        trigger={<WandSparkles size={14} strokeWidth={1.75} className="block" />}
        onKey={(e, close) => {
          const x = /^[1-9]$/.test(e.key) ? templates[Number(e.key) - 1] : undefined;
          if (!x) return false;
          close();
          pick(x.ref.id);
          return true;
        }}
      >
        {(close) => (
          <div role="menu" data-testid="input-refinement-menu">
            <div className="px-2.5 pt-1.5 pb-1 text-xs text-subtle">{t("input-refinement.menu")}</div>
            {templates.map((x, i) => (
              <button key={x.ref.id} type="button" role="menuitemradio" aria-checked={x.ref.id === current?.ref.id} data-template-id={x.ref.id} className={ROW}
                onClick={() => { close(); pick(x.ref.id); }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{x.name}</span>
                  <span className="block text-xs text-subtle">{t(templateSummaryKey({ id: x.ref.id, kind: x.kind, builtIn: list?.find((y) => y.id === x.ref.id)?.builtIn }))}</span>
                </span>
                <span className="w-3 text-xs text-accent">{x.ref.id === current?.ref.id ? "✓" : ""}</span>
                <span className="w-3 text-right text-xs text-subtle">{i < 9 ? i + 1 : ""}</span>
              </button>
            ))}
            <div role="separator" className="mx-1.5 my-1 border-t border-border" />
            {v2 && current && (
              <button type="button" role="menuitem" data-testid="input-refinement-menu-template" className={ROW} onClick={() => { close(); openTemplate(); }}>
                <span className="w-4 text-center text-muted"><SlidersHorizontal size={13} className="inline" /></span>
                <span className="min-w-0 flex-1 truncate text-sm">{t(follows ? "input-refinement.menuGlobalModel" : "input-refinement.menuTemplateModel", { template: current.name })}</span>
              </button>
            )}
            <button type="button" role="menuitem" data-testid="input-refinement-menu-settings" className={ROW} onClick={() => { close(); openSettings(SETTINGS_PAGE); }}>
              <span className="w-4 text-center text-muted"><Settings2 size={13} className="inline" /></span>
              <span className="min-w-0 flex-1 truncate text-sm">{t("input-refinement.menuSettings")}</span>
            </button>
          </div>
        )}
      </Popover>
    </span>
  );
  return (
    <>
      {button && buttons ? createPortal(buttons, button) : null}
      {panel && state.phase !== "idle" ? createPortal(
        <PromptEnhancePanel
          state={state}
          hostId={hostId}
          templateLabel={templateLabel}
          adoptKey="Enter"
          onAdopt={() => { adopt(); composer.focus(); }}
          onCancel={() => { enhance.cancel(); composer.focus(); }}
          onRetry={retry}
          onShow={enhance.show}
          onAppend={(picks) => enhance.append(picks, t("input-refinement.appendLabel"))}
          onRegroup={state.template.v2 ? regroup : null}
          onChoose={enhance.choose}
        />,
        panel,
      ) : null}
    </>
  );
}

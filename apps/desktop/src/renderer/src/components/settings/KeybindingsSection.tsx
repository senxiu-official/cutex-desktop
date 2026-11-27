import { isImeComposing } from "../../lib/ime";
// Settings → 键盘快捷键: the rebindable window / pane keys (lib/keybindings). A click on a key records a new
// combo (Esc cancels); a combo another command, the system, the composer or a focused terminal needs is
// shown and not saved until resolved; each command has 恢复默认 (the row's 改过 mark), the card has 全部恢复默认.
// Edits go to the active scheme (KeySchemesSection above; 默认 is read-only: 复制后编辑). 查看平台 shows and checks the
// keys as on Windows / macOS / Linux; a row can have its own keys there (单独为 macOS 设置).
import { useEffect, useState } from "react";
import { Monitor, Plus, X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { bindingConflicts, bindingsOf, comboLabel, comboOfEvent, commandDef, COMMANDS, currentConflicts, formatCombo, keyPlatform, KEY_PLATFORMS, resetBindings, setBindings, setRecordingKeys, type CommandId, type ConflictReason, type KeyPlatform } from "../../lib/keybindings";
import { activeScheme, createScheme, isDefaultIn, keybindingSyncOn, schemeLibrary, setPlatformSpecific } from "../../lib/keybindingSchemeStore";
import { BUILTIN_SCHEME_ID } from "../../lib/keybindingSchemes";
import { useKeybindingsVersion } from "../../lib/useKeybindings";
import { Banner, Button, ResetButton, Section, Segmented, SettingRow, SettingsGroup } from "./Form";
import { KeySchemesSection } from "./KeySchemesSection";
import { schemeLabels } from "./keySchemeLabels";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useOwnerWindow } from "../../lib/ownerContext";

const KBD = "inline-flex h-6 items-center rounded border border-border bg-surface-2 px-1.5 font-mono text-caption/[inherit] text-foreground";

/** Which key of which command is being recorded (`slot` = the index replaced; past the end = a new one). */
interface Recording {
  id: CommandId;
  slot: number;
}

/** A recorded combo that cannot be saved as it is. */
interface Pending extends Recording {
  combo: string;
  conflicts: ConflictReason[];
}

const PLATFORM_KEY: Record<KeyPlatform, MessageKey> = { windows: "keySchemes.platform.windows", mac: "keySchemes.platform.mac", linux: "keySchemes.platform.linux" };

export function KeybindingsSection() {
  return (
    <>
      <KeySchemesSection />
      <SchemeBindingsSection />
    </>
  );
}

function SchemeBindingsSection() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  useKeybindingsVersion();
  const device = keyPlatform();
  const [view, setView] = useState<KeyPlatform>(device);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const scheme = activeScheme();
  const readOnly = !scheme;
  const allDefault = COMMANDS.every((c) => isDefaultIn(c.id, view));
  const clashes = currentConflicts(view);
  const source = keybindingSyncOn() && scheme?.sync ? "person" : "local";
  const platformName = (p: KeyPlatform) => t(PLATFORM_KEY[p]);
  const copyToEdit = () => {
    createScheme(t("keySchemes.copyName", { name: t("keySchemes.builtin") }), BUILTIN_SCHEME_ID);
  };

  // While recording: every key goes here (no command fires, nothing else sees it); Esc cancels.
  useEffect(() => {
    if (!recording) return;
    setRecordingKeys(true);
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return setRecording(null);
      const c = comboOfEvent(e);
      if (!c) return; // a modifier on its own: wait for the key
      const def = commandDef(recording.id);
      if (def.digits && /^Digit[1-9]$/.test(c.key)) c.key = "Digits";
      const combo = formatCombo(c);
      setRecording(null);
      const conflicts = bindingConflicts(recording.id, combo, view);
      if (!conflicts.length) return save({ ...recording, combo });
      setPending({ ...recording, combo, conflicts });
    };
    win.addEventListener("keydown", onKey, true);
    return () => {
      win.removeEventListener("keydown", onKey, true);
      setRecordingKeys(false);
    };
  }, [recording, win, view]);

  const save = ({ id, slot, combo }: Recording & { combo: string }) => {
    const list = [...bindingsOf(id, view)];
    if (list.includes(combo) && list.indexOf(combo) !== slot) list.splice(slot, 1);
    else list[slot] = combo;
    setBindings(id, list, view);
    setPending(null);
  };

  /** Take the key from the commands that have it, then save it here. */
  const takeOver = (p: Pending) => {
    for (const r of p.conflicts) if (r.kind === "command") setBindings(r.id, bindingsOf(r.id, view).filter((b) => !overlap(b, p.combo)), view);
    save(p);
  };

  const remove = (id: CommandId, slot: number) => setBindings(id, bindingsOf(id, view).filter((_, i) => i !== slot), view);
  const start = (id: CommandId, slot: number) => {
    if (readOnly) return;
    setPending(null);
    setRecording({ id, slot });
  };

  return (
    <Section
      id={settingsAnchorId("shortcuts-custom")}
      title={t("shortcuts.custom.title")}
      hint={t("shortcuts.custom.hint")}
      actions={
        <SettingsGroup agents="none" source={source}><Button disabled={allDefault || readOnly} onClick={() => (setPending(null), setRecording(null), resetBindings())}>
          {t("shortcuts.custom.resetAll")}
        </Button></SettingsGroup>
      }
    >
      <div data-keybinding-scheme={scheme?.id ?? BUILTIN_SCHEME_ID} data-keybinding-view={view} className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {t("keySchemes.editing", { name: scheme ? schemeLabels(schemeLibrary().schemes, t("keySchemes.mine")).get(scheme.id)! : t("keySchemes.builtin") })}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {t("keySchemes.platform")}
          <SettingsGroup agents="none" source={source} navigation><Segmented value={view} label={t("keySchemes.platform")} onChange={(p) => (setPending(null), setRecording(null), setView(p))}
            options={KEY_PLATFORMS.map((p) => ({ value: p, label: p === device ? t("keySchemes.platform.this", { platform: platformName(p) }) : platformName(p) }))} /></SettingsGroup>
        </span>
      </div>
      {view !== device && <p data-keybinding-other-platform="" className="mb-2 text-xs text-muted">{t("keySchemes.otherPlatform", { platform: platformName(view), device: platformName(device) })}</p>}
      {readOnly && (
        <Banner tone="info" attrs={{ "data-keybinding-readonly": "" }} actions={<Button primary onClick={copyToEdit}>{t("keySchemes.copyToEdit")}</Button>}>
          {t("keySchemes.readOnly")}
        </Banner>
      )}
      {clashes.length > 0 && (
        <p data-keybinding-clashes="" role="alert" className="mb-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn">
          {t("shortcuts.custom.clashes", { list: clashes.map((x) => `${comboLabel(x.combo, view)}: ${t(commandDef(x.a).desc)} / ${t(commandDef(x.b).desc)}`).join("; ") })}
        </p>
      )}
      {COMMANDS.map((cmd) => {
        const list = bindingsOf(cmd.id, view);
        const own = !!scheme?.bindings[cmd.id]?.[view];
        // A command whose built-in key differs on macOS is always set per platform (editTarget).
        const perPlatformOnly = !!commandDef(cmd.id).mac;
        const rec = recording?.id === cmd.id ? recording.slot : null;
        const pend = pending?.id === cmd.id ? pending : null;
        return (
          <div key={cmd.id} data-keybinding={cmd.id} className="group/row">
            <SettingRow agents="none" source={source}
              label={t(cmd.desc as MessageKey)}
              reset={<ResetButton disabled={readOnly || isDefaultIn(cmd.id, view)} onClick={() => (setPending(null), resetBindings(cmd.id, view))} title={t("shortcuts.custom.reset")} />}
            >
              <span className="flex flex-wrap items-center justify-end gap-1">
                {!readOnly && !perPlatformOnly && (
                  <button type="button" data-keybinding-platform-own={own ? "on" : "off"} aria-pressed={own}
                    title={t(own ? "keySchemes.platformOwnOff" : "keySchemes.platformOwn", { platform: platformName(view) })}
                    aria-label={t(own ? "keySchemes.platformOwnOff" : "keySchemes.platformOwn", { platform: platformName(view) })}
                    onClick={() => (setPending(null), setPlatformSpecific(cmd.id, view, !own))}
                    className={own ? "mr-1 inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-caption text-accent hover:bg-accent/25" : "mr-1 rounded p-1 text-subtle opacity-0 hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"}>
                    <Monitor size={11} aria-hidden />
                    {own && t("keySchemes.platformOwnOn", { platform: platformName(view) })}
                  </button>
                )}
                {list.map((b, i) =>
                  rec === i ? (
                    <RecordingChip key={i} />
                  ) : (
                    <span key={b} className="group/kb inline-flex items-center">
                      <button type="button" data-keybinding-key={b} disabled={readOnly} title={readOnly ? t("keySchemes.readOnly") : t("shortcuts.custom.record")} onClick={() => start(cmd.id, i)} className={readOnly ? KBD : `${KBD} hover:border-accent`}>
                        {comboLabel(b, view)}
                      </button>
                      {!readOnly && (
                        <button type="button" aria-label={t("shortcuts.custom.remove", { key: comboLabel(b, view) })} title={t("shortcuts.custom.remove", { key: comboLabel(b, view) })} onClick={() => remove(cmd.id, i)} className="ml-0.5 rounded p-0.5 text-subtle opacity-0 group-hover/kb:opacity-100 hover:text-foreground focus-visible:opacity-100">
                          <X size={11} aria-hidden />
                        </button>
                      )}
                    </span>
                  ),
                )}
                {rec !== null && rec >= list.length && <RecordingChip />}
                {!list.length && rec === null && <span className="text-xs text-subtle">{t("shortcuts.custom.none")}</span>}
                {!readOnly && rec === null && list.length < 4 && (
                  <button type="button" data-keybinding-add="" aria-label={t("shortcuts.custom.add")} title={t("shortcuts.custom.add")} onClick={() => start(cmd.id, list.length)} className="rounded p-1 text-subtle hover:bg-hover hover:text-foreground">
                    <Plus size={13} aria-hidden />
                  </button>
                )}
              </span>
            </SettingRow>
            {pend && (
              <div data-keybinding-conflict="" role="alert" className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
                <p className="flex items-start gap-2 text-danger">
                  <kbd className={`${KBD} shrink-0`}>{comboLabel(pend.combo, view)}</kbd>
                  <span className="min-w-0 pt-1">{pend.conflicts.map((r) => conflictText(t, r)).join(" ")}</span>
                </p>
                <SettingsGroup agents="none" source={source}><div className="mt-2 flex flex-wrap justify-end gap-2">
                  {pend.conflicts.every((r) => r.kind === "command") && (
                    <Button primary onClick={() => takeOver(pend)}>
                      {t("shortcuts.custom.takeOver")}
                    </Button>
                  )}
                  <Button onClick={() => start(pend.id, pend.slot)}>{t("shortcuts.custom.retry")}</Button>
                  <Button onClick={() => setPending(null)}>{t("shortcuts.custom.cancel")}</Button>
                </div></SettingsGroup>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function RecordingChip() {
  const { t } = useI18n();
  return (
    <span data-keybinding-recording="" aria-live="polite" className={`${KBD} animate-pulse border-accent text-accent`}>
      {t("shortcuts.custom.recording")}
    </span>
  );
}

function conflictText(t: ReturnType<typeof useI18n>["t"], r: ConflictReason): string {
  if (r.kind === "command") return t("shortcuts.conflict.command", { command: t(commandDef(r.id).desc) });
  return t(`shortcuts.conflict.${r.kind}` as MessageKey);
}

/** Same keys: equal, or a digits family against one of its digits. */
function overlap(a: string, b: string): boolean {
  if (a === b) return true;
  const family = (x: string) => x.replace(/Digit[1-9]$/, "Digits");
  return family(a) === family(b);
}

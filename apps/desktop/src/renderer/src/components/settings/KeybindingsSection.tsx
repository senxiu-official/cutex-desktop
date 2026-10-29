import { isImeComposing } from "../../lib/ime";
// Settings → 键盘快捷键: the rebindable window / pane keys (lib/keybindings). A click on a key records a new
// combo (Esc cancels); a combo another command, the system, the composer or a focused terminal needs is
// shown and not saved until resolved; each command has 恢复默认 (the row's 改过 mark), the card has 全部恢复默认.
// Saved on this desktop only.
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { bindingConflicts, bindingsOf, comboLabel, comboOfEvent, commandDef, COMMANDS, currentConflicts, formatCombo, isDefault, resetBindings, setBindings, setRecordingKeys, type CommandId, type ConflictReason } from "../../lib/keybindings";
import { useKeybindingsVersion } from "../../lib/useKeybindings";
import { Button, ResetButton, Section, SettingRow, SettingsGroup } from "./Form";
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

export function KeybindingsSection() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  useKeybindingsVersion();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const allDefault = COMMANDS.every((c) => isDefault(c.id));
  const clashes = currentConflicts();

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
      const conflicts = bindingConflicts(recording.id, combo);
      if (!conflicts.length) return save({ ...recording, combo });
      setPending({ ...recording, combo, conflicts });
    };
    win.addEventListener("keydown", onKey, true);
    return () => {
      win.removeEventListener("keydown", onKey, true);
      setRecordingKeys(false);
    };
  }, [recording, win]);

  const save = ({ id, slot, combo }: Recording & { combo: string }) => {
    const list = [...bindingsOf(id)];
    if (list.includes(combo) && list.indexOf(combo) !== slot) list.splice(slot, 1);
    else list[slot] = combo;
    setBindings(id, list);
    setPending(null);
  };

  /** Take the key from the commands that have it, then save it here. */
  const takeOver = (p: Pending) => {
    for (const r of p.conflicts) if (r.kind === "command") setBindings(r.id, bindingsOf(r.id).filter((b) => !overlap(b, p.combo)));
    save(p);
  };

  const remove = (id: CommandId, slot: number) => setBindings(id, bindingsOf(id).filter((_, i) => i !== slot));
  const start = (id: CommandId, slot: number) => {
    setPending(null);
    setRecording({ id, slot });
  };

  return (
    <Section
      id={settingsAnchorId("shortcuts-custom")}
      title={t("shortcuts.custom.title")}
      hint={t("shortcuts.custom.hint")}
      actions={
        <SettingsGroup agents="none" source="local"><Button disabled={allDefault} onClick={() => (setPending(null), setRecording(null), resetBindings())}>
          {t("shortcuts.custom.resetAll")}
        </Button></SettingsGroup>
      }
    >
      {clashes.length > 0 && (
        <p data-keybinding-clashes="" role="alert" className="mb-2 rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn">
          {t("shortcuts.custom.clashes", { list: clashes.map((x) => `${comboLabel(x.combo)}: ${t(commandDef(x.a).desc)} / ${t(commandDef(x.b).desc)}`).join("; ") })}
        </p>
      )}
      {COMMANDS.map((cmd) => {
        const list = bindingsOf(cmd.id);
        const rec = recording?.id === cmd.id ? recording.slot : null;
        const pend = pending?.id === cmd.id ? pending : null;
        return (
          <div key={cmd.id} data-keybinding={cmd.id}>
            <SettingRow agents="none" source="local"
              label={t(cmd.desc as MessageKey)}
              reset={<ResetButton disabled={isDefault(cmd.id)} onClick={() => (setPending(null), resetBindings(cmd.id))} title={t("shortcuts.custom.reset")} />}
            >
              <span className="flex flex-wrap items-center justify-end gap-1">
                {list.map((b, i) =>
                  rec === i ? (
                    <RecordingChip key={i} />
                  ) : (
                    <span key={b} className="group/kb inline-flex items-center">
                      <button type="button" data-keybinding-key={b} title={t("shortcuts.custom.record")} onClick={() => start(cmd.id, i)} className={`${KBD} hover:border-accent`}>
                        {comboLabel(b)}
                      </button>
                      <button type="button" aria-label={t("shortcuts.custom.remove", { key: comboLabel(b) })} title={t("shortcuts.custom.remove", { key: comboLabel(b) })} onClick={() => remove(cmd.id, i)} className="ml-0.5 rounded p-0.5 text-subtle opacity-0 group-hover/kb:opacity-100 hover:text-foreground focus-visible:opacity-100">
                        <X size={11} aria-hidden />
                      </button>
                    </span>
                  ),
                )}
                {rec !== null && rec >= list.length && <RecordingChip />}
                {!list.length && rec === null && <span className="text-xs text-subtle">{t("shortcuts.custom.none")}</span>}
                {rec === null && list.length < 4 && (
                  <button type="button" data-keybinding-add="" aria-label={t("shortcuts.custom.add")} title={t("shortcuts.custom.add")} onClick={() => start(cmd.id, list.length)} className="rounded p-1 text-subtle hover:bg-hover hover:text-foreground">
                    <Plus size={13} aria-hidden />
                  </button>
                )}
              </span>
            </SettingRow>
            {pend && (
              <div data-keybinding-conflict="" role="alert" className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs">
                <p className="flex items-start gap-2 text-danger">
                  <kbd className={`${KBD} shrink-0`}>{comboLabel(pend.combo)}</kbd>
                  <span className="min-w-0 pt-1">{pend.conflicts.map((r) => conflictText(t, r)).join(" ")}</span>
                </p>
                <SettingsGroup agents="none" source="local"><div className="mt-2 flex flex-wrap justify-end gap-2">
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

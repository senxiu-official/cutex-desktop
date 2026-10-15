// ▶ 运行 in a reply's code-block toolbar (timeline.codeBlockAction, docs/desktop-modules.md §22): styled
// like streamdown's Copy / Download beside it. One-line blocks run on click; multi-line blocks arm first
// (ArmedHint 「再点一次运行这 N 行」) and run on the second click. Never window.confirm, never auto-run.
import { Play } from "lucide-react";
import { useRef, useState } from "react";
import { ArmedHint } from "../../components/ArmedHint";
import { useI18n } from "../../i18n";
import { useArmed } from "../../lib/armedConfirm";
import type { CodeBlockActionProps } from "../slots";
import { codeLines, runClick } from "./codeRun";
import { runCode } from "./runCode";

const BTN = "cursor-pointer rounded p-1 transition-all disabled:cursor-not-allowed disabled:opacity-50";

export function RunCodeButton({ hostId, sessionId, code, incomplete }: CodeBlockActionProps) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useArmed(code);
  const [busy, setBusy] = useState(false);
  const lines = codeLines(code);
  const tip = t("terminal.runTip");
  const click = () => {
    if (runClick(lines, armed) === "arm") return setArmed(true);
    setArmed(false);
    setBusy(true);
    void runCode(hostId, sessionId, code).finally(() => setBusy(false));
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-code-run=""
        onClick={click}
        disabled={incomplete || busy || lines === 0}
        title={armed ? undefined : tip}
        aria-label={armed ? t("terminal.runArmed", { n: lines }) : tip}
        className={`${BTN} ${armed ? "bg-danger text-white" : "text-muted-foreground hover:text-foreground"}`}
      >
        <Play aria-hidden size={14} />
      </button>
      {armed && <ArmedHint anchor={anchor} text={t("terminal.runArmed", { n: lines })} />}
    </>
  );
}

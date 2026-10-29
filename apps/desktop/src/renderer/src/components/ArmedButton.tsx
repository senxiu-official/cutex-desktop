// A click-twice button on the shared mechanism (lib/armedConfirm useArmed + components/ArmedHint): the
// first click arms the same button — same label, same footprint, the danger face with the countdown — and
// a floating hint says what the second click does; the second click runs `onConfirm`. Esc, the timeout
// and the 「未开始」 note come from useArmed. `shape`: the classes both states share (size, padding, font);
// `idle`: the face while not armed. Medium-risk actions only (docs: confirm by risk); big ones use confirmDialog.
import { useEffect, useRef, type ReactNode } from "react";
import { ARMED_FACE, useArmed } from "../lib/armedConfirm";
import { ArmedHint } from "./ArmedHint";

export function ArmedButton({
  shape,
  idle,
  hint,
  onConfirm,
  onArmedChange,
  resetKey,
  disabled,
  title,
  testId,
  children,
}: {
  shape: string;
  idle: string;
  hint: string;
  onConfirm(): void;
  onArmedChange?(armed: boolean): void;
  resetKey?: unknown;
  disabled?: boolean;
  title?: string;
  testId?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useArmed(resetKey);
  const ref = useRef<HTMLButtonElement>(null);
  const live = armed && !disabled;
  const report = useRef(onArmedChange);
  report.current = onArmedChange;
  useEffect(() => {
    report.current?.(live);
  }, [live]);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        title={live ? undefined : title}
        aria-label={live ? hint : undefined}
        data-armed={live || undefined}
        data-testid={testId}
        className={`${shape} ${live ? ARMED_FACE : idle}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!live) return setArmed(true);
          setArmed(false);
          onConfirm();
        }}
      >
        {children}
      </button>
      {live && <ArmedHint anchor={ref} text={hint} />}
    </>
  );
}
